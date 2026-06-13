package ingestion

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"
)

const gemInfrastructureFoundationJobType = "gem_infrastructure_foundation"

type GEMInfrastructureFoundationOptions struct {
	Dir     string `json:"dir,omitempty"`
	MaxRows int    `json:"max_rows,omitempty"`
	Force   bool   `json:"force,omitempty"`
}

type GEMInfrastructureFoundationResult struct {
	GasPipelineRows    int   `json:"gas_pipeline_rows"`
	LNGTerminalRows    int   `json:"lng_terminal_rows"`
	LNGCarriers        int   `json:"lng_carriers"`
	VesselsMatched     int   `json:"vessels_matched"`
	VesselsInserted    int   `json:"vessels_inserted"`
	OwnershipEntities  int   `json:"ownership_entities"`
	OwnershipEdges     int   `json:"ownership_edges"`
	AssetOwnershipRows int   `json:"asset_ownership_rows"`
	FinanceExposures   int   `json:"finance_exposures"`
	PrivateEquityRows  int   `json:"private_equity_rows"`
	SourceReleases     int   `json:"source_releases"`
	SkippedReleases    int   `json:"skipped_releases"`
	DurationMillis     int64 `json:"duration_ms"`
}

func (s *Service) processGEMInfrastructureFoundation(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := GEMInfrastructureFoundationOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.ImportGEMInfrastructureFoundation(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) ImportGEMInfrastructureFoundation(ctx context.Context, opts GEMInfrastructureFoundationOptions) (GEMInfrastructureFoundationResult, error) {
	started := time.Now()
	dir := strings.TrimSpace(opts.Dir)
	if dir == "" {
		dir = locateGEMDataDir()
	}
	if dir == "" {
		return GEMInfrastructureFoundationResult{}, fmt.Errorf("GEM data dir not found")
	}

	res := GEMInfrastructureFoundationResult{}
	importers := []func(context.Context, string, GEMInfrastructureFoundationOptions, *GEMInfrastructureFoundationResult) error{
		s.importGGITGasPipelines,
		s.importGGITLNGTerminals,
		s.importLNGCarrierTracker,
		s.importGlobalEnergyOwnership,
		s.importGasFinanceTracker,
		s.importPECRFossilExposure,
	}
	for _, importer := range importers {
		if err := importer(ctx, dir, opts, &res); err != nil {
			res.DurationMillis = time.Since(started).Milliseconds()
			return res, err
		}
	}
	res.DurationMillis = time.Since(started).Milliseconds()
	return res, nil
}

func (s *Service) importGGITGasPipelines(ctx context.Context, dir string, opts GEMInfrastructureFoundationOptions, res *GEMInfrastructureFoundationResult) error {
	path := filepath.Join(dir, "GEM-GGIT-Gas-Pipelines-2025-11.xlsx")
	releaseID, skipped, err := s.prepareGEMInfrastructureRelease(ctx, "gem_ggit_gas_pipelines", "GEM Global Gas Infrastructure Tracker - Gas Pipelines", "xlsx", path, "November 2025", opts.Force)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if skipped {
		res.SkippedReleases++
		return nil
	}
	res.SourceReleases++

	rows, err := readExcelSheetUnique(path, "Pipelines")
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return err
	}
	rows = limitUniqueRows(rows, opts.MaxRows)
	sourceID, _ := s.ensureSource(ctx, "gem_ggit_gas_pipelines")
	written := 0
	ownershipRows := 0
	for i, row := range rows {
		projectID := gemCleanText(row["ProjectID"])
		if projectID == "" {
			continue
		}
		segmentKey := gemPipelineDedupKey(projectID, i+2, gemCleanText(row["SegmentName"]))
		name := gemPipelineDisplayName(row)
		if name == "" {
			continue
		}
		country := gemFirstCountry(row, "CountriesOrAreas", "StartCountryOrArea", "EndCountryOrArea")
		raw := uniqueRowRaw(row)
		raw["source_name"] = "GEM Global Gas Infrastructure Tracker - Gas Pipelines (November 2025)"
		raw["source_url"] = "https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/"
		raw["segment_key"] = segmentKey
		raw["data_tier"] = "observed"
		raw["evidence_label"] = "reported"
		rec := NormalizedRecord{
			EntityType:  "asset",
			AssetType:   "pipeline",
			Name:        name,
			CountryCode: gemCountryCode(country),
			Commodities: []string{"Gas"},
			ExternalID:  segmentKey,
			SourceSlug:  "gem_ggit_gas_pipelines",
			RawPayload:  raw,
		}
		assetID, err := s.upsertInfrastructureAsset(ctx, rec, 82)
		if err != nil {
			return err
		}
		if assetID != uuid.Nil {
			_ = s.attachEvidence(ctx, sourceID, "asset", assetID, rec, 82)
			written++
		}
		n, err := s.upsertGEMAssetOwnershipFromFields(ctx, gemAssetOwnershipInput{
			AssetID:          assetID,
			GEMAssetID:       projectID,
			GEMUnitID:        segmentKey,
			AssetName:        name,
			AssetType:        "gas_pipeline",
			CountryCode:      gemCountryCode(country),
			OwnerField:       row["Owner"],
			ParentField:      row["Parent"],
			ParentEntityIDs:  row["ParentEntityIDs"],
			SourceReleaseID:  releaseID,
			RawPayload:       raw,
			OwnerSourceField: "Owner",
		})
		if err != nil {
			return err
		}
		ownershipRows += n
	}
	res.GasPipelineRows += written
	res.AssetOwnershipRows += ownershipRows
	return s.completeGEMInfrastructureRelease(ctx, releaseID, map[string]any{
		"asset_rows":     written,
		"ownership_rows": ownershipRows,
		"sheet":          "Pipelines",
	})
}

