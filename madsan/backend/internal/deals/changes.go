package deals

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/compliance"
	"github.com/madsan/intelligence/internal/markets"
	"github.com/madsan/intelligence/internal/notify"
)

const (
	ChangeTierObserved       = "observed"
	ChangeTierNotImplemented = "not_implemented"
	ChangesTierNotImplemented = ChangeTierNotImplemented

	changeTypeBenchmarkPrice = "benchmark_price_delta"
	changeTypeSanctions      = "opensanctions_rescreen"
	changeTypeVesselAIS      = "vessel_last_seen_stale"
)

// ChangeItem is one detectable (or honestly stubbed) deal watch diff.
type ChangeItem struct {
	Type       string   `json:"type"`
	Field      string   `json:"field,omitempty"`
	OldValue   string   `json:"old_value,omitempty"`
	NewValue   string   `json:"new_value,omitempty"`
	DeltaPct   *float64 `json:"delta_pct,omitempty"`
	Tier       string   `json:"tier"`
	Source     string   `json:"source,omitempty"`
	Message    string   `json:"message,omitempty"`
	DetectedAt string   `json:"detected_at,omitempty"`
}

// ChangesResponse is returned by GET /api/deals/{id}/changes.
type ChangesResponse struct {
	DealID     string       `json:"deal_id"`
	Tier       string       `json:"tier"`
	Watching   bool         `json:"watching"`
	SnapshotAt string       `json:"snapshot_at,omitempty"`
	Changes    []ChangeItem `json:"changes"`
}

type snapshotBenchmark struct {
	Symbol string  `json:"symbol"`
	Price  float64 `json:"price"`
	Tier   string  `json:"tier"`
}

type watchSnapshot struct {
	CapturedAt     string             `json:"captured_at"`
	PackHash       string             `json:"pack_hash"`
	Commodity      string             `json:"commodity"`
	QuantityUnit   string             `json:"quantity_unit"`
	Price          float64            `json:"price"`
	Currency       string             `json:"currency"`
	Seller         string             `json:"seller"`
	Buyer          string             `json:"buyer"`
	Benchmark      *snapshotBenchmark `json:"benchmark,omitempty"`
	Sanctions      map[string]string  `json:"sanctions,omitempty"`
	VesselMMSI     string             `json:"vessel_mmsi,omitempty"`
	VesselLastSeen string             `json:"vessel_last_seen,omitempty"`
}

// ChangesScaffold returns an honest empty response when no watch baseline exists.
func ChangesScaffold(dealID string) map[string]any {
	return map[string]any{
		"deal_id": dealID,
		"tier":    ChangeTierNotImplemented,
		"changes": []any{},
	}
}

func (s *Service) CaptureWatchSnapshot(ctx context.Context, dealID, userID uuid.UUID) error {
	snap, err := s.buildWatchSnapshot(ctx, dealID.String())
	if err != nil {
		return err
	}
	b, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO deal_watch_subscriptions (deal_id, user_id, last_snapshot)
		VALUES ($1, $2, $3)
		ON CONFLICT (deal_id, user_id) DO UPDATE SET last_snapshot = EXCLUDED.last_snapshot
	`, dealID, userID, b)
	if err != nil {
		return err
	}
	_, _ = s.ScanWatchSubscription(ctx, dealID, userID)
	return nil
}

func (s *Service) GetChanges(ctx context.Context, dealID uuid.UUID, userID uuid.UUID) (ChangesResponse, error) {
	id := dealID.String()
	resp := ChangesResponse{
		DealID:   id,
		Tier:     ChangeTierNotImplemented,
		Changes:  []ChangeItem{},
		Watching: false,
	}

	var snapJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT last_snapshot FROM deal_watch_subscriptions
		WHERE deal_id = $1 AND user_id = $2
	`, dealID, userID).Scan(&snapJSON)
	if err == pgx.ErrNoRows {
		return resp, nil
	}
	if err != nil {
		return resp, err
	}
	resp.Watching = true

	if len(snapJSON) == 0 {
		resp.Changes = []ChangeItem{{
			Type:    changeTypeBenchmarkPrice,
			Field:   "watch baseline",
			Tier:    ChangeTierNotImplemented,
			Message: "No snapshot stored — POST /watch again to capture a baseline",
		}}
		return resp, nil
	}

	var snap watchSnapshot
	if err := json.Unmarshal(snapJSON, &snap); err != nil {
		return resp, err
	}
	resp.SnapshotAt = snap.CapturedAt

	items, err := s.loadChangeEvents(ctx, dealID, userID, 50)
	if err != nil {
		return resp, err
	}
	if len(items) == 0 {
		now := time.Now().UTC()
		items = s.computeChangeItems(ctx, snap, now)
	}
	resp.Changes = items
	resp.Tier = aggregateChangesTier(items)
	if resp.Tier == ChangeTierObserved {
		s.maybeNotifyDealWatch(ctx, dealID, userID, items)
	}
	return resp, nil
}

