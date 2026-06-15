package ingestion

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/confidence"
	"github.com/madsan/intelligence/internal/database"
	sourcespkg "github.com/madsan/intelligence/internal/sources"
	"github.com/madsan/intelligence/internal/sources/gleif"
	"github.com/madsan/intelligence/internal/sources/procurement"
	"github.com/madsan/intelligence/internal/sources/sec"
)

// SourceImportSlugs are registered Tier-1 open-data adapters dispatched by source_slug.
var SourceImportSlugs = map[string]bool{
	"gleif":              true,
	"sec_edgar":          true,
	"legacy_procurement": true,
}

func (s *Service) processSourceImport(ctx context.Context, jobID uuid.UUID, sourceSlug string, payload []byte) error {
	if !SourceImportSlugs[sourceSlug] {
		return fmt.Errorf("unknown source adapter slug: %s", sourceSlug)
	}

	started := time.Now()
	jobDryRun := dryRunFromPayload(payload)

	var records []NormalizedRecord
	var fetchErr error
	var adapterRecords []sourcespkg.Record
	switch sourceSlug {
	case "gleif":
		adapterRecords, fetchErr = gleif.FetchEnrichment(ctx, s.pool, s.cfg, nil)
	case "sec_edgar":
		adapterRecords, fetchErr = sec.FetchEnrichment(ctx, s.pool, s.cfg, nil)
	case "legacy_procurement":
		if s.cfg.LegacyDBURL == "" {
			fetchErr = fmt.Errorf("LEGACY_DATABASE_URL not configured")
		} else {
			legacy, err := database.ConnectURL(ctx, s.cfg.LegacyDBURL)
			if err != nil {
				fetchErr = fmt.Errorf("legacy db connect: %w", err)
			} else {
				defer legacy.Close()
				adapterRecords, fetchErr = procurement.FetchLegacy(ctx, legacy)
			}
		}
	}
	if fetchErr == nil {
		records = recordsFromAdapter(adapterRecords)
	}
	if fetchErr != nil {
		_, _ = s.pool.Exec(ctx, `UPDATE ingestion_jobs SET status='failed', error_message=$2, finished_at=now() WHERE id=$1`, jobID, fetchErr.Error())
		return fetchErr
	}

	if jobDryRun {
		report := buildLegacyImportReport(map[string]any{
			"engine":  "source_adapter",
			"slug":    sourceSlug,
			"records": len(records),
			"dry_run": true,
		}, started)
		_, _ = s.pool.Exec(ctx, `UPDATE ingestion_jobs SET status='completed', result_report=$2, finished_at=now() WHERE id=$1`, jobID, report)
		return nil
	}

	sourceID, _ := s.ensureSource(ctx, sourceSlug)
	imported := 0
	evidenceRows := 0
	var lastErr error
	for i, rec := range records {
		if sourceID != uuid.Nil {
			_ = s.stageRecord(ctx, sourceID, rec, i+1)
		}
		entityID, err := s.upsertSourceRecord(ctx, rec)
		if err != nil {
			if lastErr == nil {
				lastErr = err
			}
			continue
		}
		imported++
		if sourceID != uuid.Nil && entityID != uuid.Nil {
			score := sourceImportConfidence(rec)
			claimN := len(claimsForRecord(rec))
			if err := s.attachEvidence(ctx, sourceID, rec.EntityType, entityID, rec, score); err == nil {
				evidenceRows += claimN
				s.persistImportSignals(ctx, rec, entityID, claimN, score)
			}
		}
	}

	status := "completed"
	errMsg := ""
	if imported == 0 && lastErr != nil {
		errMsg = lastErr.Error()
	}
	report := buildLegacyImportReport(map[string]any{
		"engine":          "source_adapter",
		"slug":            sourceSlug,
		"imported":        imported,
		"total":           len(records),
		"evidence_claims": evidenceRows,
	}, started)
	_, err := s.pool.Exec(ctx, `
		UPDATE ingestion_jobs SET status=$2, result_report=$3, error_message=NULLIF($4,''), finished_at=now()
		WHERE id=$1
	`, jobID, status, report, errMsg)
	return err
}

func sourceImportConfidence(rec NormalizedRecord) float64 {
	if rec.RawPayload != nil {
		if cs, ok := rec.RawPayload["confidence_score"].(float64); ok && cs > 0 {
			return cs
		}
	}
	return confidence.Score(55, map[string]bool{"has_coordinates": rec.Latitude != nil})
}

// upsertSourceRecord writes enrichment to an existing company when enriched_company_id is set.
func (s *Service) upsertSourceRecord(ctx context.Context, rec NormalizedRecord) (uuid.UUID, error) {
	if rec.RawPayload != nil {
		if idStr, ok := rec.RawPayload["enriched_company_id"].(string); ok && idStr != "" {
			if id, err := uuid.Parse(idStr); err == nil {
				_, _ = s.pool.Exec(ctx, `
					UPDATE companies SET
						raw_source_payload = COALESCE(raw_source_payload, '{}'::jsonb) || $2::jsonb,
						registration_number = COALESCE(NULLIF(registration_number,''), NULLIF($3,'')),
						updated_at = now()
					WHERE id = $1
				`, id, rec.RawPayload, registrationFromRecord(rec))
				return id, nil
			}
		}
	}
	return s.upsertMaster(ctx, rec)
}

func registrationFromRecord(rec NormalizedRecord) string {
	if rec.RawPayload == nil {
		return ""
	}
	if lei, ok := rec.RawPayload["lei"].(string); ok && lei != "" {
		return lei
	}
	if cik, ok := rec.RawPayload["cik"].(string); ok && cik != "" {
		return cik
	}
	return ""
}

func isSourceImportJob(jobType string) bool {
	return SourceImportSlugs[jobType]
}

func recordsFromAdapter(in []sourcespkg.Record) []NormalizedRecord {
	out := make([]NormalizedRecord, len(in))
	for i, r := range in {
		out[i] = NormalizedRecord{
			EntityType:  r.EntityType,
			Name:        r.Name,
			CountryCode: r.CountryCode,
			Latitude:    r.Latitude,
			Longitude:   r.Longitude,
			Commodities: r.Commodities,
			AssetType:   r.AssetType,
			RawPayload:  r.RawPayload,
			SourceSlug:  r.SourceSlug,
			ExternalID:  r.ExternalID,
		}
	}
	return out
}