func (s *Service) importGGITLNGTerminals(ctx context.Context, dir string, opts GEMInfrastructureFoundationOptions, res *GEMInfrastructureFoundationResult) error {
	path := filepath.Join(dir, "GEM-GGIT-LNG-Teminals-2025-09.xlsx")
	releaseID, skipped, err := s.prepareGEMInfrastructureRelease(ctx, "gem_ggit_lng_terminals", "GEM Global Gas Infrastructure Tracker - LNG Terminals", "xlsx", path, "September 2025", opts.Force)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if skipped {
		res.SkippedReleases++
		return nil
	}
	res.SourceReleases++

	rows, err := readExcelSheetUnique(path, "LNG Terminals")
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return err
	}
	rows = limitUniqueRows(rows, opts.MaxRows)
	sourceID, _ := s.ensureSource(ctx, "gem_ggit_lng_terminals")
	written := 0
	ownershipRows := 0
	for _, row := range rows {
		projectID := gemCleanText(row["ProjectID"])
		unitID := firstNonBlank(row["UnitID"], projectID)
		name := lngTerminalDisplayName(row)
		if unitID == "" || name == "" {
			continue
		}
		lat, lng := gemParseLatLng(row["Latitude"], row["Longitude"])
		raw := uniqueRowRaw(row)
		raw["source_name"] = "GEM Global Gas Infrastructure Tracker - LNG Terminals (September 2025)"
		raw["source_url"] = "https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/"
		raw["terminal_direction"] = strings.ToLower(gemCleanText(row["FacilityType"]))
		raw["data_tier"] = "observed"
		raw["evidence_label"] = "reported"
		rec := NormalizedRecord{
			EntityType:  "asset",
			AssetType:   "lng_terminal",
			Name:        name,
			CountryCode: gemCountryCode(row["Country/Area"]),
			Latitude:    lat,
			Longitude:   lng,
			Commodities: []string{"LNG", "Gas"},
			ExternalID:  unitID,
			SourceSlug:  "gem_ggit_lng_terminals",
			RawPayload:  raw,
		}
		assetID, err := s.upsertInfrastructureAsset(ctx, rec, 84)
		if err != nil {
			return err
		}
		if assetID != uuid.Nil {
			_ = s.attachEvidence(ctx, sourceID, "asset", assetID, rec, 84)
			_ = s.linkAssetOperator(ctx, assetID, NormalizedRecord{
				EntityType: "asset", AssetType: "lng_terminal", Name: name,
				CountryCode: rec.CountryCode, Commodities: rec.Commodities,
				RawPayload: map[string]any{"operator_name": normalizeName(row["Operator"])},
			}, sourceID)
			written++
		}
		n, err := s.upsertGEMAssetOwnershipFromFields(ctx, gemAssetOwnershipInput{
			AssetID:          assetID,
			GEMAssetID:       projectID,
			GEMUnitID:        unitID,
			AssetName:        name,
			AssetType:        "lng_terminal",
			CountryCode:      rec.CountryCode,
			OwnerField:       row["Owner"],
			OwnerEntityIDs:   row["Owner GEM Entity ID"],
			ParentField:      row["Parent"],
			ParentEntityIDs:  row["Parent GEM Entity ID"],
			SourceReleaseID:  releaseID,
			RawPayload:       raw,
			OwnerSourceField: "Owner",
		})
		if err != nil {
			return err
		}
		ownershipRows += n
	}
	res.LNGTerminalRows += written
	res.AssetOwnershipRows += ownershipRows
	return s.completeGEMInfrastructureRelease(ctx, releaseID, map[string]any{
		"asset_rows":     written,
		"ownership_rows": ownershipRows,
		"sheet":          "LNG Terminals",
	})
}

func (s *Service) importLNGCarrierTracker(ctx context.Context, dir string, opts GEMInfrastructureFoundationOptions, res *GEMInfrastructureFoundationResult) error {
	path := filepath.Join(dir, "LNG-Carrier-Tracker-December-2025-release.xlsx")
	releaseID, skipped, err := s.prepareGEMInfrastructureRelease(ctx, "gem_lng_carrier_tracker", "GEM LNG Carrier Tracker", "xlsx", path, "December 2025", opts.Force)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if skipped {
		res.SkippedReleases++
		return nil
	}
	res.SourceReleases++

	rows, err := readExcelSheetUnique(path, "data")
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return err
	}
	rows = limitUniqueRows(rows, opts.MaxRows)
	written := 0
	matched := 0
	inserted := 0
	for _, row := range rows {
		imo := numericText(row["IMO number"])
		name := normalizeName(row["Name"])
		if imo == "" || name == "" {
			continue
		}
		ownerName := normalizeName(row["Shipowner"])
		ownerCountry := gemCountryCode(row["Shipowner country/area"])
		var ownerID uuid.UUID
		if ownerName != "" {
			ownerID, _ = s.ensureCompanyByName(ctx, ownerName, ownerCountry, []string{"LNG"})
			_, _ = s.upsertGEMEntityRecord(ctx, "", ownerName, "shipowner", releaseID, map[string]any{
				"source":  "GEM LNG Carrier Tracker",
				"imo":     imo,
				"country": ownerCountry,
			})
		}
		vesselID, mmsi, wasInserted, err := s.upsertLNGCarrierVessel(ctx, row, ownerID)
		if err != nil {
			return err
		}
		if vesselID == uuid.Nil {
			continue
		}
		if wasInserted {
			inserted++
		} else {
			matched++
		}
		if mmsi != "" {
			_ = s.upsertLNGCarrierEnrichment(ctx, row, vesselID, mmsi, ownerID)
		}
		written++
	}
	res.LNGCarriers += written
	res.VesselsMatched += matched
	res.VesselsInserted += inserted
	return s.completeGEMInfrastructureRelease(ctx, releaseID, map[string]any{
		"carrier_rows":     written,
		"vessels_matched":  matched,
		"vessels_inserted": inserted,
		"sheet":            "data",
	})
}

func (s *Service) importGlobalEnergyOwnership(ctx context.Context, dir string, opts GEMInfrastructureFoundationOptions, res *GEMInfrastructureFoundationResult) error {
	path := filepath.Join(dir, "Global-Energy-Ownership-Tracker-May-2026-V1.xlsx")
	releaseID, skipped, err := s.prepareGEMInfrastructureRelease(ctx, "gem_global_energy_ownership", "GEM Global Energy Ownership Tracker", "xlsx", path, "May 2026", opts.Force)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if skipped {
		res.SkippedReleases++
		return nil
	}
	res.SourceReleases++

	entities, err := readExcelSheetUnique(path, "All Entities")
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return err
	}
	entities = limitUniqueRows(entities, opts.MaxRows)
	entityRows := 0
	entityCache := map[string]string{}
	for _, row := range entities {
		id := gemExplicitEntityID(row["Entity ID"])
		name := firstNonBlank(row["Full Name"], row["Name"])
		if id == "" || name == "" {
			continue
		}
		if _, err := s.upsertGEMEntityRecord(ctx, id, name, row["Entity Type"], releaseID, map[string]any{
			"full_name":             row["Full Name"],
			"name":                  row["Name"],
			"legal_entity_type":     row["Legal Entity Type"],
			"website":               row["Home Page"],
			"registration_country":  row["Registration Country"],
			"headquarters_country":  row["Headquarters Country"],
			"lei":                   row["Global Legal Entity Identifier Index"],
			"permid":                row["PermID: Refinitiv Permanent Identifier"],
			"registry_id":           firstNonBlank(row["US SEC Central Index Key"], row["UK Companies House"]),
			"source":                "GEM Global Energy Ownership Tracker",
			"evidence_label":        "reported",
			"commercial_use_status": "open_source_review_required",
		}); err != nil {
			return err
		} else {
			entityCache[gemEntityCacheKey(id, name)] = id
		}
		entityRows++
	}
	res.OwnershipEntities += entityRows

	edgeRows, err := s.importGEMEntityOwnershipEdges(ctx, path, releaseID, opts.MaxRows)
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return err
	}
	res.OwnershipEdges += edgeRows

	assetRows := 0
	assetImporters := []struct {
		Sheet     string
		AssetType string
		Legacy    string
		IDField   string
	}{
		{Sheet: "Oil & NGL Pipeline Ownership", AssetType: "oil_pipeline", Legacy: "gem_goit_pipelines", IDField: "ProjectID"},
		{Sheet: "Gas Pipeline Ownership", AssetType: "gas_pipeline", Legacy: "gem_ggit_gas_pipelines", IDField: "ProjectID"},
		{Sheet: "Gas Plant Ownership", AssetType: "gas_plant", Legacy: "gem_gogpt_plants", IDField: "GEM unit ID"},
	}
	for _, imp := range assetImporters {
		assetIndex, err := s.loadGEMAssetIndex(ctx, imp.Legacy)
		if err != nil {
			_ = s.markSourceReleaseFailed(ctx, releaseID, err)
			return err
		}
		n, err := s.importGEMOwnershipSheet(ctx, path, releaseID, imp.Sheet, imp.AssetType, imp.Legacy, imp.IDField, assetIndex, entityCache, opts.MaxRows)
		if err != nil {
			_ = s.markSourceReleaseFailed(ctx, releaseID, err)
			return err
		}
		assetRows += n
	}
	res.AssetOwnershipRows += assetRows
	return s.completeGEMInfrastructureRelease(ctx, releaseID, map[string]any{
		"entities":             entityRows,
		"entity_edges":         edgeRows,
		"asset_ownership_rows": assetRows,
		"sheets":               []string{"All Entities", "Entity Ownership", "Oil & NGL Pipeline Ownership", "Gas Pipeline Ownership", "Gas Plant Ownership"},
	})
}

