package ingestion

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/confidence"
	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/deals"
)

type Service struct {
	pool       *pgxpool.Pool
	cfg        config.Config
	legacyPool *pgxpool.Pool // optional; set for batch jobs that reconcile against mining_db
}

func New(pool *pgxpool.Pool, cfg config.Config) *Service {
	return &Service{pool: pool, cfg: cfg}
}

type NormalizedRecord struct {
	EntityType  string         `json:"entity_type"`
	Name        string         `json:"name"`
	CountryCode string         `json:"country_code,omitempty"`
	Latitude    *float64       `json:"latitude,omitempty"`
	Longitude   *float64       `json:"longitude,omitempty"`
	Commodities []string       `json:"commodities,omitempty"`
	AssetType   string         `json:"asset_type,omitempty"`
	GeomEWKB    []byte         `json:"-"` // pipeline LineString from legacy petroleum_osm_features
	RawPayload  map[string]any `json:"raw_payload,omitempty"`
	Unmapped    map[string]any `json:"unmapped_fields,omitempty"`
	SourceSlug  string         `json:"source_slug"`
	ExternalID  string         `json:"external_id,omitempty"`
}

func (s *Service) Enqueue(ctx context.Context, jobType, sourceSlug string, payload map[string]any) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ingestion_jobs (job_type, source_slug, status, payload, scheduled_at)
		VALUES ($1,$2,'pending',$3,now()) RETURNING id
	`, jobType, sourceSlug, payload).Scan(&id)
	return id, err
}

func (s *Service) ProcessJob(ctx context.Context, jobID uuid.UUID, dryRun bool) error {
	var jobType, sourceSlug string
	var payload []byte
	err := s.pool.QueryRow(ctx, `
		SELECT job_type, COALESCE(source_slug,''), COALESCE(payload,'{}'::jsonb)
		FROM ingestion_jobs WHERE id = $1
	`, jobID).Scan(&jobType, &sourceSlug, &payload)
	if err != nil {
		return err
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE ingestion_jobs SET status='running', started_at=now(), attempts = attempts + 1 WHERE id=$1
	`, jobID)
	started := time.Now()

	if jobType == "legacy_import" {
		return s.processLegacyImport(ctx, jobID, payload)
	}
	if jobType == "eia_daily" {
		return s.processEIADaily(ctx, jobID)
	}
	if jobType == eiaCompanyImportsJobType {
		return s.processEIACompanyImports(ctx, jobID, payload)
	}
	if jobType == worldBankPricesJobType {
		return s.processWorldBankPrices(ctx, jobID, payload)
	}
	if jobType == jodiOilImportJobType {
		return s.processJODIOilImport(ctx, jobID, payload)
	}
	if jobType == jodiMarketPressureJobType {
		return s.processJODIMarketPressure(ctx, jobID, payload)
	}
	if jobType == oilOpportunityCandidatesJobType {
		return s.processOilOpportunityCandidates(ctx, jobID, payload)
	}
	if jobType == opportunityChainSegmentsJobType {
		return s.processOpportunityChainSegments(ctx, jobID, payload)
	}
	if jobType == brokerAlphaSnapshotsJobType {
		return s.processBrokerAlphaSnapshots(ctx, jobID, payload)
	}
	if jobType == stsOpenVesselLeadsJobType {
		return s.processSTSOpenVesselLeads(ctx, jobID, payload)
	}
	if jobType == cargoVoyageLinkerJobType {
		return s.processCargoVoyageLinker(ctx, jobID, payload)
	}
	if jobType == landedMarginSnapshotsJobType {
		return s.processLandedMarginSnapshots(ctx, jobID, payload)
	}
	if jobType == cargoEstimatesBackfillJobType {
		return s.processCargoEstimatesBackfill(ctx, jobID, payload)
	}
	if jobType == gemOilFoundationJobType {
		return s.processGEMOilFoundation(ctx, jobID, payload)
	}
	if jobType == gemInfrastructureFoundationJobType {
		return s.processGEMInfrastructureFoundation(ctx, jobID, payload)
	}
	if jobType == gemGeometryImportJobType {
		return s.processGEMGeometryImport(ctx, jobID, payload)
	}
	if jobType == "deal_watch_scan" {
		return s.processDealWatchScan(ctx, jobID)
	}
	if jobType == "terminal_enrichment" {
		return s.processTerminalEnrichment(ctx, jobID)
	}
	if jobType == vesselEnrichmentJobType {
		return s.processVesselEnrichment(ctx, jobID)
	}
	if jobType == portCallSweepJobType {
		return s.processPortCallSweep(ctx, jobID)
	}
	if jobType == stsDetectJobType {
		return s.processSTSDetect(ctx, jobID)
	}
	if jobType == stsPairPredictJobType {
		return s.processSTSPairPredict(ctx, jobID)
	}
	if jobType == stsRescoreJobType {
		return s.processSTSRescore(ctx, jobID, payload)
	}
	if jobType == maritimeContextJobType {
		return s.processMaritimeContextImport(ctx, jobID, payload)
	}
	if jobType == geoReferenceJobType {
		return s.processGeoReferenceImport(ctx, jobID, payload)
	}
	if jobType == storageInventoryJobType {
		return s.processStorageInventory(ctx, jobID)
	}
	if jobType == gemPipelineImportJobType {
		return s.processGEMPipelineImport(ctx, jobID)
	}
	if jobType == mcrRebuildJobType {
		return s.processMCRRebuild(ctx, jobID)
	}
	if jobType == voyageRebuildJobType {
		return s.processVoyageRebuild(ctx, jobID)
	}
	if jobType == brokerAlphaSnapshotsJobType {
		return s.processBrokerAlphaSnapshots(ctx, jobID, payload)
	}
	if jobType == stsOpenVesselLeadsJobType {
		return s.processSTSOpenVesselLeads(ctx, jobID, payload)
	}
	if jobType == cargoVoyageLinkerJobType {
		return s.processCargoVoyageLinker(ctx, jobID, payload)
	}
	if jobType == landedMarginSnapshotsJobType {
		return s.processLandedMarginSnapshots(ctx, jobID, payload)
	}
	if isSourceImportJob(jobType) {
		return s.processSourceImport(ctx, jobID, jobType, payload)
	}

	jobDryRun := dryRun || dryRunFromPayload(payload)

	var records []NormalizedRecord
	switch jobType {
	case "watch_folder":
		records, err = s.ingestWatchFolder(sourceSlug)
	case "bunker_seed":
		records, err = s.ingestBunkerSeed(sourceSlug)
	case "legacy_etl":
		records, err = s.ingestJSONPayload(sourceSlug, payload)
	default:
		records, err = s.ingestJSONPayload(sourceSlug, payload)
	}
	if err != nil {
		_, _ = s.pool.Exec(ctx, `UPDATE ingestion_jobs SET status='failed', error_message=$2, finished_at=now() WHERE id=$1`, jobID, err.Error())
		return err
	}

	if jobDryRun {
		report := buildLegacyImportReport(map[string]any{
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
		entityID, err := s.upsertMaster(ctx, rec)
		if err != nil {
			if lastErr == nil {
				lastErr = err
			}
			continue
		}
		imported++
		if sourceID != uuid.Nil && entityID != uuid.Nil {
			score := confidence.Score(40, map[string]bool{"has_coordinates": rec.Latitude != nil})
			claimN := len(claimsForRecord(rec))
			if err := s.attachEvidence(ctx, sourceID, rec.EntityType, entityID, rec, score); err == nil {
				evidenceRows += claimN
				s.persistImportSignals(ctx, rec, entityID, claimN, score)
			}
		}
	}
	if imported == 0 && lastErr != nil {
		_, _ = s.pool.Exec(ctx, `UPDATE ingestion_jobs SET error_message=$2 WHERE id=$1`, jobID, lastErr.Error())
	}
	_ = s.refreshServingMatviews(ctx, servingMatviewsForJob(jobType, records))
	report := buildLegacyImportReport(map[string]any{
		"imported":        imported,
		"total":           len(records),
		"evidence_claims": evidenceRows,
	}, started)
	_, _ = s.pool.Exec(ctx, `UPDATE ingestion_jobs SET status='completed', result_report=$2, finished_at=now() WHERE id=$1`, jobID, report)
	return nil
}

func dryRunFromPayload(payload []byte) bool {
	if len(payload) == 0 {
		return false
	}
	var m map[string]any
	if json.Unmarshal(payload, &m) != nil {
		return false
	}
	b, ok := m["dry_run"].(bool)
	return ok && b
}

func (s *Service) ingestWatchFolder(sourceSlug string) ([]NormalizedRecord, error) {
	dir := s.cfg.RawDataDir
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []NormalizedRecord
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		path := filepath.Join(dir, e.Name())
		b, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		sum := sha256.Sum256(b)
		hash := hex.EncodeToString(sum[:])
		var prev string
		_ = s.pool.QueryRow(context.Background(), `
			SELECT last_hash FROM sources WHERE slug = $1 OR source_name = $1
		`, sourceSlug).Scan(&prev)
		if prev == hash {
			continue
		}
		recs, err := parseFileRecords(e.Name(), b, sourceSlug)
		if err != nil {
			continue
		}
		out = append(out, recs...)
		_, _ = s.pool.Exec(context.Background(), `
			INSERT INTO sources (source_name, slug, source_type, last_hash, imported_at)
			VALUES ($1,$1,'file',$2,now())
			ON CONFLICT (source_name) DO UPDATE SET last_hash=$2, imported_at=now(), slug=EXCLUDED.slug
		`, sourceSlug, hash)
	}
	return out, nil
}

