package syntheticbol

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Record struct {
	ID                   uuid.UUID
	SyntheticBOLID       string
	Fingerprint          string
	Recipe               string
	CommodityFamily      string
	Confidence           float64
	TriangulationScore   int
	BOLTier              string
	ShipperName          *string
	ConsigneeName        *string
	ShipperCompanyID     *uuid.UUID
	ConsigneeCompanyID   *uuid.UUID
	VesselName           *string
	MMSI                 *int64
	IMO                  *string
	LoadTerminalID       *uuid.UUID
	LoadPortName         *string
	LoadCountry          *string
	DischargeHint        *string
	DischargeCountry     *string
	CommodityDescription *string
	VolumeLow            *float64
	VolumeHigh           *float64
	VolumeBestEstimate   *float64
	VolumeMethod         *string
	VolumeUnit           string
	EventDate            *time.Time
	PortCallID           *uuid.UUID
	CommercialEventID    *uuid.UUID
	OpportunityID        *uuid.UUID
	CorridorMMSI         *int64
	CorridorLoadLat      *float64
	CorridorLoadLng      *float64
	CorridorDischargeLat *float64
	CorridorDischargeLng *float64
	EvidenceChain        []any
	Sources              []any
	ContactIDs           []uuid.UUID
	Metadata             map[string]any
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type ListFilters struct {
	Commodity      string
	Country        string
	MMSI           int64
	MinConfidence  float64
	OpportunityID  uuid.UUID
	Limit          int
}

func List(ctx context.Context, pool *pgxpool.Pool, f ListFilters) ([]map[string]any, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	q := `
		SELECT id, synthetic_bol_id, recipe, commodity_family, confidence, triangulation_score,
			bol_tier, shipper_name, consignee_name, vessel_name, mmsi, load_port_name, load_country,
			discharge_hint, discharge_country, volume_best_estimate, volume_unit, event_date, created_at
		FROM meridian_cargo_records WHERE confidence >= $1
	`
	args := []any{f.MinConfidence}
	n := 2
	if f.Commodity != "" {
		q += fmt.Sprintf(` AND commodity_family = $%d`, n)
		args = append(args, f.Commodity)
		n++
	}
	if f.Country != "" {
		q += fmt.Sprintf(` AND (load_country ILIKE $%d OR discharge_country ILIKE $%d)`, n, n)
		args = append(args, "%"+f.Country+"%")
		n++
	}
	if f.MMSI > 0 {
		q += fmt.Sprintf(` AND mmsi = $%d`, n)
		args = append(args, f.MMSI)
		n++
	}
	if f.OpportunityID != uuid.Nil {
		q += fmt.Sprintf(` AND opportunity_id = $%d`, n)
		args = append(args, f.OpportunityID)
		n++
	}
	q += fmt.Sprintf(` ORDER BY confidence DESC, event_date DESC NULLS LAST LIMIT $%d`, n)
	args = append(args, limit)

	rows, err := pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		item, err := scanListRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func Get(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (map[string]any, error) {
	row := pool.QueryRow(ctx, `
		SELECT id, synthetic_bol_id, fingerprint, recipe, commodity_family, confidence, triangulation_score,
			bol_tier, shipper_name, consignee_name, shipper_company_id, consignee_company_id,
			vessel_name, mmsi, imo, load_terminal_id, load_port_name, load_country,
			discharge_hint, discharge_country, commodity_description,
			volume_low, volume_high, volume_best_estimate, volume_method, volume_unit,
			event_date, port_call_id, commercial_event_id, opportunity_id,
			corridor_mmsi, corridor_load_lat, corridor_load_lng, corridor_discharge_lat, corridor_discharge_lng,
			evidence_chain, sources, contact_ids, metadata, created_at, updated_at
		FROM meridian_cargo_records WHERE id = $1
	`, id)
	rec, err := scanFullRow(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("cargo record not found")
		}
		return nil, err
	}
	return recordToMap(rec), nil
}

func scanListRow(rows pgx.Rows) (map[string]any, error) {
	var id uuid.UUID
	var synID, recipe, family, tier string
	var conf float64
	var tri int
	var shipper, consignee, vessel, loadPort, loadCountry, dischargeHint, dischargeCountry *string
	var mmsi *int64
	var volBest *float64
	var volUnit *string
	var eventDate *time.Time
	var created time.Time
	if err := rows.Scan(
		&id, &synID, &recipe, &family, &conf, &tri, &tier,
		&shipper, &consignee, &vessel, &mmsi, &loadPort, &loadCountry,
		&dischargeHint, &dischargeCountry, &volBest, &volUnit, &eventDate, &created,
	); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id.String(), "synthetic_bol_id": synID, "recipe": recipe,
		"commodity_family": family, "confidence": conf, "triangulation_score": tri,
		"bol_tier": tier, "shipper_name": shipper, "consignee_name": consignee,
		"vessel_name": vessel, "mmsi": mmsi, "load_port_name": loadPort,
		"load_country": loadCountry, "discharge_hint": dischargeHint,
		"discharge_country": dischargeCountry, "volume_best_estimate": volBest,
		"volume_unit": volUnit, "event_date": eventDate, "created_at": created,
		"disclaimer": "Synthetic cargo record — inferred from public sources, not a carrier BOL.",
	}, nil
}

func scanFullRow(row pgx.Row) (Record, error) {
	var rec Record
	var shipperCID, consigneeCID, loadTermID, pcID, ceID, oppID *uuid.UUID
	var evidence, sources []byte
	var contactIDs []uuid.UUID
	var meta []byte
	err := row.Scan(
		&rec.ID, &rec.SyntheticBOLID, &rec.Fingerprint, &rec.Recipe, &rec.CommodityFamily,
		&rec.Confidence, &rec.TriangulationScore, &rec.BOLTier,
		&rec.ShipperName, &rec.ConsigneeName, &shipperCID, &consigneeCID,
		&rec.VesselName, &rec.MMSI, &rec.IMO, &loadTermID, &rec.LoadPortName, &rec.LoadCountry,
		&rec.DischargeHint, &rec.DischargeCountry, &rec.CommodityDescription,
		&rec.VolumeLow, &rec.VolumeHigh, &rec.VolumeBestEstimate, &rec.VolumeMethod, &rec.VolumeUnit,
		&rec.EventDate, &pcID, &ceID, &oppID,
		&rec.CorridorMMSI, &rec.CorridorLoadLat, &rec.CorridorLoadLng,
		&rec.CorridorDischargeLat, &rec.CorridorDischargeLng,
		&evidence, &sources, &contactIDs, &meta, &rec.CreatedAt, &rec.UpdatedAt,
	)
	if err != nil {
		return rec, err
	}
	rec.ShipperCompanyID = shipperCID
	rec.ConsigneeCompanyID = consigneeCID
	rec.LoadTerminalID = loadTermID
	rec.PortCallID = pcID
	rec.CommercialEventID = ceID
	rec.OpportunityID = oppID
	_ = json.Unmarshal(evidence, &rec.EvidenceChain)
	_ = json.Unmarshal(sources, &rec.Sources)
	rec.ContactIDs = contactIDs
	_ = json.Unmarshal(meta, &rec.Metadata)
	return rec, nil
}

func recordToMap(rec Record) map[string]any {
	out := map[string]any{
		"id": rec.ID.String(), "synthetic_bol_id": rec.SyntheticBOLID, "fingerprint": rec.Fingerprint,
		"recipe": rec.Recipe, "commodity_family": rec.CommodityFamily,
		"confidence": rec.Confidence, "triangulation_score": rec.TriangulationScore,
		"bol_tier": rec.BOLTier, "shipper_name": rec.ShipperName, "consignee_name": rec.ConsigneeName,
		"vessel_name": rec.VesselName, "mmsi": rec.MMSI, "imo": rec.IMO,
		"load_port_name": rec.LoadPortName, "load_country": rec.LoadCountry,
		"discharge_hint": rec.DischargeHint, "discharge_country": rec.DischargeCountry,
		"commodity_description": rec.CommodityDescription,
		"volume_low": rec.VolumeLow, "volume_high": rec.VolumeHigh,
		"volume_best_estimate": rec.VolumeBestEstimate, "volume_method": rec.VolumeMethod,
		"volume_unit": rec.VolumeUnit, "event_date": rec.EventDate,
		"corridor_mmsi": rec.CorridorMMSI,
		"corridor_load_lat": rec.CorridorLoadLat, "corridor_load_lng": rec.CorridorLoadLng,
		"corridor_discharge_lat": rec.CorridorDischargeLat, "corridor_discharge_lng": rec.CorridorDischargeLng,
		"evidence_chain": rec.EvidenceChain, "sources": rec.Sources,
		"metadata": rec.Metadata, "created_at": rec.CreatedAt, "updated_at": rec.UpdatedAt,
		"disclaimer": "Synthetic cargo record — inferred from public sources, not a carrier BOL.",
	}
	if rec.ShipperCompanyID != nil {
		out["shipper_company_id"] = rec.ShipperCompanyID.String()
	}
	if rec.ConsigneeCompanyID != nil {
		out["consignee_company_id"] = rec.ConsigneeCompanyID.String()
	}
	if rec.LoadTerminalID != nil {
		out["load_terminal_id"] = rec.LoadTerminalID.String()
	}
	if rec.PortCallID != nil {
		out["port_call_id"] = rec.PortCallID.String()
	}
	if rec.CommercialEventID != nil {
		out["commercial_event_id"] = rec.CommercialEventID.String()
	}
	if rec.OpportunityID != nil {
		out["opportunity_id"] = rec.OpportunityID.String()
	}
	if len(rec.ContactIDs) > 0 {
		ids := make([]string, len(rec.ContactIDs))
		for i, id := range rec.ContactIDs {
			ids[i] = id.String()
		}
		out["contact_ids"] = ids
	}
	return out
}