func (s *Service) importGEMEntityOwnershipEdges(ctx context.Context, path string, releaseID uuid.UUID, maxRows int) (int, error) {
	rows, err := readExcelSheetUnique(path, "Entity Ownership")
	if err != nil {
		return 0, err
	}
	rows = limitUniqueRows(rows, maxRows)
	written := 0
	for _, row := range rows {
		subjectID := gemExplicitEntityID(row["Subject Entity ID"])
		interestedID := gemExplicitEntityID(row["Interested Party ID"])
		subjectName := row["Subject Entity Name"]
		interestedName := row["Interested Party Name"]
		if subjectID == "" || interestedID == "" || subjectName == "" || interestedName == "" {
			continue
		}
		if _, err := s.upsertGEMEntityRecord(ctx, subjectID, subjectName, "legal_entity", releaseID, map[string]any{"source": "GEM Entity Ownership"}); err != nil {
			return written, err
		}
		if _, err := s.upsertGEMEntityRecord(ctx, interestedID, interestedName, "owner", releaseID, map[string]any{"source": "GEM Entity Ownership"}); err != nil {
			return written, err
		}
		share, _ := gemParseNumber(row["% Share of Ownership"])
		tag, err := s.pool.Exec(ctx, `
			INSERT INTO gem_ownership_edges (
				subject_entity_id,
				interested_entity_id,
				relationship_type,
				share_pct,
				share_type,
				evidence_label,
				source_release_id,
				raw_payload
			)
			VALUES ($1,$2,'ownership',NULLIF($3,0),'equity','reported',$4,$5)
			ON CONFLICT (subject_entity_id, interested_entity_id, relationship_type, source_release_id) DO UPDATE SET
				share_pct = COALESCE(EXCLUDED.share_pct, gem_ownership_edges.share_pct),
				raw_payload = EXCLUDED.raw_payload
		`, subjectID, interestedID, share, releaseID, jsonMap(row))
		if err != nil {
			return written, err
		}
		written += int(tag.RowsAffected())
	}
	return written, nil
}

func (s *Service) importGEMOwnershipSheet(ctx context.Context, path string, releaseID uuid.UUID, sheet, assetType, legacyTable, idField string, assetIndex map[string]uuid.UUID, entityCache map[string]string, maxRows int) (int, error) {
	rows, err := readExcelSheetUnique(path, sheet)
	if err != nil {
		return 0, err
	}
	rows = limitUniqueRows(rows, maxRows)
	written := 0
	for _, row := range rows {
		parentID := gemExplicitEntityID(row["Parent GEM Entity ID"])
		parentName := normalizeName(row["Parent"])
		ownerID := gemExplicitEntityID(row["Immediate Project Owner GEM Entity ID"])
		ownerName := normalizeName(row["Immediate Project Owner"])
		assetKey := firstNonBlank(row[idField], row["ProjectID"], row["GEM unit ID"])
		assetName := normalizeName(row["Project"])
		if assetKey == "" || assetName == "" {
			continue
		}
		if parentName != "" {
			id, err := s.upsertCachedGEMEntityRecord(ctx, entityCache, parentID, parentName, "parent", releaseID, map[string]any{
				"registration_country": row["Parent Registration Country"],
				"headquarters_country": row["Parent Headquarters Country"],
				"source":               sheet,
			})
			if err != nil {
				return written, err
			}
			parentID = id
		}
		if ownerName != "" {
			id, err := s.upsertCachedGEMEntityRecord(ctx, entityCache, ownerID, ownerName, "owner", releaseID, map[string]any{"source": sheet})
			if err != nil {
				return written, err
			}
			ownerID = id
		}
		assetID := gemAssetIndexLookup(assetIndex, assetKey, assetName)
		share, _ := gemParseNumber(row["Share"])
		tag, err := s.pool.Exec(ctx, `
			INSERT INTO gem_asset_ownership (
				asset_id,
				gem_asset_id,
				gem_unit_id,
				asset_name,
				asset_type,
				country_code,
				operator_entity_id,
				owner_entity_id,
				parent_entity_id,
				share_pct,
				share_imputed,
				evidence_label,
				source_release_id,
				raw_payload
			)
			VALUES ($1,$2,$3,$4,$5,NULL,NULL,NULLIF($6,''),NULLIF($7,''),NULLIF($8,0),$9,'reported',$10,$11)
			ON CONFLICT DO NOTHING
		`, nullableUUID(assetID), assetKey, assetKey, assetName, assetType, ownerID, parentID, share, strings.Contains(strings.ToLower(row["Ownership Path"]+" "+row["Share"]), "unknown"), releaseID, jsonMap(row))
		if err != nil {
			return written, err
		}
		written += int(tag.RowsAffected())
	}
	return written, nil
}

