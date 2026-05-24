package opportunity

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultScanBatchLimit = 500

const (
	TypeTermLead       = "possible_term_contract_lead"
	TypeCargoFlip      = "possible_cargo_flip"
	TypeStorageArb     = "possible_storage_arbitrage"
	TypeDistressIdle   = "possible_distress_slow_steaming"
	TypeRouteCandidate = "supplier_buyer_route_candidate"
)

var defaultProfitChecklist = []string{
	"Confirm cargo grade and volume with operator (not inferred AIS alone)",
	"Obtain indicative buy and sell prices",
	"Quote freight or demurrage if relevant",
	"Validate storage or terminal slot availability and tariff",
	"Run counterparty credit and sanctions screening",
}

type opportunityInput struct {
	Type             string
	MMSI             *int64
	TerminalID       *uuid.UUID
	PortCallID       *uuid.UUID
	CompanyID        *uuid.UUID
	Title            string
	Hypothesis       string
	Confidence       float64
	Evidence         []string
	ProfitChecklist  []string
	Fingerprint      string
	DealScore        float64
	Signal           map[string]any
	RoutePrefill     map[string]any
	SourceTiers      []string
	FreshnessAt      *time.Time
	ExpiresAfterDays int
}

// ScanRecentPortCalls creates opportunities from closed port calls (repeat visits, flips).
func ScanRecentPortCalls(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	created := 0
	n, err := scanTermLeads(ctx, pool)
	created += n
	if err != nil {
		return created, err
	}
	n, err = scanCargoFlip(ctx, pool)
	created += n
	if err != nil {
		return created, err
	}
	n, err = scanStorageSwapCandidates(ctx, pool)
	created += n
	if err != nil {
		return created, err
	}
	n, err = scanSupplierBuyerRoutes(ctx, pool)
	created += n
	return created, err
}

func scanBatchLimit() int {
	raw := os.Getenv("OIL_OPPORTUNITY_SCAN_LIMIT")
	if raw == "" {
		return defaultScanBatchLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultScanBatchLimit
	}
	if n > 5000 {
		return 5000
	}
	return n
}