func parseFileRecords(name string, b []byte, sourceSlug string) ([]NormalizedRecord, error) {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".json", ".geojson":
		var raw any
		if err := json.Unmarshal(b, &raw); err != nil {
			return nil, err
		}
		return flattenJSON(raw, sourceSlug), nil
	case ".csv":
		return parseCSVRecords(string(b), sourceSlug), nil
	default:
		return nil, fmt.Errorf("unsupported: %s", ext)
	}
}

func flattenJSON(raw any, sourceSlug string) []NormalizedRecord {
	var out []NormalizedRecord
	switch v := raw.(type) {
	case []any:
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				out = append(out, mapToRecord(m, sourceSlug))
			}
		}
	case map[string]any:
		if feats, ok := v["features"].([]any); ok {
			for _, f := range feats {
				if fm, ok := f.(map[string]any); ok {
					out = append(out, geoFeatureToRecord(fm, sourceSlug))
				}
			}
		} else {
			out = append(out, mapToRecord(v, sourceSlug))
		}
	}
	return out
}

func mapToRecord(m map[string]any, sourceSlug string) NormalizedRecord {
	name, _ := m["name"].(string)
	if name == "" {
		name, _ = m["title"].(string)
	}
	country, _ := m["country_code"].(string)
	if country == "" {
		country, _ = m["country"].(string)
	}
	et, _ := m["entity_type"].(string)
	if et == "" {
		et = "asset"
	}
	rec := NormalizedRecord{
		EntityType:  et,
		Name:        normalizeName(name),
		CountryCode: strings.ToUpper(strings.TrimSpace(country)),
		SourceSlug:  sourceSlug,
		RawPayload:  m,
	}
	if lat, ok := toFloat(m["latitude"]); ok {
		rec.Latitude = &lat
	}
	if lng, ok := toFloat(m["longitude"]); ok {
		rec.Longitude = &lng
	}
	if at, ok := m["asset_type"].(string); ok {
		rec.AssetType = at
	}
	return rec
}