func (s *Service) importGasFinanceTracker(ctx context.Context, dir string, opts GEMInfrastructureFoundationOptions, res *GEMInfrastructureFoundationResult) error {
	path := filepath.Join(dir, "Gas-Finance-Tracker-Data-December-2025.xlsx")
	releaseID, skipped, err := s.prepareGEMInfrastructureRelease(ctx, "gem_gas_finance_tracker", "GEM Gas Finance Tracker", "xlsx", path, "December 2025", opts.Force)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if skipped {
		res.SkippedReleases++
		return nil
	}
	res.SourceReleases++

	total := 0
	for _, sheet := range []string{"LNG Terminals", "Gas Power Plants"} {
		rows, err := readExcelSheetUnique(path, sheet)
		if err != nil {
			_ = s.markSourceReleaseFailed(ctx, releaseID, err)
			return err
		}
		rows = limitUniqueRows(rows, opts.MaxRows)
		for _, row := range rows {
			financier := normalizeName(row["Financier"])
			if financier == "" || isUnavailable(financier) {
				continue
			}
			assetName := normalizeName(row["Project Name"])
			country := gemCountryCode(row["Country"])
			assetID := s.findAssetByNameCountryType(ctx, assetName, country, []string{"lng_terminal", "processing_plant", "plant"})
			value, _ := gemParseNumber(firstNonBlank(row["This Financier's Total Share (US$ Million)"], row["This Financier's Total Financing Per Transaction (US$ Million)"], row["This Financier's Unit Share Per Transaction (US$ Million)"]))
			n, err := s.insertInvestorExposure(ctx, investorExposureInput{
				InvestorName:    financier,
				ExposedName:     assetName,
				ExposedAssetID:  assetID,
				ExposureType:    "project_finance",
				Commodity:       "GAS",
				CountryCode:     country,
				ExposureValue:   value,
				ExposureUnit:    "USD million",
				ConfidenceScore: 82,
				SourceReleaseID: releaseID,
				RawPayload:      uniqueRowRaw(row),
			})
			if err != nil {
				return err
			}
			total += n
		}
	}
	res.FinanceExposures += total
	return s.completeGEMInfrastructureRelease(ctx, releaseID, map[string]any{
		"finance_exposures": total,
		"sheets":            []string{"LNG Terminals", "Gas Power Plants"},
	})
}

func (s *Service) importPECRFossilExposure(ctx context.Context, dir string, opts GEMInfrastructureFoundationOptions, res *GEMInfrastructureFoundationResult) error {
	total := 0
	specs := []struct {
		SourceKey      string
		SourceName     string
		Path           string
		Kind           string
		ReleaseVersion string
	}{
		{
			SourceKey:      "pecr_global_fossil_asset_tracker",
			SourceName:     "PECR Global Fossil Fuel Asset Tracker",
			Path:           filepath.Join(dir, "PECR Global Fossil Fuel Asset Tracker (update in progress).csv"),
			Kind:           "csv_asset",
			ReleaseVersion: "2026 working copy",
		},
		{
			SourceKey:      "pecr_energy_tracker_jan_2025",
			SourceName:     "PECR Energy Tracker",
			Path:           filepath.Join(dir, "PECR - Energy Tracker Updated Jan '25.csv"),
			Kind:           "csv_company",
			ReleaseVersion: "January 2025",
		},
		{
			SourceKey:      "pecr_gas_oil_power_plants_2025_11",
			SourceName:     "PECR Gas and Oil Power Plants",
			Path:           filepath.Join(dir, "2025_11_PECR_Gas and Oil Power Plants.xlsx"),
			Kind:           "xlsx_power",
			ReleaseVersion: "November 2025",
		},
	}
	for _, spec := range specs {
		releaseID, skipped, err := s.prepareGEMInfrastructureRelease(ctx, spec.SourceKey, spec.SourceName, fileKind(spec.Path), spec.Path, spec.ReleaseVersion, opts.Force)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if skipped {
			res.SkippedReleases++
			continue
		}
		res.SourceReleases++
		var rows []map[string]string
		switch spec.Kind {
		case "xlsx_power":
			rows, err = readExcelSheetUnique(spec.Path, "Data")
		default:
			rows, err = readCSVUnique(spec.Path)
		}
		if err != nil {
			_ = s.markSourceReleaseFailed(ctx, releaseID, err)
			return err
		}
		rows = limitUniqueRows(rows, opts.MaxRows)
		written := 0
		for _, row := range rows {
			if !isOilGasPECRRow(row) {
				continue
			}
			n, err := s.importPECRExposureRow(ctx, row, releaseID, spec.Kind)
			if err != nil {
				return err
			}
			written += n
		}
		total += written
		if err := s.completeGEMInfrastructureRelease(ctx, releaseID, map[string]any{
			"private_equity_rows": written,
			"kind":                spec.Kind,
		}); err != nil {
			return err
		}
	}
	res.PrivateEquityRows += total
	return nil
}

func (s *Service) importPECRExposureRow(ctx context.Context, row map[string]string, releaseID uuid.UUID, kind string) (int, error) {
	investorField := firstNonBlank(row["Current PE Investor"], row["Most Recent PE Investor"], row["Current Investor"])
	investors := splitInvestorNames(investorField)
	if len(investors) == 0 {
		return 0, nil
	}
	exposedName := normalizeName(firstNonBlank(row["Asset Name"], row["Name"], row["Current Company"], row["Company"]))
	if exposedName == "" {
		return 0, nil
	}
	country := gemCountryCode(firstNonBlank(row["Asset Global"], row["Asset Country/Area"], row["HQ Country"]))
	commodity := strings.ToUpper(firstNonBlank(row["Asset Energy Sources"], row["Company Energy Source"]))
	assetID := uuid.Nil
	companyID := uuid.Nil
	if kind == "csv_company" {
		companyID, _ = s.ensureCompanyByName(ctx, exposedName, country, []string{commodity})
	} else {
		assetID = s.findAssetByNameCountryType(ctx, exposedName, country, []string{"lng_terminal", "processing_plant", "terminal", "storage", "tank_farm", "plant"})
		if assetID == uuid.Nil {
			companyID, _ = s.ensureCompanyByName(ctx, firstNonBlank(row["Current Company"], row["Company"]), country, []string{commodity})
		}
	}
	total := 0
	for _, investor := range investors {
		n, err := s.insertInvestorExposure(ctx, investorExposureInput{
			InvestorName:      investor,
			ExposedName:       exposedName,
			ExposedAssetID:    assetID,
			ExposedCompanyID:  companyID,
			ExposureType:      "private_equity",
			Commodity:         commodity,
			CountryCode:       country,
			ConfidenceScore:   80,
			SourceReleaseID:   releaseID,
			RawPayload:        uniqueRowRaw(row),
			OwnershipVerified: firstNonBlank(row["Asset Ownership Last Verified"], row["Ownership Verification Date"]),
		})
		if err != nil {
			return total, err
		}
		total += n
	}
	return total, nil
}

type gemAssetOwnershipInput struct {
	AssetID          uuid.UUID
	GEMAssetID       string
	GEMUnitID        string
	AssetName        string
	AssetType        string
	CountryCode      string
	OwnerField       string
	OwnerEntityIDs   string
	ParentField      string
	ParentEntityIDs  string
	SourceReleaseID  uuid.UUID
	RawPayload       map[string]any
	OwnerSourceField string
}