func (s *Service) maybeNotifyDealWatch(ctx context.Context, dealID, userID uuid.UUID, items []ChangeItem) {
	if s == nil || s.notifier == nil {
		return
	}
	var email string
	if err := s.pool.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil || email == "" {
		return
	}
	types := make([]string, 0, len(items))
	for _, it := range items {
		if it.Tier == ChangeTierObserved {
			types = append(types, it.Type)
		}
	}
	if len(types) == 0 {
		return
	}
	_ = notify.DealWatchAlert(ctx, s.notifier, email, dealID.String(), types)
}

func (s *Service) buildWatchSnapshot(ctx context.Context, dealID string) (watchSnapshot, error) {
	var (
		commodity, seller, buyer, currency string
		quantityUnit                       *string
		price                              *float64
		resultJSON                         []byte
	)
	err := s.pool.QueryRow(ctx, `
		SELECT commodity, seller_name, buyer_name, quantity_unit, price, currency, verification_result
		FROM deals WHERE id = $1
	`, dealID).Scan(&commodity, &seller, &buyer, &quantityUnit, &price, &currency, &resultJSON)
	if err != nil {
		return watchSnapshot{}, err
	}

	pack, err := s.BuildPack(ctx, dealID)
	if err != nil {
		return watchSnapshot{}, err
	}
	packBytes, _ := json.Marshal(pack)

	now := time.Now().UTC()
	snap := watchSnapshot{
		CapturedAt:   now.Format(time.RFC3339),
		PackHash:     hashBytes(packBytes),
		Commodity:    commodity,
		QuantityUnit: derefStr(quantityUnit),
		Price:        floatPtrVal(price),
		Currency:     currency,
		Seller:       seller,
		Buyer:        buyer,
		Sanctions:    map[string]string{},
	}

	ticker := markets.NewHandler(s.eiaKey)
	if q, ok := ticker.LookupBenchmark(commodity, now); ok {
		snap.Benchmark = &snapshotBenchmark{Symbol: q.Symbol, Price: q.Price, Tier: q.Tier}
	}

	if seller != "" {
		snap.Sanctions["seller"] = s.screener.ScreenCompany(ctx, seller, 5).Status
	}
	if buyer != "" {
		snap.Sanctions["buyer"] = s.screener.ScreenCompany(ctx, buyer, 5).Status
	}

	var verification map[string]any
	if len(resultJSON) > 0 {
		_ = json.Unmarshal(resultJSON, &verification)
	}
	if mmsi, _ := verification["claimed_vessel_mmsi"].(string); mmsi != "" {
		snap.VesselMMSI = mmsi
		var lastSeen *time.Time
		if err := s.pool.QueryRow(ctx, `SELECT last_seen_at FROM vessels WHERE mmsi = $1`, mmsi).Scan(&lastSeen); err == nil && lastSeen != nil {
			snap.VesselLastSeen = lastSeen.UTC().Format(time.RFC3339)
		}
	}

	return snap, nil
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func aggregateChangesTier(items []ChangeItem) string {
	for _, it := range items {
		if it.Tier == ChangeTierObserved {
			return ChangeTierObserved
		}
	}
	return ChangeTierNotImplemented
}

func detectBenchmarkPriceDelta(snap watchSnapshot, ticker *markets.Handler, now time.Time) ChangeItem {
	item := ChangeItem{
		Type:       changeTypeBenchmarkPrice,
		Field:      "benchmark vs claimed price",
		Tier:       ChangeTierNotImplemented,
		DetectedAt: now.Format(time.RFC3339),
	}
	if snap.Benchmark == nil {
		item.Message = "No benchmark mapped for commodity — price delta not comparable"
		return item
	}
	q, ok := ticker.LookupBenchmark(snap.Commodity, now)
	if !ok {
		item.Message = "Benchmark quote unavailable for commodity"
		return item
	}
	if !markets.PriceComparable(snap.Commodity, snap.QuantityUnit) {
		item.Field = snap.Benchmark.Symbol + " drift since watch"
		item.Tier = ChangeTierObserved
		item.Source = q.Tier
		if snap.Benchmark.Price > 0 {
			delta := pctDelta(snap.Benchmark.Price, q.Price)
			item.DeltaPct = &delta
			item.OldValue = fmt.Sprintf("%.2f USD%s", snap.Benchmark.Price, q.Unit)
			item.NewValue = fmt.Sprintf("%.2f USD%s", q.Price, q.Unit)
			item.Message = "Claimed deal price uses incompatible units — showing benchmark drift only"
		} else {
			item.Message = "Claimed deal price unit not comparable to benchmark — drift only"
		}
		return item
	}
	if snap.Price <= 0 {
		item.Message = "Deal has no claimed price — cannot compute delta"
		return item
	}
	delta := pctDelta(snap.Price, q.Price)
	item.Tier = ChangeTierObserved
	item.Source = q.Tier
	item.DeltaPct = &delta
	item.OldValue = fmt.Sprintf("%.2f %s (claimed)", snap.Price, snap.Currency)
	item.NewValue = fmt.Sprintf("%.2f USD%s (%s)", q.Price, q.Unit, q.Label)
	if math.Abs(delta) < 0.05 {
		item.Message = "Benchmark within 0.05% of claimed price"
	} else if delta > 0 {
		item.Message = "Benchmark above claimed price"
	} else {
		item.Message = "Benchmark below claimed price"
	}
	return item
}

func detectSanctionsRescreen(ctx context.Context, screener *compliance.Screener, snap watchSnapshot, now time.Time) ChangeItem {
	item := ChangeItem{
		Type:       changeTypeSanctions,
		Field:      "OpenSanctions re-screen",
		Tier:       ChangeTierNotImplemented,
		DetectedAt: now.Format(time.RFC3339),
		Source:     "opensanctions",
		Message:    "Re-screen diff worker not shipped — baseline stored at watch; manual re-verify recommended",
	}
	if len(snap.Sanctions) == 0 {
		return item
	}

	changes := []string{}
	for role, baseStatus := range snap.Sanctions {
		name := snap.Seller
		if role == "buyer" {
			name = snap.Buyer
		}
		if name == "" {
			continue
		}
		cur := screener.ScreenCompany(ctx, name, 5)
		if cur.Status == "unknown" {
			continue
		}
		if cur.Status != baseStatus {
			changes = append(changes, fmt.Sprintf("%s %s → %s", role, baseStatus, cur.Status))
		}
	}
	if len(changes) == 0 {
		return item
	}
	item.Tier = ChangeTierObserved
	item.OldValue = strings.Join(changes, "; ")
	item.Message = "Sanctions screening status changed since watch baseline"
	return item
}

func detectVesselLastSeenStale(ctx context.Context, pool *pgxpool.Pool, snap watchSnapshot, now time.Time) ChangeItem {
	item := ChangeItem{
		Type:       changeTypeVesselAIS,
		Field:      "claimed vessel AIS freshness",
		Tier:       ChangeTierNotImplemented,
		DetectedAt: now.Format(time.RFC3339),
		Source:     "vessels.last_seen_at",
	}
	if snap.VesselMMSI == "" {
		item.Message = "No claimed vessel on deal — AIS freshness check not applicable"
		return item
	}
	item.Field = "vessel " + snap.VesselMMSI + " last_seen"

	var lastSeen *time.Time
	err := pool.QueryRow(ctx, `SELECT last_seen_at FROM vessels WHERE mmsi = $1`, snap.VesselMMSI).Scan(&lastSeen)
	if err != nil {
		item.Message = "Claimed vessel MMSI not found in AIS registry"
		return item
	}
	if lastSeen == nil {
		item.Tier = ChangeTierObserved
		item.NewValue = "never observed"
		item.Message = "Vessel has no AIS last_seen timestamp"
		return item
	}

	seen := lastSeen.UTC()
	age := now.Sub(seen)
	item.OldValue = snap.VesselLastSeen
	item.NewValue = seen.Format(time.RFC3339)
	item.Tier = ChangeTierObserved

	const staleThreshold = 72 * time.Hour
	if age > staleThreshold {
		item.Message = fmt.Sprintf("AIS stale — last seen %.0fh ago (>72h)", age.Hours())
		return item
	}
	if snap.VesselLastSeen != "" && snap.VesselLastSeen != seen.Format(time.RFC3339) {
		item.Message = "Vessel last_seen updated since watch baseline"
		return item
	}
	item.Message = fmt.Sprintf("AIS fresh — last seen %.0fh ago", age.Hours())
	return item
}

func floatPtrVal(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func pctDelta(base, current float64) float64 {
	if base == 0 {
		return 0
	}
	return ((current - base) / base) * 100
}
