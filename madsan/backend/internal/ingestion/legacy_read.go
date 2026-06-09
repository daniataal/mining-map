package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/confidence"
	"github.com/madsan/intelligence/internal/database"
)

const legacyBatchSize = 500

type legacyTableSpec struct {
	Table      string
	EntityType string
	AssetType  string
	Query      string
}

var legacyTableCatalog = []legacyTableSpec{
	{
		Table: "oil_vessels", EntityType: "vessel",
		Query: `
			SELECT v.mmsi, v.imo, v.name, v.vessel_type, v.tanker_class,
			       p.lat AS latitude, p.lon AS longitude, p.ts AS last_seen_at
			FROM oil_vessels v
			LEFT JOIN LATERAL (
				SELECT lat, lon, ts FROM oil_ais_positions
				WHERE mmsi = v.mmsi ORDER BY ts DESC LIMIT 1
			) p ON true
			ORDER BY v.mmsi OFFSET $1 LIMIT $2`,
	},
	{
		Table: "oil_companies", EntityType: "company",
		Query: `
			SELECT id, name, country, company_type, confidence, metadata
			FROM oil_companies ORDER BY name OFFSET $1 LIMIT $2`,
	},
	{
		Table: "licenses", EntityType: "asset", AssetType: "mine",
		Query: `
			SELECT id, company, country, commodity, sector, license_type,
			       lat AS latitude, lng AS longitude, phone_number, contact_person,
			       geo_confidence, raw_payload
			FROM licenses
			WHERE lat IS NOT NULL AND lng IS NOT NULL
			ORDER BY id OFFSET $1 LIMIT $2`,
	},
	{
		Table: "petroleum_osm_features", EntityType: "asset",
		Query: `
			SELECT id, layer_id, tags,
			       ST_Y(ST_PointOnSurface(geom)) AS latitude,
			       ST_X(ST_PointOnSurface(geom)) AS longitude
			FROM petroleum_osm_features
			WHERE geom IS NOT NULL
			ORDER BY id OFFSET $1 LIMIT $2`,
	},
}