func (s *Service) upsertGEMAssetOwnershipFromFields(ctx context.Context, in gemAssetOwnershipInput) (int, error) {
	owners := parseGEMEntityRefs(in.OwnerField, in.OwnerEntityIDs)
	parents := parseGEMEntityRefs(in.ParentField, in.ParentEntityIDs)
	if len(owners) == 0 && len(parents) == 0 {
		return 0, nil
	}
	parentID := ""
	if len(parents) > 0 {
		id, err := s.upsertGEMEntityRecord(ctx, parents[0].ID, parents[0].Name, "parent", in.SourceReleaseID, map[string]any{"source_field": "Parent"})
		if err != nil {
			return 0, err
		}
		parentID = id
	}
	written := 0
	for _, owner := range owners {
		ownerID, err := s.upsertGEMEntityRecord(ctx, owner.ID, owner.Name, "owner", in.SourceReleaseID, map[string]any{"source_field": in.OwnerSourceField})
		if err != nil {
			return written, err
		}
		tag, err := s.pool.Exec(ctx, `
			INSERT INTO gem_asset_ownership (
				asset_id,
				gem_asset_id,
				gem_unit_id,
				asset_name,
				asset_type,
				country_code,
				operator_entity_id,
				owner_entity_id,
				parent_entity_id,
				share_pct,
				share_imputed,
				evidence_label,
				source_release_id,
				raw_payload
			)
			VALUES ($1,$2,$3,$4,$5,$6,NULL,NULLIF($7,''),NULLIF($8,''),$9,$10,'reported',$11,$12)
			ON CONFLICT DO NOTHING
		`, nullableUUID(in.AssetID), in.GEMAssetID, in.GEMUnitID, in.AssetName, in.AssetType, in.CountryCode, ownerID, parentID,
			owner.SharePct, owner.SharePct == nil, in.SourceReleaseID, in.RawPayload)
		if err != nil {
			return written, err
		}
		written += int(tag.RowsAffected())
	}
	return written, nil
}

type investorExposureInput struct {
	InvestorName      string
	ExposedName       string
	ExposedAssetID    uuid.UUID
	ExposedCompanyID  uuid.UUID
	ExposureType      string
	Commodity         string
	CountryCode       string
	ExposureValue     float64
	ExposureUnit      string
	SharePct          float64
	ConfidenceScore   float64
	SourceReleaseID   uuid.UUID
	RawPayload        map[string]any
	OwnershipVerified string
}

func (s *Service) insertInvestorExposure(ctx context.Context, in investorExposureInput) (int, error) {
	investorName := normalizeName(in.InvestorName)
	exposedName := normalizeName(in.ExposedName)
	if investorName == "" || exposedName == "" || isUnavailable(investorName) {
		return 0, nil
	}
	investorID, err := s.upsertGEMEntityRecord(ctx, "", investorName, "investor", in.SourceReleaseID, map[string]any{"source": "investor_exposure"})
	if err != nil {
		return 0, err
	}
	exposedID, err := s.upsertGEMEntityRecord(ctx, "", exposedName, "exposed_asset_or_company", in.SourceReleaseID, map[string]any{"source": "investor_exposure"})
	if err != nil {
		return 0, err
	}
	raw := in.RawPayload
	if raw == nil {
		raw = map[string]any{}
	}
	if in.OwnershipVerified != "" {
		raw["ownership_verified_at"] = in.OwnershipVerified
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO private_equity_exposures (
			investor_entity_id,
			investor_name,
			exposed_entity_id,
			exposed_company_id,
			exposed_asset_id,
			exposure_type,
			commodity,
			country_code,
			exposure_value,
			exposure_unit,
			share_pct,
			evidence_label,
			confidence_score,
			source_release_id,
			raw_payload
		)
		SELECT $1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,''),NULLIF($9,0),NULLIF($10,''),NULLIF($11,0),'reported',$12,$13,$14
		WHERE NOT EXISTS (
			SELECT 1 FROM private_equity_exposures
			WHERE investor_entity_id = $1
			  AND exposed_entity_id = $3
			  AND exposure_type = $6
			  AND source_release_id = $13
		)
	`, investorID, investorName, exposedID, nullableUUID(in.ExposedCompanyID), nullableUUID(in.ExposedAssetID), in.ExposureType,
		in.Commodity, in.CountryCode, in.ExposureValue, in.ExposureUnit, in.SharePct, in.ConfidenceScore, in.SourceReleaseID, raw)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (s *Service) upsertInfrastructureAsset(ctx context.Context, rec NormalizedRecord, score float64) (uuid.UUID, error) {
	if rec.ExternalID == "" || rec.SourceSlug == "" || rec.Name == "" {
		return uuid.Nil, nil
	}
	status := "verified"
	var assetID uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id
		FROM assets
		WHERE legacy_table = $1 AND legacy_id = $2
		ORDER BY updated_at DESC NULLS LAST
		LIMIT 1
	`, rec.SourceSlug, rec.ExternalID).Scan(&assetID)
	if err == nil {
		_, err = s.pool.Exec(ctx, `
			UPDATE assets
			SET name = $2,
				normalized_name = lower($2),
				asset_type = $3,
				latitude = COALESCE($4::double precision, latitude),
				longitude = COALESCE($5::double precision, longitude),
				geom = CASE
					WHEN $4::double precision IS NOT NULL AND $5::double precision IS NOT NULL
					THEN ST_SetSRID(ST_MakePoint($5::float8,$4::float8),4326)::geography
					ELSE geom
				END,
				country_code = COALESCE(NULLIF($6,''), country_code),
				commodities_supported = CASE WHEN cardinality($7::text[]) > 0 THEN $7 ELSE commodities_supported END,
				confidence_score = GREATEST(COALESCE(confidence_score, 0), $8),
				data_quality_status = $9,
				raw_source_payload = COALESCE(raw_source_payload, '{}'::jsonb) || $10::jsonb,
				updated_at = now()
			WHERE id = $1
		`, assetID, rec.Name, rec.AssetType, rec.Latitude, rec.Longitude, rec.CountryCode, rec.Commodities, score, status, rec.RawPayload)
		return assetID, err
	}
	if err != pgx.ErrNoRows {
		return uuid.Nil, err
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO assets (
			name, normalized_name, asset_type, latitude, longitude, geom,
			country_code, commodities_supported, confidence_score, data_quality_status,
			raw_source_payload, legacy_table, legacy_id
		)
		VALUES ($1,lower($1),$2,$3::double precision,$4::double precision,
			CASE WHEN $3::double precision IS NOT NULL AND $4::double precision IS NOT NULL
				THEN ST_SetSRID(ST_MakePoint($4::float8,$3::float8),4326)::geography ELSE NULL END,
			$5,$6,$7,$8,$9,$10,$11)
		RETURNING id
	`, rec.Name, rec.AssetType, rec.Latitude, rec.Longitude, rec.CountryCode, rec.Commodities, score, status, rec.RawPayload, rec.SourceSlug, rec.ExternalID).Scan(&assetID)
	return assetID, err
}

func (s *Service) upsertLNGCarrierVessel(ctx context.Context, row map[string]string, ownerCompanyID uuid.UUID) (uuid.UUID, string, bool, error) {
	imo := numericText(row["IMO number"])
	name := normalizeName(row["Name"])
	status := strings.ToLower(gemCleanText(row["Status"]))
	vesselClass := normalizeName(firstNonBlank(row["Vessel type"], "lng_carrier"))
	raw := uniqueRowRaw(row)
	raw["source_name"] = "GEM LNG Carrier Tracker (December 2025)"
	raw["evidence_label"] = "reported"

	var vesselID uuid.UUID
	var mmsi string
	err := s.pool.QueryRow(ctx, `
		SELECT id, COALESCE(mmsi, '')
		FROM vessels
		WHERE imo = $1
		ORDER BY updated_at DESC NULLS LAST
		LIMIT 1
	`, imo).Scan(&vesselID, &mmsi)
	if err == nil {
		_, err = s.pool.Exec(ctx, `
			UPDATE vessels
			SET name = COALESCE(NULLIF(name,''), $2),
				vessel_type = CASE
					WHEN lower(COALESCE(vessel_type,'')) LIKE '%lng%' THEN vessel_type
					ELSE 'lng_carrier'
				END,
				confidence_score = GREATEST(COALESCE(confidence_score, 0), 82),
				data_quality_status = CASE WHEN $3 = 'active' THEN 'reported_active' ELSE 'reported' END,
				updated_at = now()
			WHERE id = $1
		`, vesselID, name, status)
		return vesselID, mmsi, false, err
	}
	if err != pgx.ErrNoRows {
		return uuid.Nil, "", false, err
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO vessels (name, imo, vessel_type, confidence_score, data_quality_status)
		VALUES ($1,$2,'lng_carrier',82,CASE WHEN $3 = 'active' THEN 'reported_active' ELSE 'reported' END)
		RETURNING id
	`, name, imo, status).Scan(&vesselID)
	if err != nil {
		return uuid.Nil, "", false, err
	}
	_ = ownerCompanyID
	_ = vesselClass
	_ = raw
	return vesselID, "", true, nil
}