func scanTermLeads(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	limit := scanBatchLimit()
	rows, err := pool.Query(ctx, `
		SELECT pc.terminal_id, t.name, t.operator_name, pc.mmsi, COUNT(*)::int
		FROM oil_port_calls pc
		JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.status='closed' AND pc.arrival_ts > now() - interval '90 days'
		GROUP BY pc.terminal_id, t.name, t.operator_name, pc.mmsi
		HAVING COUNT(*) >= 3
		ORDER BY COUNT(*) DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var tid uuid.UUID
		var tname, op string
		var mmsi int64
		var cnt int
		if err := rows.Scan(&tid, &tname, &op, &mmsi, &cnt); err != nil {
			return n, err
		}
		title := fmt.Sprintf("Possible term relationship at %s", tname)
		hyp := fmt.Sprintf("MMSI %d visited %s %d times in 90 days — possible recurring commercial relationship (inferred).", mmsi, tname, cnt)
		evidence := []string{
			fmt.Sprintf("Repeat visits: %d in 90 days", cnt),
			"Operator: " + op,
			"Inferred from public AIS — not a confirmed contract",
		}
		scoreInput := DealScoreInput{
			MovementActivity:    clamp01(float64(cnt) / 6),
			InfrastructureFit:   0.7,
			CounterpartyClarity: scorePresentString(op, 0.65, 0.3),
			MacroSupport:        0.45,
			RouteReadiness:      0.45,
			Provenance:          0.65,
		}
		dealScore := ScoreDeal(scoreInput)
		_, inserted, err := upsertOpportunity(ctx, pool, opportunityInput{
			Type:            TypeTermLead,
			MMSI:            &mmsi,
			TerminalID:      &tid,
			Title:           title,
			Hypothesis:      hyp,
			Confidence:      maxFloat(0.62, minFloat(0.86, dealScore+0.08)),
			Evidence:        evidence,
			ProfitChecklist: defaultProfitChecklist,
			Fingerprint:     fmt.Sprintf("deal-radar:term:%s:%d", tid.String(), mmsi),
			DealScore:       dealScore,
			Signal: signalPayload(
				TypeTermLead,
				scoreInput,
				"",
				evidence,
				[]map[string]any{{"role": "operator", "name": op, "tier": "inferred"}},
				[]map[string]any{{"terminal_id": tid.String(), "name": tname, "tier": "inferred"}},
			),
			RoutePrefill: map[string]any{
				"terminal_id":    tid.String(),
				"load_port_name": tname,
			},
			SourceTiers: sourceTiers("live", "inferred"),
			FreshnessAt: ptrTime(time.Now().UTC()),
		})
		if err != nil {
			return n, err
		}
		if inserted {
			n++
		}
	}
	return n, rows.Err()
}

func scanCargoFlip(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	limit := scanBatchLimit()
	rows, err := pool.Query(ctx, `
		SELECT pc.id, pc.mmsi, pc.vessel_name, pc.terminal_id, t.name, pc.event_type,
			pc.duration_hours, pc.confidence, pc.draft_delta
		FROM oil_port_calls pc
		JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.status='closed'
		  AND pc.event_type='possible_loading'
		  AND pc.duration_hours < 48
		  AND pc.arrival_ts > now() - interval '14 days'
		ORDER BY pc.arrival_ts DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var pcID, tid uuid.UUID
		var mmsi int64
		var vessel, tname, event string
		var dur, conf, ddelta float64
		if err := rows.Scan(&pcID, &mmsi, &vessel, &tid, &tname, &event, &dur, &conf, &ddelta); err != nil {
			return n, err
		}
		title := fmt.Sprintf("Possible short-haul flip at %s", tname)
		hyp := fmt.Sprintf("%s may have loaded at %s with short dwell (%.1fh) — possible repositioning/flip candidate, not listed for sale.", vessel, tname, dur)
		evidence := []string{
			"Short dwell after possible loading",
			fmt.Sprintf("Draft delta: %.1fm", ddelta),
			"Trading hub / storage terminal context",
			"Inferred only — verify cargo terms with counterparty",
		}
		scoreInput := DealScoreInput{
			MovementActivity:    clamp01(conf),
			InfrastructureFit:   0.75,
			CounterpartyClarity: 0.35,
			MacroSupport:        0.5,
			RouteReadiness:      0.45,
			Provenance:          0.7,
		}
		dealScore := ScoreDeal(scoreInput)
		_, inserted, err := upsertOpportunity(ctx, pool, opportunityInput{
			Type:            TypeCargoFlip,
			MMSI:            &mmsi,
			TerminalID:      &tid,
			PortCallID:      &pcID,
			Title:           title,
			Hypothesis:      hyp,
			Confidence:      maxFloat(0.5, minFloat(0.9, conf*0.9)),
			Evidence:        evidence,
			ProfitChecklist: defaultProfitChecklist,
			Fingerprint:     fmt.Sprintf("deal-radar:flip:%s:%d:%s", tid.String(), mmsi, pcID.String()),
			DealScore:       dealScore,
			Signal: signalPayload(
				TypeCargoFlip,
				scoreInput,
				event,
				evidence,
				[]map[string]any{{"role": "vessel", "name": vessel, "mmsi": mmsi, "tier": "live"}},
				[]map[string]any{{"terminal_id": tid.String(), "name": tname, "tier": "inferred"}},
			),
			RoutePrefill: map[string]any{
				"terminal_id":      tid.String(),
				"load_port_name":   tname,
				"commodity_family": event,
				"opportunity_type": TypeCargoFlip,
			},
			SourceTiers: sourceTiers("live", "synthetic", "inferred"),
			FreshnessAt: ptrTime(time.Now().UTC()),
		})
		if err != nil {
			return n, err
		}
		if inserted {
			n++
		}
	}
	return n, rows.Err()
}

