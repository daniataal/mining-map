package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/confidence"
	venrich "github.com/madsan/intelligence/internal/enrichment/vessel"
)

const (
	vesselEnrichmentJobType    = "vessel_enrichment"
	vesselEnrichmentSourceSlug = "vessel_enrichment"
	defaultEnrichmentBatchSize = 50
	defaultEnrichmentRateLimit = 250 * time.Millisecond
)

func (s *Service) processVesselEnrichment(ctx context.Context, jobID uuid.UUID) error {
	started := time.Now()
	batch := s.cfg.VesselEnrichmentBatch
	if batch <= 0 {
		batch = defaultEnrichmentBatchSize
	}
	payload := s.loadJobPayload(ctx, jobID)
	opts := VesselEnrichBatchOptions{
		Limit: batch,
		Force: payloadBool(payload, "force"),
		IMO:   payloadString(payload, "imo"),
	}
	if opts.IMO != "" {
		opts.Limit = 1
	}

	result, err := RunVesselEnrichmentBatch(ctx, s.pool, s.cfg, zerolog.Nop(), opts)
	var lastErr error
	if err != nil {
		lastErr = err
	}

	report, _ := json.Marshal(map[string]any{
		"enriched":  result.Enriched,
		"skipped":   result.Skipped,
		"uncertain": result.Uncertain,
		"errors":    result.Errors,
		"batch":     batch,
		"duration":  time.Since(started).String(),
	})
	status := "completed"
	if result.Enriched == 0 && lastErr != nil {
		status = "failed"
	}
	_, execErr := s.pool.Exec(ctx, `
		UPDATE ingestion_jobs SET status=$2, result_report=$3, error_message=$4, finished_at=now() WHERE id=$1
	`, jobID, status, report, errString(lastErr))
	if execErr != nil && lastErr == nil {
		lastErr = execErr
	}
	return lastErr
}

func errString(err error) any {
	if err == nil {
		return nil
	}
	return err.Error()
}

func (s *Service) linkVesselCompanies(ctx context.Context, vesselID uuid.UUID, res venrich.Enrichment, sourceID uuid.UUID) (ownerID, operatorID uuid.UUID, err error) {
	if res.OwnerName != "" {
		ownerID, err = s.ensureCompanyByName(ctx, res.OwnerName, res.Flag, nil)
		if err != nil {
			return uuid.Nil, uuid.Nil, err
		}
		_ = s.ensureRelationship(ctx, "vessel", vesselID, "company", ownerID, "owned_by", sourceID, res.Confidence)
	}
	if res.OperatorName != "" {
		operatorID, err = s.ensureCompanyByName(ctx, res.OperatorName, res.Flag, nil)
		if err != nil {
			return ownerID, uuid.Nil, err
		}
		_ = s.ensureRelationship(ctx, "vessel", vesselID, "company", operatorID, "operated_by", sourceID, res.Confidence)
	}
	return ownerID, operatorID, nil
}