func geoFeatureToRecord(f map[string]any, sourceSlug string) NormalizedRecord {
	props, _ := f["properties"].(map[string]any)
	if props == nil {
		props = map[string]any{}
	}
	rec := mapToRecord(props, sourceSlug)
	if geom, ok := f["geometry"].(map[string]any); ok {
		if coords, ok := geom["coordinates"].([]any); ok && len(coords) >= 2 {
			if lng, ok := toFloat(coords[0]); ok {
				rec.Longitude = &lng
			}
			if lat, ok := toFloat(coords[1]); ok {
				rec.Latitude = &lat
			}
		}
	}
	return rec
}

func parseCSVRecords(data, sourceSlug string) []NormalizedRecord {
	lines := strings.Split(data, "\n")
	if len(lines) < 2 {
		return nil
	}
	headers := strings.Split(strings.TrimSpace(lines[0]), ",")
	var out []NormalizedRecord
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "" {
			continue
		}
		vals := strings.Split(line, ",")
		m := map[string]any{}
		for i, h := range headers {
			if i < len(vals) {
				m[strings.TrimSpace(h)] = strings.TrimSpace(vals[i])
			}
		}
		out = append(out, mapToRecord(m, sourceSlug))
	}
	return out
}

func (s *Service) ingestJSONPayload(sourceSlug string, payload []byte) ([]NormalizedRecord, error) {
	var m map[string]any
	if err := json.Unmarshal(payload, &m); err != nil {
		return nil, err
	}
	if recs, ok := m["records"].([]any); ok {
		var out []NormalizedRecord
		for _, r := range recs {
			if rm, ok := r.(map[string]any); ok {
				out = append(out, mapLegacyRecord(rm, sourceSlug))
			}
		}
		return out, nil
	}
	return flattenJSON(m, sourceSlug), nil
}

func (s *Service) ingestLegacyStub(sourceSlug string) ([]NormalizedRecord, error) {
	return []NormalizedRecord{}, nil
}