func (s *Service) upsertLNGCarrierEnrichment(ctx context.Context, row map[string]string, vesselID uuid.UUID, mmsi string, ownerCompanyID uuid.UUID) error {
	buildYear, _ := gemParseInt(row["Delivery year"])
	capacity, _ := gemParseNumber(row["Capacity"])
	raw := uniqueRowRaw(row)
	raw["capacity_cbm"] = capacity
	limitations := []string{"GEM LNG Carrier Tracker reports carrier identity and ownership; live AIS coverage may be incomplete."}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO vessel_enrichment (
			mmsi,
			vessel_id,
			imo,
			owner_name,
			owner_company_id,
			builder,
			build_year,
			vessel_class,
			source,
			tier,
			confidence_score,
			limitations,
			raw_payload,
			stale_after
		)
		VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,0),$8,'gem_lng_carrier_tracker','observed',82,$9,$10,now() + interval '365 days')
		ON CONFLICT (mmsi) DO UPDATE SET
			vessel_id = COALESCE(EXCLUDED.vessel_id, vessel_enrichment.vessel_id),
			imo = COALESCE(NULLIF(EXCLUDED.imo,''), vessel_enrichment.imo),
			owner_name = COALESCE(NULLIF(EXCLUDED.owner_name,''), vessel_enrichment.owner_name),
			owner_company_id = COALESCE(EXCLUDED.owner_company_id, vessel_enrichment.owner_company_id),
			builder = COALESCE(NULLIF(EXCLUDED.builder,''), vessel_enrichment.builder),
			build_year = COALESCE(EXCLUDED.build_year, vessel_enrichment.build_year),
			vessel_class = CASE
				WHEN lower(COALESCE(vessel_enrichment.vessel_class,'')) LIKE '%lng%' THEN vessel_enrichment.vessel_class
				ELSE COALESCE(NULLIF(EXCLUDED.vessel_class,''), 'lng_carrier')
			END,
			source = EXCLUDED.source,
			tier = EXCLUDED.tier,
			confidence_score = GREATEST(COALESCE(vessel_enrichment.confidence_score, 0), EXCLUDED.confidence_score),
			limitations = EXCLUDED.limitations,
			raw_payload = COALESCE(vessel_enrichment.raw_payload, '{}'::jsonb) || EXCLUDED.raw_payload,
			stale_after = EXCLUDED.stale_after,
			updated_at = now()
	`, mmsi, nullableUUID(vesselID), numericText(row["IMO number"]), nullString(normalizeName(row["Shipowner"])), nullableUUID(ownerCompanyID),
		nullString(normalizeName(row["Shipbuilder"])), buildYear, nullString(firstNonBlank(row["Vessel type"], "lng_carrier")), limitations, raw)
	return err
}

func (s *Service) upsertGEMEntityRecord(ctx context.Context, entityID, name, entityType string, releaseID uuid.UUID, raw map[string]any) (string, error) {
	name = normalizeName(stripGEMOwnershipPct(name))
	if name == "" || isUnavailable(name) {
		return "", nil
	}
	entityID = gemExplicitEntityID(entityID)
	if entityID == "" {
		entityID = gemEntityID(name)
	}
	if raw == nil {
		raw = map[string]any{}
	}
	lei := cleanIdentifier(fmt.Sprint(raw["lei"]))
	permid := cleanIdentifier(fmt.Sprint(raw["permid"]))
	registryID := cleanIdentifier(fmt.Sprint(raw["registry_id"]))
	website := strings.TrimSpace(fmt.Sprint(raw["website"]))
	regCountry := gemCountryCode(fmt.Sprint(raw["registration_country"]))
	hqCountry := gemCountryCode(fmt.Sprint(raw["headquarters_country"]))
	var companyID uuid.UUID
	_ = s.pool.QueryRow(ctx, `
		SELECT id
		FROM companies
		WHERE normalized_name = lower($1)
		ORDER BY confidence_score DESC NULLS LAST
		LIMIT 1
	`, name).Scan(&companyID)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO gem_entities (
			entity_id,
			name,
			full_name,
			normalized_name,
			lei,
			registry_id,
			permid,
			registration_country,
			headquarters_country,
			entity_type,
			legal_entity_type,
			website,
			raw_payload,
			source_release_id,
			matched_company_id
		)
		VALUES ($1,$2,$3,lower($2),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),NULLIF($11,''),$12,$13,$14)
		ON CONFLICT (entity_id) DO UPDATE SET
			name = COALESCE(NULLIF(EXCLUDED.name,''), gem_entities.name),
			full_name = COALESCE(NULLIF(EXCLUDED.full_name,''), gem_entities.full_name),
			normalized_name = EXCLUDED.normalized_name,
			lei = COALESCE(EXCLUDED.lei, gem_entities.lei),
			registry_id = COALESCE(EXCLUDED.registry_id, gem_entities.registry_id),
			permid = COALESCE(EXCLUDED.permid, gem_entities.permid),
			registration_country = COALESCE(EXCLUDED.registration_country, gem_entities.registration_country),
			headquarters_country = COALESCE(EXCLUDED.headquarters_country, gem_entities.headquarters_country),
			entity_type = COALESCE(NULLIF(gem_entities.entity_type,''), EXCLUDED.entity_type),
			legal_entity_type = COALESCE(EXCLUDED.legal_entity_type, gem_entities.legal_entity_type),
			website = COALESCE(EXCLUDED.website, gem_entities.website),
			raw_payload = COALESCE(gem_entities.raw_payload, '{}'::jsonb) || EXCLUDED.raw_payload,
			source_release_id = EXCLUDED.source_release_id,
			matched_company_id = COALESCE(gem_entities.matched_company_id, EXCLUDED.matched_company_id),
			updated_at = now()
	`, entityID, name, firstNonBlank(fmt.Sprint(raw["full_name"]), name), lei, registryID, permid, regCountry, hqCountry, entityType,
		fmt.Sprint(raw["legal_entity_type"]), website, raw, releaseID, nullableUUID(companyID))
	return entityID, err
}

