package sts

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	EnrichmentNone    = "none"
	EnrichmentPartial = "partial"
	EnrichmentLinked  = "linked"

	DefaultPortCallWindowDays = 7
)

// EventInput is the minimal STS event shape needed for on-read enrichment.
type EventInput struct {
	ID       uuid.UUID
	MMSIA    int64
	MMSIB    int64
	StartTS  time.Time
	EndTS    time.Time
	ZoneName string
}

// LinkedPortCall is a port visit near an STS window (evidence, not cargo proof).
type LinkedPortCall struct {
	ID                    string   `json:"id"`
	MMSI                  int64    `json:"mmsi"`
	VesselRole            string   `json:"vessel_role"`
	TerminalName          *string  `json:"terminal_name,omitempty"`
	ArrivalTS             *string  `json:"arrival_ts,omitempty"`
	DepartureTS           *string  `json:"departure_ts,omitempty"`
	EventType             *string  `json:"event_type,omitempty"`
	ProductFamilyInferred *string  `json:"product_family_inferred,omitempty"`
	Confidence            *float64 `json:"confidence,omitempty"`
	DataProvenance        string   `json:"data_provenance"`
	Disclaimer            string   `json:"disclaimer"`
}

// CargoHypothesis is a synthetic/inferred MCR near an STS window — not a legal BOL.
type CargoHypothesis struct {
	ID                 string  `json:"id"`
	SyntheticBOLID     string  `json:"synthetic_bol_id"`
	MMSI               int64   `json:"mmsi"`
	VesselRole         string  `json:"vessel_role"`
	Recipe             string  `json:"recipe"`
	CommodityFamily    string  `json:"commodity_family"`
	BOLTier            string  `json:"bol_tier"`
	Confidence         float64 `json:"confidence"`
	TriangulationScore int     `json:"triangulation_score"`
	LoadCountry        *string `json:"load_country,omitempty"`
	DischargeCountry   *string `json:"discharge_country,omitempty"`
	EventDate          *string `json:"event_date,omitempty"`
	Disclaimer         string  `json:"disclaimer"`
}

// EnrichmentResult is computed on read; not persisted unless analyst verification is PATCHed.
type EnrichmentResult struct {
	LinkedPortCalls  []LinkedPortCall  `json:"linked_port_calls"`
	CargoHypotheses  []CargoHypothesis `json:"cargo_hypotheses"`
	EnrichmentStatus string            `json:"enrichment_status"`
	ZoneName         string            `json:"zone_name,omitempty"`
}

// EnrichConfig tunes the port-call / MCR lookup window.
type EnrichConfig struct {
	PortCallWindowDays int
}

// DefaultEnrichConfig returns ±7 day linkage window.
func DefaultEnrichConfig() EnrichConfig {
	return EnrichConfig{PortCallWindowDays: DefaultPortCallWindowDays}
}

// ComputeEnrichmentStatus derives none/partial/linked from linkage counts.
func ComputeEnrichmentStatus(portCalls []LinkedPortCall, cargo []CargoHypothesis, mmsiA, mmsiB int64) string {
	hasA := linkageForMMSI(portCalls, cargo, mmsiA)
	hasB := linkageForMMSI(portCalls, cargo, mmsiB)
	if hasA && hasB {
		return EnrichmentLinked
	}
	if hasA || hasB || len(portCalls) > 0 || len(cargo) > 0 {
		return EnrichmentPartial
	}
	return EnrichmentNone
}

func linkageForMMSI(portCalls []LinkedPortCall, cargo []CargoHypothesis, mmsi int64) bool {
	for _, pc := range portCalls {
		if pc.MMSI == mmsi {
			return true
		}
	}
	for _, c := range cargo {
		if c.MMSI == mmsi {
			return true
		}
	}
	return false
}