func scanStorageSwapCandidates(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	limit := scanBatchLimit()
	rows, err := pool.Query(ctx, `
		SELECT
			t.id, t.name, COALESCE(t.operator_name, ''), COALESCE(t.country, ''),
			COALESCE(t.port, ''), COALESCE(t.terminal_type, ''), COALESCE(t.products, ARRAY[]::text[]),
			COALESCE(t.confidence, 0.5)::float8,
			COUNT(pc.id)::int,
			MAX(COALESCE(pc.departure_ts, pc.arrival_ts)) AS freshness_at
		FROM oil_terminals t
		LEFT JOIN oil_port_calls pc
		  ON pc.terminal_id = t.id
		 AND pc.status = 'closed'
		 AND pc.arrival_ts > now() - interval '60 days'
		WHERE t.geom IS NOT NULL
		  AND (
		    COALESCE(t.terminal_type, '') ILIKE ANY(ARRAY['%storage%', '%tank%', '%terminal%', '%refinery%'])
		    OR COALESCE(array_to_string(t.products, ' '), '') ILIKE ANY(ARRAY['%crude%', '%diesel%', '%gasoil%', '%jet%', '%gasoline%', '%lng%', '%lpg%', '%fuel%'])
		  )
		GROUP BY t.id, t.name, t.operator_name, t.country, t.port, t.terminal_type, t.products, t.confidence
		HAVING COUNT(pc.id) >= 1
		   OR COALESCE(t.terminal_type, '') ILIKE ANY(ARRAY['%storage%', '%tank%'])
		ORDER BY COUNT(pc.id) DESC, COALESCE(t.confidence, 0.5) DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var tid uuid.UUID
		var name, operatorName, country, port, terminalType string
		var products []string
		var terminalConfidence float64
		var recentCalls int
		var freshness *time.Time
		if err := rows.Scan(&tid, &name, &operatorName, &country, &port, &terminalType, &products, &terminalConfidence, &recentCalls, &freshness); err != nil {
			return n, err
		}
		commodity := firstProduct(products)
		if commodity == "" {
			commodity = inferCommodityFromTerminalType(terminalType)
		}
		evidence := []string{
			"Storage or liquid-bulk infrastructure is present in the open-data terminal graph",
			fmt.Sprintf("Recent closed AIS-linked port calls: %d", recentCalls),
			"Inferred commercial lead only — verify slot, owner, tariff, and title before quoting",
		}
		if operatorName != "" {
			evidence = append(evidence, "Operator candidate: "+operatorName)
		}
		scoreInput := DealScoreInput{
			MovementActivity:    maxFloat(0.25, minFloat(1, float64(recentCalls)/5)),
			InfrastructureFit:   maxFloat(0.55, minFloat(0.95, terminalConfidence+0.2)),
			CounterpartyClarity: scorePresentString(operatorName, 0.62, 0.28),
			MacroSupport:        scorePresentString(commodity, 0.56, 0.38),
			RouteReadiness:      scorePresentString(port, 0.65, scorePresentString(country, 0.45, 0.25)),
			Provenance:          0.62,
		}
		dealScore := ScoreDeal(scoreInput)
		sourceTierValues := []string{"inferred"}
		if recentCalls > 0 {
			sourceTierValues = append(sourceTierValues, "live")
		}
		_, inserted, err := upsertOpportunity(ctx, pool, opportunityInput{
			Type:            TypeStorageArb,
			TerminalID:      &tid,
			Title:           fmt.Sprintf("Storage swap candidate at %s", name),
			Hypothesis:      fmt.Sprintf("%s shows storage/liquid-bulk infrastructure and recent movement signals. Treat as an inferred swap/sale lead, not confirmed available inventory.", name),
			Confidence:      maxFloat(0.55, minFloat(0.88, dealScore+0.05)),
			Evidence:        evidence,
			ProfitChecklist: defaultProfitChecklist,
			Fingerprint:     "deal-radar:storage:" + tid.String(),
			DealScore:       dealScore,
			Signal: signalPayload(
				TypeStorageArb,
				scoreInput,
				commodity,
				evidence,
				[]map[string]any{{"role": "operator", "name": operatorName, "tier": "inferred"}},
				[]map[string]any{{"terminal_id": tid.String(), "name": name, "type": terminalType, "tier": "inferred"}},
			),
			RoutePrefill: map[string]any{
				"terminal_id":      tid.String(),
				"load_port_name":   firstNonEmpty(port, name),
				"load_country":     country,
				"commodity_family": commodity,
				"opportunity_type": TypeStorageArb,
			},
			SourceTiers: sourceTiers(sourceTierValues...),
			FreshnessAt: freshness,
		})
		if err != nil {
			return n, err
		}
		if inserted {
			n++
		}
	}
	return n, rows.Err()
}

func scanSupplierBuyerRoutes(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	limit := scanBatchLimit()
	rows, err := pool.Query(ctx, `
		SELECT
			m.id, m.commodity_family, COALESCE(m.confidence, 0.5)::float8, COALESCE(m.triangulation_score, 0)::int,
			COALESCE(m.shipper_name, ''), COALESCE(m.consignee_name, ''), m.shipper_company_id, m.consignee_company_id,
			COALESCE(m.vessel_name, ''), m.mmsi, m.load_terminal_id,
			COALESCE(t.name, m.load_port_name, ''), COALESCE(m.load_country, t.country, ''),
			COALESCE(m.discharge_hint, ''), COALESCE(m.discharge_country, ''),
			m.corridor_load_lat, m.corridor_load_lng, m.corridor_discharge_lat, m.corridor_discharge_lng,
			COALESCE(m.event_date, m.created_at) AS freshness_at,
			COALESCE(jsonb_array_length(m.sources), 0) + COALESCE(jsonb_array_length(m.evidence_chain), 0) AS source_count
		FROM meridian_cargo_records m
		LEFT JOIN oil_terminals t ON t.id = m.load_terminal_id
		WHERE COALESCE(m.confidence, 0) >= 0.55
		  AND (
		    m.corridor_load_lat IS NOT NULL
		    OR m.load_terminal_id IS NOT NULL
		    OR m.load_port_name IS NOT NULL
		  )
		  AND (m.shipper_name IS NOT NULL OR m.consignee_name IS NOT NULL OR m.discharge_hint IS NOT NULL)
		ORDER BY COALESCE(m.event_date, m.created_at) DESC, COALESCE(m.confidence, 0.5) DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var mcrID uuid.UUID
		var family, shipper, consignee, vessel, loadPort, loadCountry, discharge, dischargeCountry string
		var conf float64
		var tri, sourceCount int
		var shipperID, consigneeID, terminalID *uuid.UUID
		var mmsi *int64
		var loadLat, loadLng, discLat, discLng *float64
		var freshness *time.Time
		if err := rows.Scan(&mcrID, &family, &conf, &tri, &shipper, &consignee, &shipperID, &consigneeID, &vessel, &mmsi, &terminalID, &loadPort, &loadCountry, &discharge, &dischargeCountry, &loadLat, &loadLng, &discLat, &discLng, &freshness, &sourceCount); err != nil {
			return n, err
		}
		evidence := []string{
			"MCR links cargo-like movement, counterparty hints, and route context",
			fmt.Sprintf("Triangulation score: %d source signals", tri),
			"Open-data hypothesis — verify source chain and commercial terms",
		}
		if shipper != "" && consignee != "" {
			evidence = append(evidence, fmt.Sprintf("Counterparty pair candidate: %s → %s", shipper, consignee))
		}
		scoreInput := DealScoreInput{
			MovementActivity:    conf,
			InfrastructureFit:   scoreBool(terminalID != nil, 0.68, 0.42),
			CounterpartyClarity: scoreBool(shipper != "" && consignee != "", 0.85, scoreBool(shipper != "" || consignee != "", 0.55, 0.25)),
			MacroSupport:        minFloat(1, float64(maxInt(tri, sourceCount))/5),
			RouteReadiness:      scoreBool(loadLat != nil && loadLng != nil && discLat != nil && discLng != nil, 0.9, scorePresentString(loadPort, 0.55, 0.25)),
			Provenance:          minFloat(0.9, 0.42+float64(sourceCount)*0.08),
		}
		dealScore := ScoreDeal(scoreInput)
		input := opportunityInput{
			Type:            TypeRouteCandidate,
			MMSI:            mmsi,
			TerminalID:      terminalID,
			CompanyID:       firstUUIDPtr(shipperID, consigneeID),
			Title:           fmt.Sprintf("%s route candidate: %s → %s", titleCommodity(family), firstNonEmpty(loadPort, shipper, "origin"), firstNonEmpty(discharge, consignee, "buyer")),
			Hypothesis:      "Stored MCR evidence suggests a supplier-buyer route worth pricing. This is a synthetic/inferred lead, not a confirmed BOL or offer.",
			Confidence:      maxFloat(0.55, minFloat(0.9, conf)),
			Evidence:        evidence,
			ProfitChecklist: defaultProfitChecklist,
			Fingerprint:     "deal-radar:mcr-route:" + mcrID.String(),
			DealScore:       dealScore,
			Signal: signalPayload(
				TypeRouteCandidate,
				scoreInput,
				family,
				evidence,
				[]map[string]any{
					{"role": "shipper", "name": shipper, "company_id": uuidPtrString(shipperID), "tier": "synthetic"},
					{"role": "consignee", "name": consignee, "company_id": uuidPtrString(consigneeID), "tier": "synthetic"},
				},
				[]map[string]any{{"terminal_id": uuidPtrString(terminalID), "name": loadPort, "country": loadCountry, "tier": "inferred"}},
			),
			RoutePrefill: map[string]any{
				"load_port_name":      loadPort,
				"load_country":        loadCountry,
				"discharge_port_name": discharge,
				"discharge_country":   dischargeCountry,
				"load_lat":            floatPtrValue(loadLat),
				"load_lng":            floatPtrValue(loadLng),
				"discharge_lat":       floatPtrValue(discLat),
				"discharge_lng":       floatPtrValue(discLng),
				"commodity_family":    family,
				"opportunity_type":    TypeRouteCandidate,
				"source_mcr_id":       mcrID.String(),
				"vessel_name":         vessel,
				"mmsi":                int64PtrValue(mmsi),
			},
			SourceTiers: sourceTiers("synthetic", "macro", "inferred"),
			FreshnessAt: freshness,
		}
		oppID, inserted, err := upsertOpportunity(ctx, pool, input)
		if err != nil {
			return n, err
		}
		if oppID != uuid.Nil {
			_, _ = pool.Exec(ctx, `
				UPDATE meridian_cargo_records
				SET opportunity_id = $1, updated_at = now()
				WHERE id = $2 AND (opportunity_id IS NULL OR opportunity_id = $1)
			`, oppID, mcrID)
		}
		if inserted {
			n++
		}
	}
	return n, rows.Err()
}

