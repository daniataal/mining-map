package mcr

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// Pools holds madsan primary DB and optional legacy mining_db for trade/commercial tables.
type Pools struct {
	Primary *pgxpool.Pool
	Legacy  *pgxpool.Pool
}

// BuildResult summarizes an MCR rebuild batch.
type BuildResult struct {
	Upserted int            `json:"upserted"`
	Recipes  map[string]int `json:"recipes"`
	Errors   []string       `json:"errors,omitempty"`
}

type mcrDraft struct {
	Fingerprint          string
	Recipe               string
	CommodityFamily      string
	Confidence           float64
	TriangulationScore   int
	ShipperName          *string
	ConsigneeName        *string
	ShipperCompanyID     *uuid.UUID
	ConsigneeCompanyID   *uuid.UUID
	VesselName           *string
	MMSI                 *string
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
	CorridorMMSI         *string
	CorridorLoadLat      *float64
	CorridorLoadLng      *float64
	CorridorDischargeLat *float64
	CorridorDischargeLng *float64
	EvidenceChain        []any
	Sources              []any
	ContactIDs           []uuid.UUID
	Metadata             map[string]any
}

type recipeFn struct {
	name string
	run  func(context.Context, Pools) ([]mcrDraft, error)
}

// RunRebuild executes triangulation recipes A–G and upserts MCR rows.
func RunRebuild(ctx context.Context, pools Pools, log zerolog.Logger) (BuildResult, error) {
	return runRecipeBatch(ctx, pools, log, allRecipes())
}

func allRecipes() []recipeFn {
	return []recipeFn{
		{RecipeLikelyLoad, recipeLikelyLoad},
		{RecipeCorridor, recipeCorridorTrade},
		{RecipeTenderBuyer, recipeTenderBuyer},
		{RecipeSulfurBulk, recipeSulfurBulk},
		{RecipeGovOfftake, recipeGovOfftake},
		{RecipeRepeatDealer, recipeRepeatDealer},
		{RecipeRefineryDriven, recipeRefineryDriven},
		{RecipePortManifestMatch, recipePortManifestMatch},
	}
}

func runRecipeBatch(ctx context.Context, pools Pools, log zerolog.Logger, recipes []recipeFn) (BuildResult, error) {
	res := BuildResult{Recipes: map[string]int{}}
	for _, rf := range recipes {
		drafts, err := rf.run(ctx, pools)
		if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("%s: %s", rf.name, err.Error()))
			log.Warn().Err(err).Str("recipe", rf.name).Msg("mcr recipe failed")
			continue
		}
		var upserted, skipped int
		for i := range drafts {
			d := &drafts[i]
			if d.TriangulationScore < MinTriangulationScore {
				skipped++
				continue
			}
			applyDischargeFallback(ctx, pools, d)
			ok, err := upsertMCR(ctx, pools.Primary, *d)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s: %s", rf.name, err.Error()))
				continue
			}
			if ok {
				upserted++
				res.Upserted++
				res.Recipes[d.Recipe]++
			}
		}
		log.Info().Str("recipe", rf.name).Int("drafts", len(drafts)).Int("upserted", upserted).Int("skipped_low_score", skipped).Msg("mcr recipe batch")
	}
	return res, nil
}

const madsanPortCallLiveClause = `
		  AND COALESCE(pc.metadata->>'source', '') <> 'seed_port_calls'
		  AND (
		    COALESCE(pc.metadata->>'source', '') = 'live_ais'
		    OR COALESCE(pc.evidence::text, '') ILIKE '%live_ais%'
		  )`