// EnrichEvents batch-enriches STS events on read.
func EnrichEvents(ctx context.Context, pool *pgxpool.Pool, events []EventInput, cfg EnrichConfig) (map[uuid.UUID]EnrichmentResult, error) {
	out := make(map[uuid.UUID]EnrichmentResult, len(events))
	if pool == nil || len(events) == 0 {
		return out, nil
	}
	if cfg.PortCallWindowDays <= 0 {
		cfg.PortCallWindowDays = DefaultPortCallWindowDays
	}
	window := time.Duration(cfg.PortCallWindowDays) * 24 * time.Hour

	mmsiSet := make(map[int64]struct{})
	var minFrom, maxTo time.Time
	for i, e := range events {
		mmsiSet[e.MMSIA] = struct{}{}
		mmsiSet[e.MMSIB] = struct{}{}
		from := e.StartTS.Add(-window)
		to := e.EndTS.Add(window)
		if i == 0 || from.Before(minFrom) {
			minFrom = from
		}
		if i == 0 || to.After(maxTo) {
			maxTo = to
		}
	}
	mmsis := make([]int64, 0, len(mmsiSet))
	for m := range mmsiSet {
		mmsis = append(mmsis, m)
	}

	portByMMSi, err := loadPortCallsInRange(ctx, pool, mmsis, minFrom, maxTo)
	if err != nil {
		return nil, err
	}
	cargoByMMSi, err := loadCargoHypothesesInRange(ctx, pool, mmsis, minFrom, maxTo)
	if err != nil {
		return nil, err
	}

	for _, e := range events {
		from := e.StartTS.Add(-window)
		to := e.EndTS.Add(window)
		linkedPC := matchPortCalls(e.MMSIA, e.MMSIB, from, to, portByMMSi)
		linkedCargo := matchCargoHypotheses(e.MMSIA, e.MMSIB, from, to, cargoByMMSi)
		out[e.ID] = EnrichmentResult{
			LinkedPortCalls:  linkedPC,
			CargoHypotheses:  linkedCargo,
			EnrichmentStatus: ComputeEnrichmentStatus(linkedPC, linkedCargo, e.MMSIA, e.MMSIB),
			ZoneName:         e.ZoneName,
		}
	}
	return out, nil
}

type portCallRow struct {
	ID                    uuid.UUID
	MMSI                  int64
	TerminalName          *string
	ArrivalTS             *time.Time
	DepartureTS           *time.Time
	EventType             *string
	ProductFamilyInferred *string
	Confidence            *float64
	Evidence              []byte
	Metadata              []byte
}

func loadPortCallsInRange(ctx context.Context, pool *pgxpool.Pool, mmsis []int64, from, to time.Time) (map[int64][]portCallRow, error) {
	out := make(map[int64][]portCallRow)
	if len(mmsis) == 0 {
		return out, nil
	}
	exists, err := tableExists(ctx, pool, "oil_port_calls")
	if err != nil || !exists {
		return out, err
	}
	rows, err := pool.Query(ctx, `
		SELECT pc.id, pc.mmsi, t.name,
			pc.arrival_ts, pc.departure_ts, pc.event_type,
			pc.product_family_inferred, pc.confidence, pc.evidence, pc.metadata
		FROM oil_port_calls pc
		LEFT JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.mmsi = ANY($1)
			AND COALESCE(pc.departure_ts, pc.arrival_ts, pc.created_at) >= $2
			AND COALESCE(pc.arrival_ts, pc.departure_ts, pc.created_at) <= $3
	`, mmsis, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var row portCallRow
		if err := rows.Scan(
			&row.ID, &row.MMSI, &row.TerminalName,
			&row.ArrivalTS, &row.DepartureTS, &row.EventType,
			&row.ProductFamilyInferred, &row.Confidence, &row.Evidence, &row.Metadata,
		); err != nil {
			return nil, err
		}
		out[row.MMSI] = append(out[row.MMSI], row)
	}
	return out, rows.Err()
}

type cargoRow struct {
	ID                 uuid.UUID
	SyntheticBOLID     string
	MMSI               int64
	Recipe             string
	CommodityFamily    string
	BOLTier            string
	Confidence         float64
	TriangulationScore int
	LoadCountry        *string
	DischargeCountry   *string
	EventDate          *time.Time
}

func loadCargoHypothesesInRange(ctx context.Context, pool *pgxpool.Pool, mmsis []int64, from, to time.Time) (map[int64][]cargoRow, error) {
	out := make(map[int64][]cargoRow)
	if len(mmsis) == 0 {
		return out, nil
	}
	exists, err := tableExists(ctx, pool, "meridian_cargo_records")
	if err != nil || !exists {
		return out, err
	}
	rows, err := pool.Query(ctx, `
		SELECT m.id, m.synthetic_bol_id, COALESCE(m.mmsi, m.corridor_mmsi, 0),
			m.recipe, m.commodity_family, COALESCE(m.bol_tier, 'synthetic'),
			m.confidence, COALESCE(m.triangulation_score, 0),
			m.load_country, m.discharge_country, m.event_date
		FROM meridian_cargo_records m
		WHERE (m.mmsi = ANY($1) OR m.corridor_mmsi = ANY($1))
			AND m.event_date IS NOT NULL
			AND m.event_date >= $2 AND m.event_date <= $3
	`, mmsis, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var row cargoRow
		if err := rows.Scan(
			&row.ID, &row.SyntheticBOLID, &row.MMSI,
			&row.Recipe, &row.CommodityFamily, &row.BOLTier,
			&row.Confidence, &row.TriangulationScore,
			&row.LoadCountry, &row.DischargeCountry, &row.EventDate,
		); err != nil {
			return nil, err
		}
		if row.MMSI == 0 {
			continue
		}
		out[row.MMSI] = append(out[row.MMSI], row)
	}
	return out, rows.Err()
}