func (s *Service) upsertMaster(ctx context.Context, rec NormalizedRecord) (uuid.UUID, error) {
	score := confidence.Score(40, map[string]bool{"has_coordinates": rec.Latitude != nil})
	status := confidence.Status(score)
	switch rec.EntityType {
	case "company", "supplier":
		var existing uuid.UUID
		err := s.pool.QueryRow(ctx, `
			SELECT id FROM companies WHERE normalized_name = lower($1) AND COALESCE(country_code,'') = COALESCE($2,'')
		`, rec.Name, rec.CountryCode).Scan(&existing)
		if err == nil {
			return existing, nil
		}
		if rec.RawPayload != nil {
			if cs, ok := rec.RawPayload["confidence_score"].(float64); ok && cs > 0 {
				score = cs * 100
				if score > 100 {
					score = 100
				}
				status = confidence.Status(score)
			}
		}
		var companyID uuid.UUID
		err = s.pool.QueryRow(ctx, `
			INSERT INTO companies (name, normalized_name, country_code, company_type, commodities, confidence_score, data_quality_status, raw_source_payload)
			VALUES ($1,$2,$3,'supplier',$4,$5,$6,$7)
			RETURNING id
		`, rec.Name, strings.ToLower(rec.Name), rec.CountryCode, rec.Commodities, score, status, rec.RawPayload).Scan(&companyID)
		if err != nil {
			return uuid.Nil, err
		}
		phone, _ := rec.RawPayload["phone"].(string)
		email, _ := rec.RawPayload["email"].(string)
		if phone != "" || email != "" {
			_, _ = s.pool.Exec(ctx, `
				INSERT INTO contacts (company_id, name, email, phone, role, confidence_score, verification_status)
				VALUES ($1,$2,$3,$4,'operations',$5,'official_register')
			`, companyID, rec.Name, email, phone, score)
		}
		return companyID, nil
	case "vessel":
		mmsi := vesselMMSI(rec.RawPayload)
		if mmsi == "" {
			return uuid.Nil, fmt.Errorf("vessel missing mmsi")
		}
		imo, _ := rec.RawPayload["imo"].(string)
		vtype, _ := rec.RawPayload["vessel_type"].(string)
		var vesselID uuid.UUID
		err := s.pool.QueryRow(ctx, `
			INSERT INTO vessels (name, imo, mmsi, vessel_type, latitude, longitude, geom, confidence_score, data_quality_status)
			VALUES ($1,$2,$3,$4,$5::double precision,$6::double precision,
				CASE WHEN $5::double precision IS NOT NULL AND $6::double precision IS NOT NULL
					THEN ST_SetSRID(ST_MakePoint($6::float8,$5::float8),4326)::geography ELSE NULL END, $7,$8)
			ON CONFLICT (mmsi) DO UPDATE SET
				name = COALESCE(EXCLUDED.name, vessels.name),
				latitude = COALESCE(EXCLUDED.latitude, vessels.latitude),
				longitude = COALESCE(EXCLUDED.longitude, vessels.longitude),
				geom = COALESCE(EXCLUDED.geom, vessels.geom),
				updated_at = now()
			RETURNING id
		`, rec.Name, imo, mmsi, vtype, rec.Latitude, rec.Longitude, score, status).Scan(&vesselID)
		if err != nil {
			_ = s.pool.QueryRow(ctx, `SELECT id FROM vessels WHERE mmsi = $1`, mmsi).Scan(&vesselID)
			if vesselID == uuid.Nil {
				return uuid.Nil, err
			}
		}
		return vesselID, nil
	default:
		assetType := rec.AssetType
		if assetType == "" {
			assetType = "terminal"
		}
		if rec.Name == "" {
			return uuid.Nil, nil
		}
		if rec.SourceSlug == legacyOilTerminalsTable && rec.ExternalID != "" {
			return s.upsertOilTerminalAsset(ctx, rec, assetType, score, status)
		}
		var existing uuid.UUID
		err := s.pool.QueryRow(ctx, `
			SELECT id FROM assets
			WHERE normalized_name = lower($1) AND asset_type = $2
			  AND COALESCE(country_code,'') = COALESCE($3,'')
		`, rec.Name, assetType, rec.CountryCode).Scan(&existing)
		if err == nil {
			return existing, nil
		}
		var assetID uuid.UUID
		err = s.pool.QueryRow(ctx, `
			INSERT INTO assets (name, normalized_name, asset_type, latitude, longitude, geom, country_code, commodities_supported, confidence_score, data_quality_status, raw_source_payload, legacy_table, legacy_id)
			VALUES ($1,$2,$3,$4::double precision,$5::double precision,
				CASE WHEN $4::double precision IS NOT NULL AND $5::double precision IS NOT NULL
					THEN ST_SetSRID(ST_MakePoint($5::float8,$4::float8),4326)::geography ELSE NULL END,
				$6,$7,$8,$9,$10,$11,$12)
			RETURNING id
		`, rec.Name, strings.ToLower(rec.Name), assetType, rec.Latitude, rec.Longitude, rec.CountryCode, rec.Commodities, score, status, rec.RawPayload, rec.SourceSlug, rec.ExternalID).Scan(&assetID)
		return assetID, err
	}
}

