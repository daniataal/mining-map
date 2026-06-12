package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuri/excelize/v2"

	"github.com/madsan/intelligence/internal/confidence"
)

const (
	gemExtractionSourceSlug = "gem_global_extraction_tracker_march_2026"
	gemPlantSourceSlug      = "gem_gogpt_plants_january_2026"
	gemPipelineSourceSlug   = "gem_goit_pipelines_march_2025"
)

var gemTrackerCatalog = []gemTrackerSpec{
	{
		Tracker:     "gem_extraction",
		SourceSlug:  gemExtractionSourceSlug,
		Filename:    "Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx",
		Sheet:       "Field-level main data",
		LegacyTable: "gem_global_extraction_tracker",
	},
	{
		Tracker:     "gem_plants",
		SourceSlug:  gemPlantSourceSlug,
		Filename:    "Global-Oil-and-Gas-Plant-Tracker-GOGPT-January-2026.xlsx",
		Sheet:       "Gas & Oil Units",
		LegacyTable: "gem_gogpt_plants",
	},
	{
		Tracker:     "gem_pipelines",
		SourceSlug:  gemPipelineSourceSlug,
		Filename:    "GEM-GOIT-Oil-NGL-Pipelines-2025-03.xlsx",
		Sheet:       "Pipelines",
		LegacyTable: "gem_goit_pipelines",
	},
}

type gemTrackerSpec struct {
	Tracker     string
	SourceSlug  string
	Filename    string
	Sheet       string
	LegacyTable string
}

func filterGEMTrackers(requested []string) []gemTrackerSpec {
	if len(requested) == 0 {
		return gemTrackerCatalog
	}
	want := map[string]bool{}
	for _, t := range requested {
		want[strings.TrimSpace(t)] = true
	}
	var out []gemTrackerSpec
	for _, spec := range gemTrackerCatalog {
		if want[spec.Tracker] {
			out = append(out, spec)
		}
	}
	return out
}

const madsanModule = "github.com/madsan/intelligence"

func gemDirHasTracker(dir string) bool {
	if dir == "" {
		return false
	}
	for _, spec := range gemTrackerCatalog {
		if _, err := os.Stat(filepath.Join(dir, spec.Filename)); err == nil {
			return true
		}
	}
	return false
}

// locateGEMDataDir finds madsan/data/gem first, then falls back to monorepo repo root xlsx.
func locateGEMDataDir() string {
	if env := strings.TrimSpace(os.Getenv("MADSAN_GEM_DATA_DIR")); env != "" {
		if gemDirHasTracker(env) {
			if ap, err := filepath.Abs(env); err == nil {
				return ap
			}
			return env
		}
	}
	anchors := make([]string, 0, 3)
	if _, self, _, ok := runtime.Caller(0); ok {
		anchors = append(anchors, filepath.Dir(self))
	}
	if exe, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		anchors = append(anchors, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		anchors = append(anchors, wd)
	}
	for _, anchor := range anchors {
		if dir := walkUpForGEMDir(anchor); dir != "" {
			return dir
		}
	}
	return ""
}

