package seed

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EnsureHormuzCrisisDemoMCR inserts idempotent demo MCR rows with corridor geometry inside
// the hormuz_disruption_v1 scenario bbox (commodity_family=crude). Skipped when demo seed is disabled.
func EnsureHormuzCrisisDemoMCR(ctx context.Context, pool *pgxpool.Pool) error {
	if demoSeedDisabled() {
		return nil
	}
	rows := []hormuzMCRRow{
		{
			SyntheticBOLID: "DEMO-HORMUZ-MCR-001",
			Fingerprint:    "demo-hormuz-mcr-001-ras-india",
			LoadCountry:    "Saudi Arabia", DischargeCountry: "India",
			Shipper: "Saudi Aramco (demo)", Consignee: "Indian Oil Corp (demo)",
			LoadLat: 26.707, LoadLng: 50.061, DischargeLat: 18.95, DischargeLng: 72.82,
			VolumeBBL: 820000, Confidence: 0.78,
		},
		{
			SyntheticBOLID: "DEMO-HORMUZ-MCR-002",
			Fingerprint:    "demo-hormuz-mcr-002-fujairah-china",
			LoadCountry:    "United Arab Emirates", DischargeCountry: "China",
			Shipper: "ADNOC Trading (demo)", Consignee: "Sinopec (demo)",
			LoadLat: 25.128, LoadLng: 56.337, DischargeLat: 31.23, DischargeLng: 121.47,
			VolumeBBL: 650000, Confidence: 0.74,
		},
		{
			SyntheticBOLID: "DEMO-HORMUZ-MCR-003",
			Fingerprint:    "demo-hormuz-mcr-003-bandar-fujairah",
			LoadCountry:    "Iran", DischargeCountry: "United Arab Emirates",
			Shipper: "NIOC (demo)", Consignee: "Emirates National Oil (demo)",
			LoadLat: 27.18, LoadLng: 56.28, DischargeLat: 25.01, DischargeLng: 55.05,
			VolumeBBL: 540000, Confidence: 0.71,
		},
	}
	for _, row := range rows {
		if err := upsertHormuzMCR(ctx, pool, row); err != nil {
			return err
		}
	}
	return nil
}

type hormuzMCRRow struct {
	SyntheticBOLID, Fingerprint, LoadCountry, DischargeCountry, Shipper, Consignee string
	LoadLat, LoadLng, DischargeLat, DischargeLng, VolumeBBL, Confidence            float64
}

func upsertHormuzMCR(ctx context.Context, pool *pgxpool.Pool, row hormuzMCRRow) error {
	evidence, _ := json.Marshal([]string{
		"DEMO SEED — Hormuz crisis desk corridor sample",
		"Not customs_open or paid BOL; for Phase 1 UI verification only",
	})
	sources, _ := json.Marshal([]map[string]string{
		{"name": "demo_seed", "url": "internal://seed/hormuz_crisis_demo"},
	})
	meta, _ := json.Marshal(map[string]string{"scenario": "hormuz_disruption_v1", "tier": "synthetic"})
	_, err := pool.Exec(ctx, `
		INSERT INTO meridian_cargo_records (
			synthetic_bol_id, fingerprint, recipe, commodity_family, confidence, triangulation_score,
			bol_tier, shipper_name, consignee_name, load_country, discharge_country,
			commodity_description, volume_best_estimate, volume_unit, event_date,
			corridor_mmsi, corridor_load_lat, corridor_load_lng, corridor_discharge_lat, corridor_discharge_lng,
			evidence_chain, sources, metadata
		) VALUES (
			$1, $2, 'demo_hormuz_corridor', 'crude', $3, 1,
			'synthetic', $4, $5, $6, $7,
			'Crude oil (demo corridor)', $8, 'bbl', now() - interval '12 days',
			636012345, $9, $10, $11, $12,
			$13, $14, $15
		)
		ON CONFLICT (fingerprint) DO UPDATE SET
			commodity_family = EXCLUDED.commodity_family,
			confidence = EXCLUDED.confidence,
			corridor_load_lat = EXCLUDED.corridor_load_lat,
			corridor_load_lng = EXCLUDED.corridor_load_lng,
			corridor_discharge_lat = EXCLUDED.corridor_discharge_lat,
			corridor_discharge_lng = EXCLUDED.corridor_discharge_lng,
			evidence_chain = EXCLUDED.evidence_chain,
			updated_at = now()
	`, row.SyntheticBOLID, row.Fingerprint, row.Confidence,
		row.Shipper, row.Consignee, row.LoadCountry, row.DischargeCountry,
		row.VolumeBBL, row.LoadLat, row.LoadLng, row.DischargeLat, row.DischargeLng,
		evidence, sources, meta)
	if err != nil {
		return fmt.Errorf("upsert hormuz demo mcr %s: %w", row.SyntheticBOLID, err)
	}
	return nil
}