// upsertOilTerminalAsset imports curated oil_terminals 1:1 by legacy_id. Name+country dedup
// would collapse ~18k distinct storage tanks that share generic names like "Unnamed Storage Terminal".
func (s *Service) upsertOilTerminalAsset(ctx context.Context, rec NormalizedRecord, assetType string, score float64, status string) (uuid.UUID, error) {
	var assetID uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM assets WHERE legacy_table = $1 AND legacy_id = $2
	`, rec.SourceSlug, rec.ExternalID).Scan(&assetID)
	if err == nil {
		_, err = s.pool.Exec(ctx, `
			UPDATE assets SET
				name = $2, normalized_name = lower($2), asset_type = $3,
				latitude = $4::double precision, longitude = $5::double precision,
				geom = CASE WHEN $4::double precision IS NOT NULL AND $5::double precision IS NOT NULL
					THEN ST_SetSRID(ST_MakePoint($5::float8,$4::float8),4326)::geography ELSE geom END,
				country_code = $6, commodities_supported = $7,
				confidence_score = $8, data_quality_status = $9,
				raw_source_payload = $10, updated_at = now()
			WHERE id = $1
		`, assetID, rec.Name, assetType, rec.Latitude, rec.Longitude, rec.CountryCode, rec.Commodities, score, status, rec.RawPayload)
		return assetID, err
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO assets (name, normalized_name, asset_type, latitude, longitude, geom, country_code, commodities_supported, confidence_score, data_quality_status, raw_source_payload, legacy_table, legacy_id)
		VALUES ($1,$2,$3,$4::double precision,$5::double precision,
			CASE WHEN $4::double precision IS NOT NULL AND $5::double precision IS NOT NULL
				THEN ST_SetSRID(ST_MakePoint($5::float8,$4::float8),4326)::geography ELSE NULL END,
			$6,$7,$8,$9,$10,$11,$12)
		RETURNING id
	`, rec.Name, strings.ToLower(rec.Name), assetType, rec.Latitude, rec.Longitude, rec.CountryCode, rec.Commodities, score, status, rec.RawPayload, rec.SourceSlug, rec.ExternalID).Scan(&assetID)
	return assetID, err
}

func (s *Service) ScanRawDir(ctx context.Context) error {
	_, err := s.Enqueue(ctx, "watch_folder", "raw_watch", map[string]any{"dir": s.cfg.RawDataDir})
	return err
}

func (s *Service) processDealWatchScan(ctx context.Context, jobID uuid.UUID) error {
	dealSvc := deals.New(s.pool, s.cfg.OpenSanctionsAPIKey, s.cfg.EIAAPIKey)
	report, err := dealSvc.ScanAllWatchSubscriptions(ctx)
	reportJSON, _ := json.Marshal(map[string]any{
		"subscriptions_scanned": report.Subscriptions,
		"events_inserted":       report.EventsInserted,
		"skipped_no_snapshot":   report.Skipped,
		"errors":                report.Errors,
	})
	if err != nil {
		_, _ = s.pool.Exec(ctx, `UPDATE ingestion_jobs SET status='failed', error_message=$2, result_report=$3, finished_at=now() WHERE id=$1`, jobID, err.Error(), reportJSON)
		return err
	}
	_, _ = s.pool.Exec(ctx, `UPDATE ingestion_jobs SET status='completed', result_report=$2, finished_at=now() WHERE id=$1`, jobID, reportJSON)
	return nil
}

func normalizeName(s string) string {
	return strings.TrimSpace(strings.Join(strings.Fields(s), " "))
}

func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		var f float64
		_, err := fmt.Sscanf(t, "%f", &f)
		return f, err == nil
	default:
		return 0, false
	}
}

func (s *Service) SnapshotRaw(r io.Reader, slug string) (string, error) {
	b, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	hash := hex.EncodeToString(sum[:])
	path := filepath.Join(s.cfg.RawDataDir, "snapshots", slug+"_"+time.Now().Format("20060102T150405")+".json")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, b, 0o644)
	return hash, nil
}