func recipeLikelyLoad(ctx context.Context, pools Pools) ([]mcrDraft, error) {
	if pools.Primary == nil {
		return nil, nil
	}
	rows, err := pools.Primary.Query(ctx, `
		SELECT pc.id, pc.mmsi, COALESCE(v.name, ''), pc.asset_id, COALESCE(pc.draft_delta_m, 0),
			pc.arrival_ts, COALESCE(pc.confidence_score, 0),
			a.name, COALESCE(c.name, 'Unknown'), COALESCE(a.country_code, ''), COALESCE(a.commodities_supported, ARRAY[]::text[]),
			ST_Y(a.geom::geometry), ST_X(a.geom::geometry),
			ve.deadweight_tons, v.imo, COALESCE(v.vessel_type, '')
		FROM port_call_visits pc
		JOIN assets a ON a.id = pc.asset_id
		LEFT JOIN companies c ON c.id = a.operator_company_id
		LEFT JOIN vessels v ON v.mmsi = pc.mmsi
		LEFT JOIN vessel_enrichment ve ON ve.mmsi = pc.mmsi
		WHERE pc.status = 'closed'
		  AND pc.event_type = 'possible_loading'
		  AND COALESCE(pc.draft_delta_m, 0) >= 1
		  AND pc.arrival_ts > now() - interval '180 days'`+madsanPortCallLiveClause+`
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []mcrDraft
	for rows.Next() {
		var pcID, assetID uuid.UUID
		var mmsi, vesselName, tname, operator, country, vtype string
		var products []string
		var draftDelta, conf, lat, lon float64
		var arrival time.Time
		var dwt *float64
		var imo *string
		if err := rows.Scan(&pcID, &mmsi, &vesselName, &assetID, &draftDelta, &arrival, &conf,
			&tname, &operator, &country, &products, &lat, &lon, &dwt, &imo, &vtype); err != nil {
			return out, err
		}
		if !isTankerClass(vtype) {
			continue
		}
		crude := strings.EqualFold(vtype, "crude")
		product := strings.EqualFold(vtype, "product")
		family := inferCommodityFamily(products, &crude, &product)
		if family == "" {
			continue
		}
		score := 2
		evidence := []any{
			fmt.Sprintf("Port call: possible_loading, draft +%.1fm", draftDelta),
			fmt.Sprintf("Terminal products: %s", strings.Join(products, ", ")),
		}
		sources := []any{map[string]string{"name": "port_call_visits", "field": "event_type"}}
		if crude {
			score++
			evidence = append(evidence, "Vessel classified crude tanker")
		}
		shipper := operator
		if shipper == "" {
			shipper = tname
		}
		shipperID, _ := resolveCompany(ctx, pools.Primary, shipper, country)
		var volLow, volHigh, volBest *float64
		method := strPtr("draft_delta")
		if dwt != nil && *dwt > 0 {
			if bbl, ok := EstimateBarrels(*dwt, draftDelta, 15); ok {
				volBest = &bbl
				lo := bbl * 0.85
				hi := bbl * 1.15
				volLow, volHigh = &lo, &hi
			}
		}
		name := vesselName
		fp := fingerprint(RecipeLikelyLoad, pcID.String())
		out = append(out, mcrDraft{
			Fingerprint: fp, Recipe: RecipeLikelyLoad, CommodityFamily: family,
			Confidence: ClampConf(conf * LikelyLoadConfMultiplier), TriangulationScore: score,
			ShipperName: strPtr(shipper), ShipperCompanyID: shipperID,
			VesselName: strPtr(name), MMSI: &mmsi, IMO: imo,
			LoadTerminalID: &assetID, LoadPortName: strPtr(tname), LoadCountry: strPtr(country),
			CommodityDescription: strPtr(family + " at " + tname),
			VolumeLow:            volLow, VolumeHigh: volHigh, VolumeBestEstimate: volBest, VolumeMethod: method,
			VolumeUnit: "bbl", EventDate: &arrival, PortCallID: &pcID,
			CorridorMMSI: &mmsi, CorridorLoadLat: &lat, CorridorLoadLng: &lon,
			EvidenceChain: evidence, Sources: sources,
		})
	}
	if len(out) > 0 || pools.Legacy == nil {
		return out, rows.Err()
	}
	return recipeLikelyLoadLegacy(ctx, pools.Legacy)
}

func recipeLikelyLoadLegacy(ctx context.Context, legacy *pgxpool.Pool) ([]mcrDraft, error) {
	rows, err := legacy.Query(ctx, `
		SELECT pc.id, pc.mmsi::text, pc.vessel_name, pc.terminal_id, pc.draft_delta, pc.arrival_ts, pc.confidence,
			t.name, COALESCE(t.operator_name, 'Unknown'), COALESCE(t.country, ''), COALESCE(t.products, ARRAY[]::text[]),
			ST_Y(t.geom::geometry), ST_X(t.geom::geometry),
			v.deadweight_tons, v.imo, COALESCE(v.tanker_class, '')
		FROM oil_port_calls pc
		JOIN oil_terminals t ON t.id = pc.terminal_id
		JOIN oil_vessels v ON v.mmsi = pc.mmsi
		  AND v.tanker_class IN ('crude', 'product', 'chemical', 'lng', 'lpg')
		WHERE pc.status = 'closed' AND pc.event_type = 'possible_loading' AND pc.draft_delta >= 1
		  AND pc.arrival_ts > now() - interval '180 days'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mcrDraft
	for rows.Next() {
		var pcID, tid uuid.UUID
		var mmsi, vesselName, tname, operator, country, tankerClass string
		var products []string
		var draftDelta, conf, lat, lon float64
		var arrival time.Time
		var dwt *float64
		var imo *string
		if err := rows.Scan(&pcID, &mmsi, &vesselName, &tid, &draftDelta, &arrival, &conf,
			&tname, &operator, &country, &products, &lat, &lon, &dwt, &imo, &tankerClass); err != nil {
			return out, err
		}
		crude := tankerClass == "crude"
		product := tankerClass == "product"
		family := inferCommodityFamily(products, &crude, &product)
		if family == "" {
			continue
		}
		fp := fingerprint(RecipeLikelyLoad, "legacy", pcID.String())
		confF := ClampConf(conf * LikelyLoadConfMultiplier)
		out = append(out, mcrDraft{
			Fingerprint: fp, Recipe: RecipeLikelyLoad, CommodityFamily: family,
			Confidence: confF, TriangulationScore: 2,
			ShipperName: strPtr(operator), VesselName: strPtr(vesselName), MMSI: &mmsi, IMO: imo,
			LoadPortName: strPtr(tname), LoadCountry: strPtr(country),
			EventDate: &arrival, CorridorMMSI: &mmsi, CorridorLoadLat: &lat, CorridorLoadLng: &lon,
			EvidenceChain: []any{"Legacy oil_port_calls possible_loading"},
			Sources:       []any{map[string]string{"name": "oil_port_calls", "tier": "legacy"}},
			Metadata:      map[string]any{"legacy_port_call_id": pcID.String()},
		})
	}
	return out, rows.Err()
}

func recipeCorridorTrade(ctx context.Context, pools Pools) ([]mcrDraft, error) {
	if pools.Primary == nil {
		return nil, nil
	}
	rows, err := pools.Primary.Query(ctx, `
		SELECT e.id, e.mmsi, COALESCE(v.name,''), e.asset_id, e.arrival_ts, COALESCE(e.draft_delta_m,0),
			ae.name, COALESCE(ae.country_code,''), COALESCE(ae.commodities_supported, ARRAY[]::text[]),
			ST_Y(ae.geom::geometry), ST_X(ae.geom::geometry),
			i.id, i.arrival_ts, ai.name, COALESCE(ai.country_code,''),
			ST_Y(ai.geom::geometry), ST_X(ai.geom::geometry)
		FROM port_call_visits e
		JOIN assets ae ON ae.id = e.asset_id
		JOIN vessels v ON v.mmsi = e.mmsi
		JOIN port_call_visits i ON i.mmsi = e.mmsi
			AND i.status = 'closed' AND i.event_type = 'possible_unloading'
			AND i.arrival_ts > COALESCE(e.departure_ts, e.arrival_ts)
			AND i.arrival_ts < COALESCE(e.departure_ts, e.arrival_ts) + interval '60 days'
		JOIN assets ai ON ai.id = i.asset_id
		WHERE e.status = 'closed' AND e.event_type = 'possible_loading'
		  AND ae.country_code IS NOT NULL AND ai.country_code IS NOT NULL
		  AND ae.country_code <> ai.country_code
		  AND e.arrival_ts > now() - interval '120 days'`+strings.ReplaceAll(madsanPortCallLiveClause, "pc.", "e.")+`
		ORDER BY e.arrival_ts DESC LIMIT 500
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []mcrDraft
	for rows.Next() {
		var exportPC, importPC, exportAsset uuid.UUID
		var mmsi, vessel, exportName, exportCountry, importName, importCountry string
		var products []string
		var exportArrival, importArrival time.Time
		var draftDelta, elat, elon, ilat, ilon float64
		if err := rows.Scan(&exportPC, &mmsi, &vessel, &exportAsset, &exportArrival, &draftDelta,
			&exportName, &exportCountry, &products, &elat, &elon,
			&importPC, &importArrival, &importName, &importCountry, &ilat, &ilon); err != nil {
			return out, err
		}
		family := inferCommodityFamily(products, nil, nil)
		if family == "" {
			family = "refined_products"
		}
		hs := hsForFamily(family)
		hasTrade, tradeVal := corridorTradeMatch(ctx, pools.Legacy, exportCountry, importCountry, hs)
		score := 2
		evidence := []any{
			fmt.Sprintf("Export visit: %s (%s)", exportName, exportCountry),
			fmt.Sprintf("Import visit: %s (%s)", importName, importCountry),
		}
		sources := []any{map[string]string{"name": "port_call_visits", "role": "export"}}
		if hasTrade {
			score++
			evidence = append(evidence, fmt.Sprintf("Trade corridor %s → %s HS %s", exportCountry, importCountry, hs))
		}
		conf := 0.62
		if hasTrade {
			conf = 0.78
		}
		var volBest *float64
		if tradeVal != nil && *tradeVal > 0 {
			est := *tradeVal / 80
			volBest = &est
		}
		fp := fingerprint(RecipeCorridor, exportPC.String(), importPC.String())
		out = append(out, mcrDraft{
			Fingerprint: fp, Recipe: RecipeCorridor, CommodityFamily: family,
			Confidence: conf, TriangulationScore: score,
			VesselName: strPtr(vessel), MMSI: &mmsi, LoadTerminalID: &exportAsset,
			LoadPortName: strPtr(exportName), LoadCountry: strPtr(exportCountry),
			DischargeHint: strPtr(importName), DischargeCountry: strPtr(importCountry),
			VolumeBestEstimate: volBest, VolumeMethod: strPtr("macro_corridor"), VolumeUnit: "bbl",
			EventDate: &exportArrival, PortCallID: &exportPC,
			CorridorMMSI: &mmsi, CorridorLoadLat: &elat, CorridorLoadLng: &elon,
			CorridorDischargeLat: &ilat, CorridorDischargeLng: &ilon,
			EvidenceChain: evidence, Sources: sources,
			Metadata: map[string]any{"import_port_call_id": importPC.String()},
		})
	}
	return out, rows.Err()
}

func recipeTenderBuyer(ctx context.Context, pools Pools) ([]mcrDraft, error) {
	if pools.Legacy == nil || !tableExists(ctx, pools.Legacy, "oil_commercial_events") {
		return nil, nil
	}
	rows, err := pools.Legacy.Query(ctx, `
		SELECT id, title, summary, country, partner_country, commodity_family, company_id, occurred_at
		FROM oil_commercial_events
		WHERE event_type = 'procurement_notice'
		  AND (commodity_family IS NOT NULL OR summary ILIKE '%diesel%' OR title ILIKE '%fuel%')
		ORDER BY created_at DESC NULLS LAST LIMIT 500
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mcrDraft
	for rows.Next() {
		var id uuid.UUID
		var title, summary, country string
		var partner, family *string
		var companyID *uuid.UUID
		var occurred *time.Time
		if err := rows.Scan(&id, &title, &summary, &country, &partner, &family, &companyID, &occurred); err != nil {
			return out, err
		}
		fam := "diesel"
		if family != nil && *family != "" {
			fam = *family
		}
		hasImport := countryHasHSImport(ctx, pools.Legacy, country, "2710")
		score := 2
		if hasImport {
			score++
		}
		fp := fingerprint(RecipeTenderBuyer, id.String())
		out = append(out, mcrDraft{
			Fingerprint: fp, Recipe: RecipeTenderBuyer, CommodityFamily: fam,
			Confidence: 0.58, TriangulationScore: score,
			ConsigneeName: strPtr(title), ConsigneeCompanyID: companyID,
			LoadCountry: partner, DischargeCountry: strPtr(country),
			CommodityDescription: strPtr("Procurement demand signal — " + fam),
			VolumeMethod:         strPtr("macro_demand"), VolumeUnit: "bbl", EventDate: occurred,
			CommercialEventID: &id,
			EvidenceChain:     []any{"TED/procurement notice", title},
			Sources:           []any{map[string]string{"name": "oil_commercial_events"}},
		})
	}
	return out, rows.Err()
}

func recipeSulfurBulk(ctx context.Context, pools Pools) ([]mcrDraft, error) {
	out, err := recipeSulfurFromPortCalls(ctx, pools)
	if err != nil {
		return out, err
	}
	terminalDrafts, err := recipeSulfurFromTerminals(ctx, pools.Primary)
	return append(out, terminalDrafts...), err
}

func recipeSulfurFromPortCalls(ctx context.Context, pools Pools) ([]mcrDraft, error) {
	if pools.Primary == nil {
		return nil, nil
	}
	rows, err := pools.Primary.Query(ctx, `
		SELECT pc.id, pc.mmsi, COALESCE(v.name,''), pc.asset_id, COALESCE(pc.duration_hours,0), pc.arrival_ts,
			a.name, COALESCE(c.name,''), COALESCE(a.country_code,''),
			ST_Y(a.geom::geometry), ST_X(a.geom::geometry)
		FROM port_call_visits pc
		JOIN assets a ON a.id = pc.asset_id
		LEFT JOIN companies c ON c.id = a.operator_company_id
		LEFT JOIN vessels v ON v.mmsi = pc.mmsi
		WHERE pc.status = 'closed'
		  AND ('sulfur' = ANY(a.commodities_supported) OR 'sulphur' = ANY(a.commodities_supported))
		  AND pc.arrival_ts > now() - interval '180 days'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mcrDraft
	for rows.Next() {
		var pcID, assetID uuid.UUID
		var mmsi, vessel, tname, operator, country string
		var duration, lat, lon float64
		var arrival time.Time
		if err := rows.Scan(&pcID, &mmsi, &vessel, &assetID, &duration, &arrival, &tname, &operator, &country, &lat, &lon); err != nil {
			return out, err
		}
		hasExport := countryHasHSExport(ctx, pools.Legacy, country, "2802")
		score := 2
		if hasExport {
			score++
		}
		shipper := operator
		if shipper == "" {
			shipper = tname
		}
		shipperID, _ := resolveCompany(ctx, pools.Primary, shipper, country)
		tonnes := duration * 500
		if tonnes < 1000 {
			tonnes = 1000
		}
		fp := fingerprint(RecipeSulfurBulk, pcID.String())
		out = append(out, mcrDraft{
			Fingerprint: fp, Recipe: RecipeSulfurBulk, CommodityFamily: "sulfur",
			Confidence: 0.65, TriangulationScore: score,
			ShipperName: strPtr(shipper), ShipperCompanyID: shipperID,
			VesselName: strPtr(vessel), MMSI: &mmsi, LoadTerminalID: &assetID,
			LoadPortName: strPtr(tname), LoadCountry: strPtr(country),
			CommodityDescription: strPtr("Elemental sulfur bulk export (inferred)"),
			VolumeBestEstimate:   &tonnes, VolumeMethod: strPtr("stay_duration_heuristic"), VolumeUnit: "mt",
			EventDate: &arrival, PortCallID: &pcID, CorridorMMSI: &mmsi,
			CorridorLoadLat: &lat, CorridorLoadLng: &lon,
			EvidenceChain: []any{fmt.Sprintf("Sulfur terminal visit %s (%.1fh)", tname, duration)},
			Sources:       []any{map[string]string{"name": "port_call_visits"}},
		})
	}
	return out, rows.Err()
}

func recipeSulfurFromTerminals(ctx context.Context, pool *pgxpool.Pool) ([]mcrDraft, error) {
	if pool == nil {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT id, name, COALESCE(country_code,''), latitude, longitude
		FROM assets
		WHERE 'sulfur' = ANY(commodities_supported) OR 'sulphur' = ANY(commodities_supported)
		ORDER BY confidence_score DESC NULLS LAST LIMIT 40
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mcrDraft
	for rows.Next() {
		var tid uuid.UUID
		var tname, country string
		var lat, lon *float64
		if err := rows.Scan(&tid, &tname, &country, &lat, &lon); err != nil {
			return out, err
		}
		score := 2
		tonnes := 25000.0
		now := time.Now().UTC().Add(-72 * time.Hour)
		fp := fingerprint(RecipeSulfurBulk, "terminal", tid.String())
		d := mcrDraft{
			Fingerprint: fp, Recipe: RecipeSulfurBulk, CommodityFamily: "sulfur",
			Confidence: 0.6, TriangulationScore: score,
			ShipperName: strPtr(tname), LoadTerminalID: &tid,
			LoadPortName: strPtr(tname), LoadCountry: strPtr(country),
			CommodityDescription: strPtr("Elemental sulfur bulk export (terminal tag)"),
			VolumeBestEstimate:   &tonnes, VolumeMethod: strPtr("terminal_capacity_hint"), VolumeUnit: "mt",
			EventDate:     &now,
			EvidenceChain: []any{fmt.Sprintf("Sulfur terminal tagged: %s", tname)},
			Sources:       []any{map[string]string{"name": "assets", "field": "products"}},
			Metadata:      map[string]any{"terminal_only": true},
		}
		if lat != nil && lon != nil {
			d.CorridorLoadLat, d.CorridorLoadLng = lat, lon
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func recipeGovOfftake(ctx context.Context, pools Pools) ([]mcrDraft, error) {
	if pools.Legacy == nil || !tableExists(ctx, pools.Legacy, "oil_commercial_events") {
		return nil, nil
	}
	rows, err := pools.Legacy.Query(ctx, `
		SELECT id, title, summary, country, company_id, occurred_at
		FROM oil_commercial_events
		WHERE event_type = 'gov_contract'
		  AND (summary ILIKE '%fuel%' OR title ILIKE '%oil%')
		  AND COALESCE(occurred_at, created_at) > now() - interval '730 days'
		ORDER BY COALESCE(occurred_at, created_at) DESC LIMIT 200
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mcrDraft
	for rows.Next() {
		var id uuid.UUID
		var title, summary, country string
		var companyID *uuid.UUID
		var occurred *time.Time
		if err := rows.Scan(&id, &title, &summary, &country, &companyID, &occurred); err != nil {
			return out, err
		}
		score := 2
		if countryHasHSExport(ctx, pools.Legacy, "United States", "2710") {
			score++
		}
		fp := fingerprint(RecipeGovOfftake, id.String())
		out = append(out, mcrDraft{
			Fingerprint: fp, Recipe: RecipeGovOfftake, CommodityFamily: "refined_products",
			Confidence: 0.55, TriangulationScore: score,
			ShipperName: strPtr(title), ShipperCompanyID: companyID,
			ConsigneeName: strPtr("US Government offtake"),
			LoadCountry:   strPtr("United States"), DischargeCountry: strPtr(country),
			CommodityDescription: strPtr("Government fuel offtake (inferred)"),
			VolumeMethod:         strPtr("contract_macro"), VolumeUnit: "bbl", EventDate: occurred,
			CommercialEventID: &id,
			EvidenceChain:     []any{"Gov contract petroleum keyword match", title},
			Sources:           []any{map[string]string{"name": "oil_commercial_events"}},
		})
	}
	return out, rows.Err()
}

func recipeRepeatDealer(ctx context.Context, pools Pools) ([]mcrDraft, error) {
	if pools.Primary == nil {
		return nil, nil
	}
	rows, err := pools.Primary.Query(ctx, `
		SELECT pc.asset_id, a.name, COALESCE(c.name,''), COALESCE(a.country_code,''), pc.mmsi,
			COUNT(*)::int, AVG(COALESCE(pc.draft_delta_m,0)),
			MAX(pc.arrival_ts), a.latitude, a.longitude
		FROM port_call_visits pc
		JOIN assets a ON a.id = pc.asset_id
		LEFT JOIN companies c ON c.id = a.operator_company_id
		WHERE pc.status = 'closed' AND pc.arrival_ts > now() - interval '180 days'
		GROUP BY pc.asset_id, a.name, c.name, a.country_code, pc.mmsi, a.latitude, a.longitude
		HAVING COUNT(*) >= 2
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mcrDraft
	for rows.Next() {
		var assetID uuid.UUID
		var tname, operator, country, mmsi string
		var visits int
		var avgDelta float64
		var lastVisit time.Time
		var lat, lon *float64
		if err := rows.Scan(&assetID, &tname, &operator, &country, &mmsi, &visits, &avgDelta, &lastVisit, &lat, &lon); err != nil {
			return out, err
		}
		shipper := operator
		if shipper == "" {
			shipper = tname
		}
		shipperID, _ := resolveCompany(ctx, pools.Primary, shipper, country)
		hasContact := companyHasContact(ctx, pools.Primary, shipperID)
		score := 2
		if hasContact {
			score++
		}
		conf := 0.72
		if hasContact {
			conf = 0.78
		}
		fp := fingerprint(RecipeRepeatDealer, mmsi, assetID.String())
		d := mcrDraft{
			Fingerprint: fp, Recipe: RecipeRepeatDealer, CommodityFamily: "crude_oil",
			Confidence: conf, TriangulationScore: score,
			ShipperName: strPtr(shipper), ShipperCompanyID: shipperID, MMSI: &mmsi,
			LoadTerminalID: &assetID, LoadPortName: strPtr(tname), LoadCountry: strPtr(country),
			CommodityDescription: strPtr("Possible term lift series (inferred)"),
			VolumeMethod:         strPtr("repeat_visit_average"), VolumeUnit: "bbl", EventDate: &lastVisit,
			CorridorMMSI:  &mmsi,
			EvidenceChain: []any{fmt.Sprintf("Repeat visits: %d at %s", visits, tname)},
			Sources:       []any{map[string]string{"name": "port_call_visits", "pattern": "repeat"}},
			Metadata:      map[string]any{"visit_count": visits, "avg_draft_delta": avgDelta},
		}
		if lat != nil && lon != nil {
			d.CorridorLoadLat, d.CorridorLoadLng = lat, lon
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func recipeRefineryDriven(ctx context.Context, pools Pools) ([]mcrDraft, error) {
	if pools.Primary == nil {
		return nil, nil
	}
	rows, err := pools.Primary.Query(ctx, `
		SELECT id, name, COALESCE(country_code,''), COALESCE(commodities_supported, ARRAY[]::text[]),
			latitude, longitude
		FROM assets
		WHERE asset_type IN ('refinery', 'terminal')
		  AND (name ILIKE '%refinery%' OR 'refined_products' = ANY(commodities_supported))
		ORDER BY confidence_score DESC NULLS LAST LIMIT 150
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mcrDraft
	for rows.Next() {
		var tid uuid.UUID
		var tname, country string
		var products []string
		var lat, lon *float64
		if err := rows.Scan(&tid, &tname, &country, &products, &lat, &lon); err != nil {
			return out, err
		}
		if country == "" {
			continue
		}
		if !countryHasHSImport(ctx, pools.Legacy, country, "2709") {
			continue
		}
		score := 2
		if refineryHasRecentPortCall(ctx, pools.Primary, tid) {
			score++
		}
		const dailyBbl = 350000.0
		vol := dailyBbl * 7
		volLow, volHigh := vol*0.7, vol*1.3
		eventDate := time.Now().UTC().Add(-24 * time.Hour)
		fp := fingerprint(RecipeRefineryDriven, tid.String())
		d := mcrDraft{
			Fingerprint: fp, Recipe: RecipeRefineryDriven, CommodityFamily: "crude_oil",
			Confidence: 0.7, TriangulationScore: score,
			ConsigneeName: strPtr(tname), DischargeHint: strPtr(tname), DischargeCountry: strPtr(country),
			CommodityDescription: strPtr(fmt.Sprintf("Refinery feedstock crude — %s", tname)),
			VolumeLow:            &volLow, VolumeHigh: &volHigh, VolumeBestEstimate: &vol,
			VolumeMethod: strPtr("refinery_throughput_estimate"), VolumeUnit: "bbl", EventDate: &eventDate,
			EvidenceChain: []any{fmt.Sprintf("Refinery terminal %s (%s)", tname, country)},
			Sources:       []any{map[string]string{"name": "assets", "field": "refinery_match"}},
			Metadata:      map[string]any{"refinery_terminal_id": tid.String()},
		}
		if lat != nil && lon != nil {
			d.CorridorDischargeLat, d.CorridorDischargeLng = lat, lon
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func refineryHasRecentPortCall(ctx context.Context, pool *pgxpool.Pool, assetID uuid.UUID) bool {
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM port_call_visits
		WHERE asset_id = $1 AND arrival_ts > now() - interval '90 days'
	`, assetID).Scan(&n)
	return n > 0
}

func recipePortManifestMatch(ctx context.Context, pools Pools) ([]mcrDraft, error) {
	if pools.Legacy == nil || !tableExists(ctx, pools.Legacy, "port_manifests") {
		return nil, nil
	}
	rows, err := pools.Legacy.Query(ctx, `
		SELECT vessel_imo, vessel_name, load_port, discharge_port, cargo_type, quantity_tons, created_at
		FROM port_manifests WHERE created_at > NOW() - INTERVAL '30 days' LIMIT 1000
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mcrDraft
	for rows.Next() {
		var imo string
		var name, loadPort, dischargePort, cargoType *string
		var quantity *float64
		var createdAt time.Time
		if err := rows.Scan(&imo, &name, &loadPort, &dischargePort, &cargoType, &quantity, &createdAt); err != nil {
			continue
		}
		desc := "Unknown Cargo"
		if cargoType != nil {
			desc = *cargoType
		}
		fp := fingerprint("manifest", imo, desc, createdAt.Format(time.RFC3339))
		out = append(out, mcrDraft{
			Fingerprint: fp, Recipe: RecipePortManifestMatch, CommodityFamily: "petroleum",
			Confidence: 0.95, TriangulationScore: 10,
			VesselName: name, IMO: &imo, LoadPortName: loadPort, DischargeHint: dischargePort,
			CommodityDescription: &desc, VolumeLow: quantity, VolumeHigh: quantity,
			VolumeUnit: "tons", EventDate: &createdAt,
			EvidenceChain: []any{"Direct port manifest match"},
			Sources:       []any{map[string]string{"name": "port_manifests"}},
		})
	}
	return out, rows.Err()
}

func corridorTradeMatch(ctx context.Context, pool *pgxpool.Pool, exportCountry, importCountry, hs string) (bool, *float64) {
	if pool == nil {
		return false, nil
	}
	var val *float64
	err := pool.QueryRow(ctx, `
		SELECT trade_value_usd FROM oil_trade_flows
		WHERE flow_type = 'X' AND hs_code = $3
		  AND reporter ILIKE $1 AND partner ILIKE $2
		ORDER BY ingested_at DESC NULLS LAST LIMIT 1
	`, "%"+exportCountry+"%", "%"+importCountry+"%", hs).Scan(&val)
	return err == nil, val
}

func countryHasHSImport(ctx context.Context, pool *pgxpool.Pool, country, hs string) bool {
	if pool == nil || country == "" {
		return false
	}
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM oil_trade_flows
		WHERE flow_type = 'M' AND hs_code = $2 AND (reporter ILIKE $1 OR partner ILIKE $1)
	`, "%"+country+"%", hs).Scan(&n)
	return n > 0
}

func countryHasHSExport(ctx context.Context, pool *pgxpool.Pool, country, hs string) bool {
	if pool == nil || country == "" {
		return false
	}
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM oil_trade_flows
		WHERE flow_type = 'X' AND hs_code = $2 AND reporter ILIKE $1
	`, "%"+country+"%", hs).Scan(&n)
	return n > 0
}

func upsertMCR(ctx context.Context, pool *pgxpool.Pool, d mcrDraft) (bool, error) {
	synID := "MCR-" + d.Fingerprint[:12]
	evidence, _ := json.Marshal(d.EvidenceChain)
	sources, _ := json.Marshal(d.Sources)
	meta, _ := json.Marshal(d.Metadata)
	if d.Metadata == nil {
		meta = []byte("{}")
	}
	unit := d.VolumeUnit
	if unit == "" {
		unit = "bbl"
	}
	var insertedID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO meridian_cargo_records (
			synthetic_bol_id, fingerprint, recipe, commodity_family, confidence, triangulation_score,
			bol_tier, shipper_name, consignee_name, shipper_company_id, consignee_company_id,
			vessel_name, mmsi, imo, load_terminal_id, load_port_name, load_country,
			discharge_hint, discharge_country, commodity_description,
			volume_low, volume_high, volume_best_estimate, volume_method, volume_unit,
			event_date, port_call_id, commercial_event_id, opportunity_id,
			corridor_mmsi, corridor_load_lat, corridor_load_lng, corridor_discharge_lat, corridor_discharge_lng,
			evidence_chain, sources, contact_ids, metadata, updated_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,'synthetic',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
			$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37, now()
		)
		ON CONFLICT (fingerprint) DO UPDATE SET
			confidence = EXCLUDED.confidence,
			triangulation_score = EXCLUDED.triangulation_score,
			evidence_chain = EXCLUDED.evidence_chain,
			sources = EXCLUDED.sources,
			metadata = EXCLUDED.metadata,
			updated_at = now()
		RETURNING id
	`, synID, d.Fingerprint, d.Recipe, d.CommodityFamily, d.Confidence, d.TriangulationScore,
		d.ShipperName, d.ConsigneeName, d.ShipperCompanyID, d.ConsigneeCompanyID,
		d.VesselName, d.MMSI, d.IMO, d.LoadTerminalID, d.LoadPortName, d.LoadCountry,
		d.DischargeHint, d.DischargeCountry, d.CommodityDescription,
		d.VolumeLow, d.VolumeHigh, d.VolumeBestEstimate, d.VolumeMethod, unit,
		d.EventDate, d.PortCallID, d.CommercialEventID, d.OpportunityID,
		d.CorridorMMSI, d.CorridorLoadLat, d.CorridorLoadLng, d.CorridorDischargeLat, d.CorridorDischargeLng,
		evidence, sources, d.ContactIDs, meta,
	).Scan(&insertedID)
	if err != nil {
		return false, err
	}
	return insertedID != uuid.Nil, nil
}