func matchPortCalls(mmsiA, mmsiB int64, from, to time.Time, byMMSI map[int64][]portCallRow) []LinkedPortCall {
	seen := make(map[string]struct{})
	var out []LinkedPortCall
	for _, mmsi := range []int64{mmsiA, mmsiB} {
		role := "vessel_a"
		if mmsi == mmsiB {
			role = "vessel_b"
		}
		for _, row := range byMMSI[mmsi] {
			if !portCallOverlaps(row, from, to) {
				continue
			}
			key := row.ID.String()
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, portCallToLinked(row, role))
		}
	}
	return out
}

func portCallOverlaps(row portCallRow, from, to time.Time) bool {
	start := row.ArrivalTS
	end := row.DepartureTS
	if start == nil {
		start = row.DepartureTS
	}
	if end == nil {
		end = row.ArrivalTS
	}
	if start == nil && end == nil {
		return true
	}
	if start != nil && end != nil {
		return !end.Before(from) && !start.After(to)
	}
	if start != nil {
		return !start.Before(from) && !start.After(to)
	}
	return !end.Before(from) && !end.After(to)
}

func portCallToLinked(row portCallRow, role string) LinkedPortCall {
	provenance := inferPortCallProvenance(row.Evidence, row.Metadata)
	item := LinkedPortCall{
		ID:                    row.ID.String(),
		MMSI:                  row.MMSI,
		VesselRole:            role,
		TerminalName:          row.TerminalName,
		EventType:             row.EventType,
		ProductFamilyInferred: row.ProductFamilyInferred,
		Confidence:            row.Confidence,
		DataProvenance:        provenance,
		Disclaimer:            "Terminal visit inferred from AIS geofence — not proof of STS cargo transfer.",
	}
	if row.ArrivalTS != nil {
		s := row.ArrivalTS.UTC().Format(time.RFC3339)
		item.ArrivalTS = &s
	}
	if row.DepartureTS != nil {
		s := row.DepartureTS.UTC().Format(time.RFC3339)
		item.DepartureTS = &s
	}
	return item
}

func inferPortCallProvenance(evidence, metadata []byte) string {
	text := strings.ToLower(string(evidence) + string(metadata))
	switch {
	case strings.Contains(text, "seed_port_calls"):
		return "seed_port_calls"
	case strings.Contains(text, "live_ais"):
		return "live_ais"
	default:
		return "inferred"
	}
}

func matchCargoHypotheses(mmsiA, mmsiB int64, from, to time.Time, byMMSI map[int64][]cargoRow) []CargoHypothesis {
	seen := make(map[string]struct{})
	var out []CargoHypothesis
	for _, mmsi := range []int64{mmsiA, mmsiB} {
		role := "vessel_a"
		if mmsi == mmsiB {
			role = "vessel_b"
		}
		for _, row := range byMMSI[mmsi] {
			if row.EventDate == nil || row.EventDate.Before(from) || row.EventDate.After(to) {
				continue
			}
			key := row.ID.String()
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, cargoToHypothesis(row, role))
		}
	}
	return out
}

func cargoToHypothesis(row cargoRow, role string) CargoHypothesis {
	item := CargoHypothesis{
		ID:                 row.ID.String(),
		SyntheticBOLID:     row.SyntheticBOLID,
		MMSI:               row.MMSI,
		VesselRole:         role,
		Recipe:             row.Recipe,
		CommodityFamily:    row.CommodityFamily,
		BOLTier:            row.BOLTier,
		Confidence:         row.Confidence,
		TriangulationScore: row.TriangulationScore,
		LoadCountry:        row.LoadCountry,
		DischargeCountry:   row.DischargeCountry,
		Disclaimer:         "Synthetic/inferred cargo hypothesis — not a carrier BOL or confirmed STS transfer.",
	}
	if row.EventDate != nil {
		s := row.EventDate.UTC().Format(time.RFC3339)
		item.EventDate = &s
	}
	return item
}

func tableExists(ctx context.Context, pool *pgxpool.Pool, tableName string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1
		)
	`, tableName).Scan(&exists)
	return exists, err
}

// VerificationMeta holds analyst verification stored in event metadata jsonb.
type VerificationMeta struct {
	VerifiedBy        string
	VerifiedAt        time.Time
	VerificationNotes string
}

// ParseVerificationMeta extracts analyst verification from metadata when status is verified.
func ParseVerificationMeta(status string, metadata map[string]any) *VerificationMeta {
	if status != "verified" || metadata == nil {
		return nil
	}
	vm := &VerificationMeta{}
	if v, ok := metadata["verified_by"].(string); ok {
		vm.VerifiedBy = v
	}
	if v, ok := metadata["verification_notes"].(string); ok {
		vm.VerificationNotes = v
	}
	if v, ok := metadata["verified_at"].(string); ok {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			vm.VerifiedAt = t
		}
	}
	if vm.VerifiedBy == "" && vm.VerificationNotes == "" && vm.VerifiedAt.IsZero() {
		return nil
	}
	return vm
}