func (s *Service) processLegacyImportGo(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := parseLegacyImportOpts(payload)
	if s.cfg.LegacyDBURL == "" {
		return fmt.Errorf("LEGACY_DATABASE_URL not configured")
	}
	legacy, err := database.ConnectURL(ctx, s.cfg.LegacyDBURL)
	if err != nil {
		return fmt.Errorf("legacy db connect: %w", err)
	}
	defer legacy.Close()

	tables := filterLegacyTables(opts.Tables)
	sourceID, _ := s.ensureSource(ctx, "legacy_mining_db")
	imported := 0
	evidenceRows := 0
	counts := map[string]int{}
	var lastErr error

	for _, spec := range tables {
		n, ev, err := s.importLegacyTable(ctx, legacy, spec, sourceID, opts.MaxRows)
		counts[spec.Table] = n
		imported += n
		evidenceRows += ev
		if err != nil && lastErr == nil {
			lastErr = err
		}
	}

	_ = s.refreshServing(ctx)
	report, _ := json.Marshal(map[string]any{
		"engine":          "go",
		"imported":        imported,
		"evidence_claims": evidenceRows,
		"legacy_counts":   counts,
		"tables":          tableNames(tables),
	})
	status := "completed"
	errMsg := ""
	if imported == 0 && lastErr != nil {
		errMsg = lastErr.Error()
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE ingestion_jobs SET status=$2, result_report=$3, error_message=NULLIF($4,''), finished_at=now()
		WHERE id=$1
	`, jobID, status, report, errMsg)
	return err
}

func filterLegacyTables(requested []string) []legacyTableSpec {
	if len(requested) == 0 {
		return legacyTableCatalog
	}
	want := map[string]bool{}
	for _, t := range requested {
		want[strings.TrimSpace(t)] = true
	}
	var out []legacyTableSpec
	for _, spec := range legacyTableCatalog {
		if want[spec.Table] {
			out = append(out, spec)
		}
	}
	return out
}

func tableNames(specs []legacyTableSpec) []string {
	out := make([]string, len(specs))
	for i, s := range specs {
		out[i] = s.Table
	}
	return out
}

func (s *Service) importLegacyTable(ctx context.Context, legacy *pgxpool.Pool, spec legacyTableSpec, sourceID uuid.UUID, maxRows int) (imported, evidence int, err error) {
	offset := 0
	for {
		if maxRows > 0 && imported >= maxRows {
			break
		}
		limit := legacyBatchSize
		if maxRows > 0 && imported+limit > maxRows {
			limit = maxRows - imported
		}
		rows, qerr := legacy.Query(ctx, spec.Query, offset, limit)
		if qerr != nil {
			return imported, evidence, qerr
		}
		batch, qerr := pgx.CollectRows(rows, pgx.RowToMap)
		if qerr != nil {
			return imported, evidence, qerr
		}
		if len(batch) == 0 {
			break
		}
		for i, row := range batch {
			rec := normalizeLegacyRow(spec, row)
			if rec.Name == "" && rec.EntityType != "vessel" {
				continue
			}
			if sourceID != uuid.Nil {
				_ = s.stageRecord(ctx, sourceID, rec, offset+i+1)
			}
			entityID, uerr := s.upsertMaster(ctx, rec)
			if uerr != nil {
				continue
			}
			if rec.EntityType == "asset" {
				_ = s.linkAssetOperator(ctx, entityID, rec, sourceID)
			}
			imported++
			if sourceID != uuid.Nil && entityID != uuid.Nil {
				score := confidence.Score(45, map[string]bool{"has_coordinates": rec.Latitude != nil})
				claimN := len(claimsForRecord(rec))
				if aerr := s.attachEvidence(ctx, sourceID, rec.EntityType, entityID, rec, score); aerr == nil {
					evidence += claimN
					s.persistImportSignals(ctx, rec, entityID, claimN, score)
				}
			}
		}
		offset += len(batch)
		if len(batch) < limit {
			break
		}
	}
	return imported, evidence, nil
}

func normalizeLegacyRow(spec legacyTableSpec, row map[string]any) NormalizedRecord {
	slug := "legacy_" + spec.Table
	m := map[string]any{}
	for k, v := range row {
		m[k] = v
	}
	m["source_slug"] = slug
	m["entity_type"] = spec.EntityType
	if spec.AssetType != "" {
		m["asset_type"] = spec.AssetType
	}
	m["external_id"] = fmt.Sprint(row["id"])
	if spec.Table == "oil_vessels" {
		m["external_id"] = fmt.Sprint(row["mmsi"])
	}
	m["raw_payload"] = copyMap(row)

	rec := mapLegacyRecord(m, slug)
	switch spec.Table {
	case "oil_companies":
		rec.EntityType = "company"
		rec.Name = normalizeName(fmt.Sprint(row["name"]))
		if c, ok := row["country"].(string); ok {
			rec.CountryCode = strings.ToUpper(strings.TrimSpace(c))
		}
		if cs, ok := toFloat(row["confidence"]); ok {
			rec.RawPayload["confidence_score"] = cs * 100
		}
	case "oil_vessels":
		rec.EntityType = "vessel"
		if n, ok := row["name"].(string); ok {
			rec.Name = normalizeName(n)
		}
	case "licenses":
		rec.EntityType = "asset"
		rec.Name = normalizeName(fmt.Sprint(row["company"]))
		if c, ok := row["country"].(string); ok {
			rec.CountryCode = strings.ToUpper(strings.TrimSpace(c))
		}
		if comm, ok := row["commodity"].(string); ok && comm != "" {
			rec.Commodities = []string{comm}
		}
		sector := strings.ToLower(fmt.Sprint(row["sector"]))
		if sector == "mining" {
			rec.AssetType = "mine"
		} else {
			rec.AssetType = "processing_plant"
		}
		if gc, ok := toFloat(row["geo_confidence"]); ok {
			rec.RawPayload["confidence_score"] = gc
		}
	case "petroleum_osm_features":
		rec.EntityType = "asset"
		rec.AssetType = LayerToAssetType(fmt.Sprint(row["layer_id"]))
		rec.Commodities = []string{"petroleum"}
		tags := parseTags(row["tags"])
		rec.RawPayload["tags"] = tags
		if name, ok := tags["name"].(string); ok && name != "" {
			rec.Name = normalizeName(name)
		} else if op, ok := tags["operator"].(string); ok {
			rec.Name = normalizeName(op)
		} else {
			rec.Name = normalizeName(fmt.Sprintf("%s:%v", row["layer_id"], row["id"]))
		}
	}
	return rec
}

func parseTags(v any) map[string]any {
	switch t := v.(type) {
	case map[string]any:
		return t
	case []byte:
		var m map[string]any
		_ = json.Unmarshal(t, &m)
		return m
	case string:
		var m map[string]any
		_ = json.Unmarshal([]byte(t), &m)
		return m
	default:
		return map[string]any{}
	}
}

func copyMap(src map[string]any) map[string]any {
	out := make(map[string]any, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}