func (s *Service) prepareGEMInfrastructureRelease(ctx context.Context, sourceKey, sourceName, sourceType, path, releaseVersion string, force bool) (uuid.UUID, bool, error) {
	checksum, rowCount, err := fingerprintFile(path)
	if err != nil {
		return uuid.Nil, false, err
	}
	var existingID uuid.UUID
	var existingStatus string
	err = s.pool.QueryRow(ctx, `
		SELECT id, import_status
		FROM data_source_releases
		WHERE source_key = $1 AND checksum = $2
	`, sourceKey, checksum).Scan(&existingID, &existingStatus)
	if err == nil && existingStatus == "completed" && !force {
		return existingID, true, nil
	}
	if err != nil && err != pgx.ErrNoRows {
		return uuid.Nil, false, err
	}
	var releaseID uuid.UUID
	err = s.pool.QueryRow(ctx, `
		INSERT INTO data_source_releases (
			source_key,
			source_name,
			source_type,
			path,
			checksum,
			row_count,
			release_version,
			attribution,
			license,
			commercial_use_ok,
			import_status,
			metadata
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'Global Energy Monitor / PECR source file','Open/public tracker; verify redistribution terms before export',true,'running','{}'::jsonb)
		ON CONFLICT (source_key, checksum)
		DO UPDATE SET
			path = EXCLUDED.path,
			row_count = EXCLUDED.row_count,
			import_status = 'running',
			updated_at = now()
		RETURNING id
	`, sourceKey, sourceName, sourceType, path, checksum, rowCount, releaseVersion).Scan(&releaseID)
	return releaseID, false, err
}

func (s *Service) completeGEMInfrastructureRelease(ctx context.Context, releaseID uuid.UUID, metadata map[string]any) error {
	b, _ := json.Marshal(metadata)
	_, err := s.pool.Exec(ctx, `
		UPDATE data_source_releases
		SET import_status = 'completed',
			imported_at = now(),
			metadata = $2,
			updated_at = now()
		WHERE id = $1
	`, releaseID, b)
	return err
}

func (s *Service) findGEMAssetID(ctx context.Context, legacyTable, key, name string) uuid.UUID {
	key = strings.TrimSpace(key)
	name = normalizeName(name)
	var id uuid.UUID
	if key != "" {
		_ = s.pool.QueryRow(ctx, `
			SELECT id
			FROM assets
			WHERE legacy_table = $1
			  AND (
				legacy_id = $2
				OR legacy_id LIKE $2 || ':%'
				OR raw_source_payload->>'ProjectID' = $2
				OR raw_source_payload->>'GEM unit ID' = $2
				OR raw_source_payload->>'UnitID' = $2
			  )
			ORDER BY confidence_score DESC NULLS LAST, updated_at DESC NULLS LAST
			LIMIT 1
		`, legacyTable, key).Scan(&id)
		if id != uuid.Nil {
			return id
		}
	}
	if name != "" {
		_ = s.pool.QueryRow(ctx, `
			SELECT id
			FROM assets
			WHERE legacy_table = $1
			  AND normalized_name = lower($2)
			ORDER BY confidence_score DESC NULLS LAST, updated_at DESC NULLS LAST
			LIMIT 1
		`, legacyTable, name).Scan(&id)
	}
	return id
}