func walkUpForGEMDir(start string) string {
	dir := start
	for {
		if gem := gemBesideMadsanRoot(dir); gem != "" {
			return gem
		}
		if gemDirHasTracker(dir) {
			if ap, err := filepath.Abs(dir); err == nil {
				return ap
			}
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func gemBesideMadsanRoot(start string) string {
	dir := start
	for {
		if gem := filepath.Join(dir, "data", "gem"); gemDirHasTracker(gem) {
			if ap, err := filepath.Abs(gem); err == nil {
				return ap
			}
			return gem
		}
		modPath := filepath.Join(dir, "go.mod")
		b, err := os.ReadFile(modPath)
		if err == nil && strings.Contains(string(b), "module "+madsanModule) {
			gem := filepath.Join(filepath.Dir(dir), "data", "gem")
			if gemDirHasTracker(gem) {
				if ap, err := filepath.Abs(gem); err == nil {
					return ap
				}
				return gem
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// RunGEMImport ingests GEM xlsx trackers from madsan/data/gem into assets (+ pipeline edges when geometry exists).
func (s *Service) RunGEMImport(ctx context.Context, gemDataDir string, trackers []string, maxRows int, dryRun bool, includeLegacySegments bool) (map[string]int, error) {
	if gemDataDir == "" {
		gemDataDir = locateGEMDataDir()
	}
	if gemDataDir == "" {
		return nil, fmt.Errorf("GEM data dir not found (place trackers in madsan/data/gem/)")
	}
	specs := filterGEMTrackers(trackers)
	counts := map[string]int{}
	var firstErr error
	for _, spec := range specs {
		sourceID := uuid.Nil
		if !dryRun {
			sourceID, _ = s.ensureSource(ctx, spec.SourceSlug)
		}
		n, err := s.importGEMTracker(ctx, gemDataDir, spec, sourceID, maxRows, dryRun)
		counts[spec.Tracker] = n
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if includeLegacySegments && !dryRun {
		legacy, err := s.poolFromLegacy(ctx)
		if err == nil {
			n, segErr := s.importLegacyGEMPipelineSegments(ctx, legacy, maxRows)
			counts["gem_pipeline_segments"] = n
			legacy.Close()
			if segErr != nil && firstErr == nil {
				firstErr = segErr
			}
		} else if firstErr == nil {
			firstErr = err
		}
	}
	return counts, firstErr
}

func (s *Service) importGEMTracker(ctx context.Context, gemDataDir string, spec gemTrackerSpec, sourceID uuid.UUID, maxRows int, dryRun bool) (int, error) {
	path := filepath.Join(gemDataDir, spec.Filename)
	rows, err := readExcelSheet(path, spec.Sheet)
	if err != nil {
		return 0, err
	}
	imported := 0
	for i, row := range rows {
		if maxRows > 0 && imported >= maxRows {
			break
		}
		rec, ok := normalizeGEMRow(spec, row, i+2)
		if !ok {
			continue
		}
		if dryRun {
			imported++
			continue
		}
		if sourceID != uuid.Nil {
			_ = s.stageRecord(ctx, sourceID, rec, i+2)
		}
		entityID, uerr := s.upsertMaster(ctx, rec)
		if uerr != nil || entityID == uuid.Nil {
			continue
		}
		score := confidence.Score(75, map[string]bool{"has_coordinates": rec.Latitude != nil})
		if sourceID != uuid.Nil {
			_ = s.attachEvidence(ctx, sourceID, "asset", entityID, rec, score)
			_ = s.linkAssetOperator(ctx, entityID, rec, sourceID)
			if spec.Tracker == "gem_pipelines" {
				_ = s.upsertGEMPipelineEnrichment(ctx, entityID, rec, nil, sourceID)
			}
		}
		imported++
	}
	return imported, nil
}

func normalizeGEMRow(spec gemTrackerSpec, row map[string]string, rowIndex int) (NormalizedRecord, bool) {
	switch spec.Tracker {
	case "gem_extraction":
		return normalizeGEMExtractionRow(spec, row)
	case "gem_plants":
		return normalizeGEMPlantRow(spec, row)
	case "gem_pipelines":
		return normalizeGEMPipelineRow(spec, row, rowIndex)
	default:
		return NormalizedRecord{}, false
	}
}

func normalizeGEMExtractionRow(spec gemTrackerSpec, row map[string]string) (NormalizedRecord, bool) {
	unitID := gemCleanText(row["Unit ID"])
	country := gemCleanText(row["Country/Area"])
	if unitID == "" || country == "" {
		return NormalizedRecord{}, false
	}
	name := gemExtractionCompany(row)
	if name == "" {
		return NormalizedRecord{}, false
	}
	lat, lng := gemParseLatLng(row["Latitude"], row["Longitude"])
	raw := copyStringMap(row)
	raw["source_slug"] = spec.SourceSlug
	raw["data_tier"] = "observed"
	raw["source_name"] = "GEM Global Oil and Gas Extraction Tracker (March 2026)"
	raw["source_url"] = "https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/"
	if op := gemCleanText(row["Operator"]); op != "" {
		raw["operator_name"] = normalizeName(op)
	}
	fuel := gemCleanText(row["Fuel type"])
	commodity := "oil & gas"
	if fuel != "" {
		commodity = fuel
	}
	return NormalizedRecord{
		EntityType:  "asset",
		AssetType:   gemAssetTypeFromFuel(fuel),
		Name:        name,
		CountryCode: gemCountryCode(country),
		Latitude:    lat,
		Longitude:   lng,
		Commodities: []string{commodity},
		ExternalID:  unitID,
		SourceSlug:  spec.LegacyTable,
		RawPayload:  raw,
	}, true
}

func normalizeGEMPlantRow(spec gemTrackerSpec, row map[string]string) (NormalizedRecord, bool) {
	unitID := gemCleanText(row["GEM unit ID"])
	country := gemCleanText(row["Country/Area"])
	if unitID == "" || country == "" {
		return NormalizedRecord{}, false
	}
	name := gemPlantDisplayName(row)
	if name == "" {
		return NormalizedRecord{}, false
	}
	lat, lng := gemParseLatLng(row["Latitude"], row["Longitude"])
	if lat == nil || lng == nil {
		return NormalizedRecord{}, false
	}
	raw := copyStringMap(row)
	raw["source_slug"] = spec.SourceSlug
	raw["data_tier"] = "observed"
	raw["source_name"] = "GEM Global Oil and Gas Plant Tracker (GOGPT, January 2026)"
	raw["source_url"] = "https://globalenergymonitor.org/projects/global-oil-gas-plant-tracker/"
	if op := gemCleanText(row["Operator(s)"]); op != "" {
		raw["operator_name"] = normalizeName(op)
	}
	fuel := gemCleanText(row["Fuel"])
	return NormalizedRecord{
		EntityType:  "asset",
		AssetType:   gemAssetTypeFromFuel(fuel),
		Name:        name,
		CountryCode: gemCountryCode(country),
		Latitude:    lat,
		Longitude:   lng,
		Commodities: []string{fuelOrDefault(fuel, "oil & gas")},
		ExternalID:  unitID,
		SourceSlug:  spec.LegacyTable,
		RawPayload:  raw,
	}, true
}

func normalizeGEMPipelineRow(spec gemTrackerSpec, row map[string]string, rowIndex int) (NormalizedRecord, bool) {
	projectID := gemCleanText(row["ProjectID"])
	if projectID == "" {
		return NormalizedRecord{}, false
	}
	name := gemPipelineDisplayName(row)
	if name == "" {
		return NormalizedRecord{}, false
	}
	country := gemCleanText(row["Countries"])
	if country == "" {
		country = gemCleanText(row["StartCountry"])
	}
	raw := copyStringMap(row)
	raw["source_slug"] = spec.SourceSlug
	raw["data_tier"] = "observed"
	raw["geometry_note"] = "attributes_only_from_xlsx; route geometry imported separately when available"
	raw["source_name"] = "GEM Global Oil Infrastructure Tracker — Oil/NGL Pipelines (March 2025)"
	raw["source_url"] = "https://globalenergymonitor.org/projects/global-oil-infrastructure-tracker/"
	raw["segment_key"] = gemPipelineDedupKey(projectID, rowIndex, gemCleanText(row["SegmentName"]))
	if op := gemCleanText(row["Owner"]); op != "" {
		raw["owner_name"] = normalizeName(stripGEMOwnershipPct(op))
	}
	fuel := gemCleanText(row["Fuel"])
	return NormalizedRecord{
		EntityType:  "asset",
		AssetType:   "pipeline",
		Name:        name,
		CountryCode: gemCountryCode(strings.Split(country, ";")[0]),
		Commodities: []string{fuelOrDefault(fuel, "petroleum")},
		ExternalID:  raw["segment_key"].(string),
		SourceSlug:  spec.LegacyTable,
		RawPayload:  raw,
	}, true
}

func fuelOrDefault(fuel, fallback string) string {
	if fuel == "" {
		return fallback
	}
	return fuel
}

func copyStringMap(src map[string]string) map[string]any {
	out := make(map[string]any, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func readExcelSheet(path, sheet string) ([]map[string]string, error) {
	f, err := excelize.OpenFile(path)
	if err != nil {
		return nil, fmt.Errorf("open xlsx %s: %w", path, err)
	}
	defer f.Close()
	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, fmt.Errorf("read sheet %q: %w", sheet, err)
	}
	if len(rows) < 2 {
		return nil, nil
	}
	headers := rows[0]
	var out []map[string]string
	for _, row := range rows[1:] {
		m := map[string]string{}
		for i, h := range headers {
			h = strings.TrimSpace(h)
			if h == "" {
				continue
			}
			if i < len(row) {
				m[h] = row[i]
			}
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *Service) importLegacyGEMPipelineSegments(ctx context.Context, legacy *pgxpool.Pool, maxRows int) (int, error) {
	sourceID, _ := s.ensureSource(ctx, gemPipelineSourceSlug)
	const q = `
		SELECT segment_key, project_id, ST_AsEWKB(geom) AS geom_wkb, tags
		FROM gem_pipeline_segments
		ORDER BY segment_key OFFSET $1 LIMIT $2`
	imported := 0
	offset := 0
	for {
		if maxRows > 0 && imported >= maxRows {
			break
		}
		limit := legacyBatchSize
		if maxRows > 0 && imported+limit > maxRows {
			limit = maxRows - imported
		}
		rows, err := legacy.Query(ctx, q, offset, limit)
		if err != nil {
			return imported, err
		}
		batch, err := pgx.CollectRows(rows, pgx.RowToMap)
		if err != nil {
			return imported, err
		}
		if len(batch) == 0 {
			break
		}
		for _, row := range batch {
			segmentKey := gemCleanText(row["segment_key"])
			wkb, _ := row["geom_wkb"].([]byte)
			if segmentKey == "" || len(wkb) == 0 {
				continue
			}
			tags := parseTags(row["tags"])
			name := normalizeName(fmt.Sprint(tags["pipeline_name"]))
			if name == "" {
				name = normalizeName(segmentKey)
			}
			meta, _ := json.Marshal(map[string]any{
				"name":         name,
				"segment_key":  segmentKey,
				"legacy_id":    segmentKey,
				"project_id":   row["project_id"],
				"tags":         tags,
				"source_slug":  gemPipelineSourceSlug,
				"data_tier":    "observed",
				"geometry_src": "legacy_gem_pipeline_segments",
			})
			osmKey := gemPipelineOSMKey(segmentKey)
			_, err := s.pool.Exec(ctx, `
				INSERT INTO pipeline_graph_edges (osm_id, geom, metadata)
				VALUES ($1, ST_GeomFromEWKB($2)::geography, $3::jsonb)
				ON CONFLICT (osm_id) WHERE osm_id IS NOT NULL DO UPDATE SET
					geom = EXCLUDED.geom,
					metadata = EXCLUDED.metadata
			`, osmKey, wkb, meta)
			if err != nil {
				continue
			}
			if sourceID != uuid.Nil {
				rec := NormalizedRecord{
					EntityType: "asset", AssetType: "pipeline", Name: name,
					ExternalID: segmentKey, SourceSlug: "gem_goit_pipelines",
					CountryCode: gemCountryCode(fmt.Sprint(tags["countries"])),
					Commodities: []string{"petroleum"},
					RawPayload: map[string]any{"segment_key": segmentKey, "tags": tags, "data_tier": "observed"},
				}
				if owner := gemCleanText(tags["owner"]); owner != "" {
					rec.RawPayload["owner_name"] = normalizeName(stripGEMOwnershipPct(owner))
					rec.RawPayload["Owner"] = owner
				}
				for _, k := range []string{"Parent", "Fuel", "Status", "Capacity", "CapacityUnits", "Wiki", "OwnerEntityIDs", "project_id"} {
					if v := gemCleanText(tags[strings.ToLower(k)]); v != "" {
						rec.RawPayload[k] = v
					}
				}
				if entityID, uerr := s.upsertMaster(ctx, rec); uerr == nil && entityID != uuid.Nil {
					score := confidence.Score(75, map[string]bool{"has_coordinates": false})
					_ = s.attachEvidence(ctx, sourceID, "asset", entityID, rec, score)
					_ = s.upsertGEMPipelineEnrichment(ctx, entityID, rec, tags, sourceID)
				}
			}
			imported++
		}
		offset += len(batch)
		if len(batch) < limit {
			break
		}
	}
	return imported, nil
}

// RunTier2LegacyImport runs Phase C legacy DB tables plus optional GEM trackers.
func (s *Service) RunTier2LegacyImport(ctx context.Context, tables []string, gemDataDir string, maxRows int, dryRun bool, includeGEMSegments bool) (map[string]int, error) {
	counts := map[string]int{}
	var firstErr error

	var legacyTables []string
	var gemTrackers []string
	for _, t := range tables {
		t = strings.TrimSpace(t)
		if strings.HasPrefix(t, "gem_") {
			gemTrackers = append(gemTrackers, t)
			continue
		}
		legacyTables = append(legacyTables, t)
	}

	if len(tables) == 0 {
		legacyTables = []string{"oil_intelligence_cards", "entity_relationships"}
		gemTrackers = []string{"gem_extraction", "gem_plants", "gem_pipelines"}
	}

	if len(legacyTables) > 0 {
		legacyCounts, err := s.RunPhaseAImport(ctx, legacyTables, maxRows, dryRun)
		for k, v := range legacyCounts {
			counts[k] = v
		}
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	if len(gemTrackers) > 0 {
		gemCounts, err := s.RunGEMImport(ctx, gemDataDir, gemTrackers, maxRows, dryRun, includeGEMSegments)
		for k, v := range gemCounts {
			counts[k] = v
		}
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return counts, firstErr
}