func (s *Service) upsertVesselEnrichment(ctx context.Context, vesselID uuid.UUID, mmsi string, ownerCompanyID, operatorCompanyID uuid.UUID, res venrich.Enrichment) error {
	raw, _ := json.Marshal(res.RawPayload)
	fleet, _ := json.Marshal(res.FleetList)
	ownerProfile, _ := json.Marshal(res.OwnerProfile)
	limitations := res.Limitations
	if limitations == nil {
		limitations = []string{}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO vessel_enrichment (
			mmsi, vessel_id, imo, owner_name, operator_name,
			owner_company_id, operator_company_id,
			builder, build_year, vessel_class, flag,
			gross_tonnage, deadweight_tons, fleet_list, owner_profile,
			source, tier, confidence_score, limitations,
			fetched_at, stale_after, raw_payload, updated_at
		) VALUES (
			$1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),
			NULLIF($6::text,'')::uuid,NULLIF($7::text,'')::uuid,
			NULLIF($8,''),$9,NULLIF($10,''),NULLIF($11,''),
			$12,$13,$14,$15,
			$16,$17,$18,$19,
			$20,$21,$22,now()
		)
		ON CONFLICT (mmsi) DO UPDATE SET
			vessel_id = EXCLUDED.vessel_id,
			imo = COALESCE(NULLIF(EXCLUDED.imo,''), vessel_enrichment.imo),
			owner_name = COALESCE(NULLIF(EXCLUDED.owner_name,''), vessel_enrichment.owner_name),
			operator_name = COALESCE(NULLIF(EXCLUDED.operator_name,''), vessel_enrichment.operator_name),
			owner_company_id = COALESCE(EXCLUDED.owner_company_id, vessel_enrichment.owner_company_id),
			operator_company_id = COALESCE(EXCLUDED.operator_company_id, vessel_enrichment.operator_company_id),
			builder = COALESCE(NULLIF(EXCLUDED.builder,''), vessel_enrichment.builder),
			build_year = COALESCE(EXCLUDED.build_year, vessel_enrichment.build_year),
			vessel_class = COALESCE(NULLIF(EXCLUDED.vessel_class,''), vessel_enrichment.vessel_class),
			flag = COALESCE(NULLIF(EXCLUDED.flag,''), vessel_enrichment.flag),
			gross_tonnage = COALESCE(EXCLUDED.gross_tonnage, vessel_enrichment.gross_tonnage),
			deadweight_tons = COALESCE(EXCLUDED.deadweight_tons, vessel_enrichment.deadweight_tons),
			fleet_list = CASE WHEN EXCLUDED.tier = 'not_implemented' THEN vessel_enrichment.fleet_list ELSE EXCLUDED.fleet_list END,
			owner_profile = CASE WHEN EXCLUDED.tier = 'not_implemented' THEN vessel_enrichment.owner_profile ELSE EXCLUDED.owner_profile END,
			source = EXCLUDED.source,
			tier = EXCLUDED.tier,
			confidence_score = GREATEST(vessel_enrichment.confidence_score, EXCLUDED.confidence_score),
			limitations = EXCLUDED.limitations,
			fetched_at = EXCLUDED.fetched_at,
			stale_after = EXCLUDED.stale_after,
			raw_payload = EXCLUDED.raw_payload,
			updated_at = now()
	`, mmsi, vesselID, res.IMO, res.OwnerName, res.OperatorName,
		nullableUUID(ownerCompanyID), nullableUUID(operatorCompanyID),
		res.Builder, res.BuildYear, res.VesselClass, res.Flag,
		res.GrossTonnage, res.DeadweightTons, fleet, ownerProfile,
		res.Source, res.Tier, res.Confidence, limitations,
		res.FetchedAt, res.StaleAfter, raw)
	return err
}

func (s *Service) attachVesselEnrichmentEvidence(ctx context.Context, sourceID uuid.UUID, vesselID uuid.UUID, res venrich.Enrichment) error {
	rec := NormalizedRecord{
		EntityType: "vessel",
		SourceSlug: vesselEnrichmentSourceSlug,
		RawPayload: map[string]any{
			"owner_name":        res.OwnerName,
			"operator_name":     res.OperatorName,
			"imo":               res.IMO,
			"flag":              res.Flag,
			"vessel_class":      res.VesselClass,
			"enrichment_source": res.Source,
			"enrichment_tier":   res.Tier,
		},
	}
	if res.DeadweightTons != nil {
		rec.RawPayload["deadweight_tons"] = *res.DeadweightTons
	}
	score := res.Confidence
	if score <= 0 {
		score = confidence.Score(35, map[string]bool{})
	}
	return s.attachEvidence(ctx, sourceID, "vessel", vesselID, rec, score)
}

func (s *Service) enqueueVesselEnrichmentReview(ctx context.Context, vesselID uuid.UUID, mmsi string, res venrich.Enrichment) error {
	payload, _ := json.Marshal(map[string]any{
		"vessel_id": vesselID.String(),
		"mmsi":      mmsi,
		"source":    res.Source,
		"tier":      res.Tier,
		"owner":     res.OwnerName,
		"operator":  res.OperatorName,
		"trigger":   vesselEnrichmentJobType,
	})
	_, err := s.pool.Exec(ctx, `
		INSERT INTO manual_review_queue (entity_type, reason, confidence_score, raw_payload, status)
		SELECT 'vessel', 'uncertain_vessel_enrichment', $1, $2, 'pending'
		WHERE NOT EXISTS (
			SELECT 1 FROM manual_review_queue
			WHERE entity_type = 'vessel' AND reason = 'uncertain_vessel_enrichment'
			  AND status = 'pending' AND raw_payload->>'mmsi' = $3
		)
	`, res.Confidence, payload, mmsi)
	return err
}