func upsertOpportunity(ctx context.Context, pool *pgxpool.Pool, in opportunityInput) (uuid.UUID, bool, error) {
	if in.Type == "" || in.Title == "" {
		return uuid.Nil, false, fmt.Errorf("opportunity type and title are required")
	}
	if in.Fingerprint == "" {
		in.Fingerprint = fallbackFingerprint(in)
	}
	if in.DealScore <= 0 {
		in.DealScore = ScoreDeal(DealScoreInput{MovementActivity: in.Confidence, InfrastructureFit: 0.4, Provenance: 0.4})
	}
	if len(in.ProfitChecklist) == 0 {
		in.ProfitChecklist = defaultProfitChecklist
	}
	if len(in.SourceTiers) == 0 {
		in.SourceTiers = sourceTiers("inferred")
	}
	if in.FreshnessAt == nil {
		in.FreshnessAt = ptrTime(time.Now().UTC())
	}
	if in.ExpiresAfterDays <= 0 {
		in.ExpiresAfterDays = 30
	}

	evidence, _ := json.Marshal(in.Evidence)
	checklist, _ := json.Marshal(in.ProfitChecklist)
	signal, _ := json.Marshal(in.Signal)
	route, _ := json.Marshal(in.RoutePrefill)

	var existing uuid.UUID
	err := pool.QueryRow(ctx, `
		SELECT id
		FROM oil_opportunities
		WHERE status = 'open'
		  AND (
		    fingerprint = $1
		    OR (
		      opportunity_type = $2
		      AND (
		        ($3::bigint IS NOT NULL AND mmsi = $3)
		        OR ($4::uuid IS NOT NULL AND terminal_id = $4)
		      )
		    )
		  )
		ORDER BY updated_at DESC NULLS LAST, created_at DESC
		LIMIT 1
	`, in.Fingerprint, in.Type, in.MMSI, in.TerminalID).Scan(&existing)
	if err == nil {
		_, updateErr := pool.Exec(ctx, `
			UPDATE oil_opportunities
			SET mmsi = COALESCE($2, mmsi),
			    terminal_id = COALESCE($3, terminal_id),
			    port_call_id = COALESCE($4, port_call_id),
			    company_id = COALESCE($5, company_id),
			    title = $6,
			    hypothesis = $7,
			    confidence = $8,
			    evidence = $9,
			    profit_checklist = $10,
			    fingerprint = $11,
			    deal_score = $12,
			    signal_json = $13,
			    route_prefill_json = $14,
			    source_tiers = $15,
			    freshness_at = $16,
			    expires_at = now() + ($17::text || ' days')::interval,
			    updated_at = now()
			WHERE id = $1
		`, existing, in.MMSI, in.TerminalID, in.PortCallID, in.CompanyID, in.Title, in.Hypothesis, in.Confidence, evidence, checklist, in.Fingerprint, in.DealScore, signal, route, in.SourceTiers, in.FreshnessAt, in.ExpiresAfterDays)
		return existing, false, updateErr
	}

	var id uuid.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO oil_opportunities (
			opportunity_type, mmsi, terminal_id, port_call_id, company_id,
			title, hypothesis, confidence, evidence, profit_checklist,
			fingerprint, deal_score, signal_json, route_prefill_json, source_tiers, freshness_at, expires_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now() + ($17::text || ' days')::interval)
		RETURNING id
	`, in.Type, in.MMSI, in.TerminalID, in.PortCallID, in.CompanyID, in.Title, in.Hypothesis, in.Confidence, evidence, checklist, in.Fingerprint, in.DealScore, signal, route, in.SourceTiers, in.FreshnessAt, in.ExpiresAfterDays).Scan(&id)
	return id, err == nil, err
}

func scorePresentString(value string, yes, no float64) float64 {
	if strings.TrimSpace(value) == "" {
		return no
	}
	return yes
}

func scoreBool(ok bool, yes, no float64) float64 {
	if ok {
		return yes
	}
	return no
}

func firstProduct(products []string) string {
	for _, product := range products {
		p := strings.TrimSpace(product)
		if p != "" {
			return p
		}
	}
	return ""
}

func inferCommodityFromTerminalType(terminalType string) string {
	t := strings.ToLower(terminalType)
	switch {
	case strings.Contains(t, "lng"):
		return "lng"
	case strings.Contains(t, "lpg"):
		return "lpg"
	case strings.Contains(t, "refin"):
		return "refined_products"
	default:
		return "petroleum_products"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func titleCommodity(value string) string {
	v := strings.TrimSpace(value)
	if v == "" {
		return "Product"
	}
	return strings.ToUpper(v[:1]) + v[1:]
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func ptrTime(t time.Time) *time.Time {
	return &t
}

func firstUUIDPtr(values ...*uuid.UUID) *uuid.UUID {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func uuidPtrString(value *uuid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
}

func floatPtrValue(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func int64PtrValue(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func fallbackFingerprint(in opportunityInput) string {
	parts := []string{"deal-radar", in.Type}
	if in.TerminalID != nil {
		parts = append(parts, "terminal", in.TerminalID.String())
	}
	if in.MMSI != nil {
		parts = append(parts, "mmsi", strconv.FormatInt(*in.MMSI, 10))
	}
	if in.CompanyID != nil {
		parts = append(parts, "company", in.CompanyID.String())
	}
	if len(parts) == 2 {
		parts = append(parts, "title", normalizeTitle(in.Title))
	}
	return strings.Join(parts, ":")
}

func firstSignalKind(signal map[string]any, fallback string) string {
	if signal == nil {
		return fallback
	}
	if kind, ok := signal["signal_kind"].(string); ok && strings.TrimSpace(kind) != "" {
		return kind
	}
	return fallback
}

func signalSlice(signal map[string]any, key string) []any {
	if signal == nil {
		return []any{}
	}
	if values, ok := signal[key].([]any); ok {
		return values
	}
	return []any{}
}

type ListFilters struct {
	MinConfidence float64
	MinDealScore  float64
	Limit         int
	ExcludeDemo   bool
	DealSignal    string
	Commodity     string
}

// List returns open opportunities. When excludeDemo is true, filters demo/seed rows.
func List(ctx context.Context, pool *pgxpool.Pool, minConf float64, limit int, excludeDemo bool) ([]map[string]any, error) {
	return ListFiltered(ctx, pool, ListFilters{
		MinConfidence: minConf,
		Limit:         limit,
		ExcludeDemo:   excludeDemo,
	})
}

func ListFiltered(ctx context.Context, pool *pgxpool.Pool, filters ListFilters) ([]map[string]any, error) {
	if filters.Limit <= 0 {
		filters.Limit = 50
	}
	commodityLike := ""
	if strings.TrimSpace(filters.Commodity) != "" && strings.TrimSpace(filters.Commodity) != "all" {
		commodityLike = "%" + strings.TrimSpace(filters.Commodity) + "%"
	}
	rows, err := pool.Query(ctx, `
		SELECT o.id, o.opportunity_type, o.title, o.hypothesis, o.confidence, o.evidence, o.profit_checklist,
			o.mmsi, o.terminal_id::text, t.name AS terminal_name, t.country AS terminal_country, o.created_at,
			COALESCE(o.deal_score, o.confidence)::float8 AS deal_score,
			COALESCE(o.signal_json, '{}'::jsonb) AS signal_json,
			COALESCE(o.route_prefill_json, '{}'::jsonb) AS route_prefill_json,
			COALESCE(o.source_tiers, ARRAY['synthetic']::text[]) AS source_tiers,
			o.freshness_at
		FROM oil_opportunities o
		LEFT JOIN oil_terminals t ON t.id = o.terminal_id
		WHERE o.status='open' AND o.confidence >= $1
		  AND COALESCE(o.deal_score, o.confidence) >= $4
		  AND (
		    $5 = ''
		    OR o.opportunity_type = $5
		    OR COALESCE(o.signal_json->>'signal_kind', '') = $5
		  )
		  AND (
		    $6 = ''
		    OR COALESCE(o.signal_json->>'commodity_family', '') ILIKE $6
		    OR COALESCE(o.route_prefill_json->>'commodity_family', '') ILIKE $6
		  )
		  AND (
		    $3 = false
		    OR (
		      (o.mmsi IS NULL OR o.mmsi <> 636012345)
		      AND o.title NOT ILIKE '%DEMO%'
		      AND COALESCE(o.hypothesis, '') NOT ILIKE '%DEMO%'
		      AND NOT EXISTS (
		        SELECT 1 FROM oil_port_calls pc
		        WHERE pc.id = o.port_call_id
		          AND (
		            COALESCE(pc.evidence::text, '') ILIKE '%seed_port_calls%'
		            OR COALESCE(pc.metadata::text, '') ILIKE '%seed_port_calls%'
		            OR pc.vessel_name ILIKE '%DEMO%'
		          )
		      )
		    )
		  )
		ORDER BY COALESCE(o.deal_score, o.confidence) DESC, o.confidence DESC, o.created_at DESC
		LIMIT $2
	`, filters.MinConfidence, filters.Limit, filters.ExcludeDemo, filters.MinDealScore, strings.TrimSpace(filters.DealSignal), commodityLike)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var otype, title, hyp string
		var conf float64
		var ev, pc []byte
		var mmsi *int64
		var tid *string
		var tname, tcountry *string
		var created time.Time
		var dealScore float64
		var signalJSON, routeJSON []byte
		var tiers []string
		var freshness *time.Time
		if err := rows.Scan(&id, &otype, &title, &hyp, &conf, &ev, &pc, &mmsi, &tid, &tname, &tcountry, &created, &dealScore, &signalJSON, &routeJSON, &tiers, &freshness); err != nil {
			return nil, err
		}
		var evA, pcA []any
		_ = json.Unmarshal(ev, &evA)
		_ = json.Unmarshal(pc, &pcA)
		var signal map[string]any
		var route map[string]any
		_ = json.Unmarshal(signalJSON, &signal)
		_ = json.Unmarshal(routeJSON, &route)
		row := map[string]any{
			"id": id.String(), "opportunity_type": otype, "title": title, "hypothesis": hyp,
			"confidence": conf, "evidence": evA, "profit_checklist": pcA,
			"mmsi": mmsi, "terminal_name": tname, "terminal_country": tcountry, "created_at": created,
			"deal_score":           dealScore,
			"signal":               signal,
			"signal_kind":          firstSignalKind(signal, otype),
			"route_prefill":        route,
			"source_tiers":         tiers,
			"freshness_at":         freshness,
			"recommended_actions":  signalSlice(signal, "recommended_actions"),
			"counterparty_hints":   signalSlice(signal, "counterparty_hints"),
			"infrastructure_hints": signalSlice(signal, "infrastructure_hints"),
			"disclaimer":           "Hypothesis from public data — not a confirmed transaction or listing.",
		}
		if tid != nil && *tid != "" {
			row["terminal_id"] = *tid
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