func (s *Service) loadGEMAssetIndex(ctx context.Context, legacyTable string) (map[string]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			id,
			COALESCE(legacy_id, ''),
			COALESCE(normalized_name, ''),
			COALESCE(raw_source_payload->>'ProjectID', ''),
			COALESCE(raw_source_payload->>'GEM unit ID', ''),
			COALESCE(raw_source_payload->>'UnitID', '')
		FROM assets
		WHERE legacy_table = $1
		ORDER BY confidence_score DESC NULLS LAST, updated_at DESC NULLS LAST
	`, legacyTable)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	index := map[string]uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		var legacyID, normalizedName, projectID, gemUnitID, unitID string
		if err := rows.Scan(&id, &legacyID, &normalizedName, &projectID, &gemUnitID, &unitID); err != nil {
			continue
		}
		for _, key := range []string{legacyID, normalizedName, projectID, gemUnitID, unitID} {
			addAssetIndexKey(index, key, id)
		}
		if idx := strings.Index(legacyID, ":"); idx > 0 {
			addAssetIndexKey(index, legacyID[:idx], id)
		}
	}
	return index, rows.Err()
}

func addAssetIndexKey(index map[string]uuid.UUID, key string, id uuid.UUID) {
	key = gemAssetIndexKey(key)
	if key == "" || id == uuid.Nil {
		return
	}
	if _, exists := index[key]; !exists {
		index[key] = id
	}
}

func gemAssetIndexLookup(index map[string]uuid.UUID, key, name string) uuid.UUID {
	for _, candidate := range []string{key, name} {
		if id := index[gemAssetIndexKey(candidate)]; id != uuid.Nil {
			return id
		}
	}
	return uuid.Nil
}

func gemAssetIndexKey(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func (s *Service) findAssetByNameCountryType(ctx context.Context, name, country string, assetTypes []string) uuid.UUID {
	name = normalizeName(name)
	if name == "" {
		return uuid.Nil
	}
	var id uuid.UUID
	_ = s.pool.QueryRow(ctx, `
		SELECT id
		FROM assets
		WHERE normalized_name = lower($1)
		  AND ($2 = '' OR country_code = $2)
		  AND (cardinality($3::text[]) = 0 OR asset_type = ANY($3::text[]))
		ORDER BY confidence_score DESC NULLS LAST, updated_at DESC NULLS LAST
		LIMIT 1
	`, name, country, assetTypes).Scan(&id)
	return id
}

func (s *Service) upsertCachedGEMEntityRecord(ctx context.Context, cache map[string]string, entityID, name, entityType string, releaseID uuid.UUID, raw map[string]any) (string, error) {
	key := gemEntityCacheKey(entityID, name)
	if key != "" {
		if cached := cache[key]; cached != "" {
			return cached, nil
		}
	}
	id, err := s.upsertGEMEntityRecord(ctx, entityID, name, entityType, releaseID, raw)
	if err != nil {
		return "", err
	}
	if key != "" && id != "" {
		cache[key] = id
	}
	return id, nil
}

func gemEntityCacheKey(entityID, name string) string {
	if id := gemExplicitEntityID(entityID); id != "" {
		return id
	}
	if name = normalizeName(name); name != "" {
		return gemEntityID(name)
	}
	return ""
}

type gemEntityRef struct {
	ID       string
	Name     string
	SharePct *float64
}

func parseGEMEntityRefs(namesRaw, idsRaw string) []gemEntityRef {
	names := parseGEMOwnershipList(namesRaw)
	idParts := splitSemiList(idsRaw)
	out := make([]gemEntityRef, 0, len(names))
	for i, owner := range names {
		ref := gemEntityRef{Name: owner.Name, SharePct: owner.SharePct}
		if i < len(idParts) {
			ref.ID = gemExplicitEntityID(idParts[i])
		}
		out = append(out, ref)
	}
	if len(out) == 0 {
		for _, idPart := range idParts {
			if id := gemExplicitEntityID(idPart); id != "" {
				out = append(out, gemEntityRef{ID: id, Name: id})
			}
		}
	}
	return out
}

func splitSemiList(raw string) []string {
	parts := strings.Split(raw, ";")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = gemCleanText(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

var gemExplicitEntityIDRE = regexp.MustCompile(`E\d+`)

func gemExplicitEntityID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if match := gemExplicitEntityIDRE.FindString(raw); match != "" {
		return match
	}
	if strings.HasPrefix(raw, "gem:name:") {
		return raw
	}
	return ""
}

func readExcelSheetUnique(path, sheet string) ([]map[string]string, error) {
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
	headerIdx := firstHeaderRow(rows)
	headers := uniqueHeaders(rows[headerIdx])
	out := make([]map[string]string, 0, len(rows)-headerIdx-1)
	for _, row := range rows[headerIdx+1:] {
		m := map[string]string{}
		nonempty := 0
		for i, h := range headers {
			if h == "" {
				continue
			}
			if i < len(row) {
				v := strings.TrimSpace(row[i])
				if v != "" {
					nonempty++
				}
				m[h] = v
			}
		}
		if nonempty > 0 {
			out = append(out, m)
		}
	}
	return out, nil
}

func readCSVUnique(path string) ([]map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, nil
	}
	headers := uniqueHeaders(rows[0])
	out := make([]map[string]string, 0, len(rows)-1)
	for _, row := range rows[1:] {
		m := map[string]string{}
		nonempty := 0
		for i, h := range headers {
			if h == "" {
				continue
			}
			if i < len(row) {
				v := strings.TrimSpace(row[i])
				if v != "" {
					nonempty++
				}
				m[h] = v
			}
		}
		if nonempty > 0 {
			out = append(out, m)
		}
	}
	return out, nil
}

func firstHeaderRow(rows [][]string) int {
	for i, row := range rows {
		nonempty := 0
		for _, cell := range row {
			if strings.TrimSpace(cell) != "" {
				nonempty++
			}
		}
		if nonempty >= 3 {
			return i
		}
	}
	return 0
}

func uniqueHeaders(headers []string) []string {
	seen := map[string]int{}
	out := make([]string, len(headers))
	for i, h := range headers {
		h = cleanHeader(h)
		if h == "" {
			continue
		}
		seen[h]++
		if seen[h] == 1 {
			out[i] = h
		} else {
			out[i] = fmt.Sprintf("%s#%d", h, seen[h])
		}
	}
	return out
}

func cleanHeader(raw string) string {
	return strings.TrimSpace(strings.TrimPrefix(raw, "\ufeff"))
}

func limitUniqueRows(rows []map[string]string, max int) []map[string]string {
	if max <= 0 || len(rows) <= max {
		return rows
	}
	return rows[:max]
}

func uniqueRowRaw(row map[string]string) map[string]any {
	out := make(map[string]any, len(row))
	for k, v := range row {
		if strings.TrimSpace(k) != "" && strings.TrimSpace(v) != "" {
			out[k] = v
		}
	}
	return out
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if v := strings.TrimSpace(value); v != "" {
			return v
		}
	}
	return ""
}

func gemFirstCountry(row map[string]string, keys ...string) string {
	for _, key := range keys {
		value := gemCleanText(row[key])
		if value == "" {
			continue
		}
		value = strings.ReplaceAll(value, ",", ";")
		parts := strings.Split(value, ";")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
		return value
	}
	return ""
}

func lngTerminalDisplayName(row map[string]string) string {
	if unit := gemCleanText(row["UnitName"]); unit != "" {
		return normalizeName(gemCleanText(row["TerminalName"]) + " - " + unit)
	}
	return normalizeName(row["TerminalName"])
}

func numericText(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimSuffix(raw, ".0")
	raw = regexp.MustCompile(`[^0-9]`).ReplaceAllString(raw, "")
	return raw
}

func splitInvestorNames(raw string) []string {
	raw = strings.ReplaceAll(raw, ";", ",")
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		name := normalizeName(stripGEMOwnershipPct(part))
		if name == "" || isUnavailable(name) {
			continue
		}
		key := strings.ToLower(name)
		if !seen[key] {
			seen[key] = true
			out = append(out, name)
		}
	}
	return out
}

func isOilGasPECRRow(row map[string]string) bool {
	text := strings.ToLower(strings.Join([]string{
		row["Asset Energy Sector"],
		row["Asset Energy Type"],
		row["Asset Energy Source_Subtype"],
		row["Unit Energy Subtype (from Unit Outputs) (from Units)"],
		row["Asset Energy Sources"],
		row["Company Energy Source"],
	}, " "))
	if text == "" {
		return false
	}
	if strings.Contains(text, "renewable") && !strings.Contains(text, "gas") && !strings.Contains(text, "oil") {
		return false
	}
	return regexp.MustCompile(`\b(gas|oil|lng|lpg|refined petroleum|fossil|processing|storage|midstream|downstream)\b`).MatchString(text)
}

func isUnavailable(raw string) bool {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return true
	}
	switch raw {
	case "n/a", "na", "not available", "unknown", "--", "-", "<nil>":
		return true
	default:
		return false
	}
}

func cleanIdentifier(raw string) string {
	raw = strings.TrimSpace(raw)
	if isUnavailable(raw) || strings.EqualFold(raw, "not found") {
		return ""
	}
	return raw
}

func fileKind(path string) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(path)), ".")
	if ext == "" {
		return "file"
	}
	return ext
}

func parseFloatOrZero(raw string) float64 {
	raw = strings.ReplaceAll(strings.TrimSpace(raw), ",", "")
	f, _ := strconv.ParseFloat(raw, 64)
	return f
}
