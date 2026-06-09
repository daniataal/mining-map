package intelligence

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ImportSnapshot struct {
	EntityType    string
	AssetType     string
	Commodities   []string
	Evidence      []EvidenceInput
	EvidenceCount int
	Confidence    float64
}

// PersistImportSnapshot writes computed opportunity signals after ingestion (24h throttle).
func PersistImportSnapshot(ctx context.Context, pool *pgxpool.Pool, entityID uuid.UUID, in ImportSnapshot) error {
	if entityID == uuid.Nil || in.EntityType == "" {
		return nil
	}
	evidence := in.Evidence
	if len(evidence) == 0 && in.EvidenceCount > 0 {
		evidence = []EvidenceInput{{ClaimType: "evidence_count", ClaimValue: "import", Tier: "observed"}}
	}
	var signals []EntitySignal
	var opp float64
	switch in.EntityType {
	case "company", "supplier":
		signals, opp = CompanySignals(in.Confidence, evidence, in.Commodities)
	case "asset":
		signals, opp = AssetSignals(in.AssetType, in.Confidence, in.EvidenceCount, in.Commodities)
	default:
		return nil
	}
	entityType := in.EntityType
	if entityType == "supplier" {
		entityType = "company"
	}
	payload, _ := json.Marshal(map[string]any{
		"signals":           signals,
		"opportunity_score": opp,
		"source":            "legacy_import",
		"evidence_count":    in.EvidenceCount,
	})
	_, err := pool.Exec(ctx, `
		INSERT INTO core_signals (entity_type, entity_id, signal_type, tier, confidence_score, payload)
		SELECT $1, $2, 'import_snapshot', 'observed', $3, $4
		WHERE NOT EXISTS (
			SELECT 1 FROM core_signals
			WHERE entity_id = $2 AND signal_type = 'import_snapshot'
			  AND observed_at > now() - interval '24 hours'
		)
	`, entityType, entityID, opp, payload)
	return err
}

// PersistVesselAIS writes a durable AIS freshness signal, throttled to once per hour per vessel.
func PersistVesselAIS(ctx context.Context, pool *pgxpool.Pool, vesselID uuid.UUID, lastSeen time.Time, speed *float64, confidence float64) error {
	signals, opp := VesselSignals(&lastSeen, speed, confidence)
	payload, _ := json.Marshal(map[string]any{
		"signals":           signals,
		"opportunity_score": opp,
		"source":            "ais_sync",
	})
	_, err := pool.Exec(ctx, `
		INSERT INTO core_signals (entity_type, entity_id, signal_type, tier, confidence_score, payload)
		SELECT 'vessel', $1, 'ais_position_update', 'observed', $2, $3
		WHERE NOT EXISTS (
			SELECT 1 FROM core_signals
			WHERE entity_id = $1 AND signal_type = 'ais_position_update'
			  AND observed_at > now() - interval '1 hour'
		)
	`, vesselID, opp, payload)
	return err
}
