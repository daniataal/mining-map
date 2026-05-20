package syntheticbol

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/services/volume"
)

const (
	RecipeLikelyLoad   = "A_likely_load"
	RecipeCorridor     = "B_corridor_trade"
	RecipeTenderBuyer  = "C_tender_buyer"
	RecipeSulfurBulk   = "D_sulfur_bulk"
	RecipeGovOfftake   = "E_gov_offtake"
	RecipeRepeatDealer = "F_repeat_dealer"
)

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
}

// RunRebuild executes triangulation recipes A–F and upserts MCR rows.
func RunRebuild(ctx context.Context, pool *pgxpool.Pool, log zerolog.Logger) (BuildResult, error) {
	res := BuildResult{Recipes: map[string]int{}}
	recipes := []func(context.Context, *pgxpool.Pool) ([]mcrDraft, error){
		recipeLikelyLoad,
		recipeCorridorTrade,
		recipeTenderBuyer,
		recipeSulfurBulk,
		recipeGovOfftake,
		recipeRepeatDealer,
	}
	for _, fn := range recipes {
		drafts, err := fn(ctx, pool)
		if err != nil {
			res.Errors = append(res.Errors, err.Error())
			log.Warn().Err(err).Msg("synthetic bol recipe failed")
			continue
		}
		for i := range drafts {
			d := &drafts[i]
			if d.TriangulationScore < 2 {
				continue
			}
			applyDischargeFallback(ctx, pool, d)
			ok, err := upsertMCR(ctx, pool, *d)
			if err != nil {
				res.Errors = append(res.Errors, err.Error())
				continue
			}
			if ok {
				res.Upserted++
				res.Recipes[d.Recipe]++
			}
		}
	}
	return res, nil
}

func recipeLikelyLoad(ctx context.Context, pool *pgxpool.Pool) ([]mcrDraft, error) {
	rows, err := pool.Query(ctx, `
		SELECT pc.id, pc.mmsi, pc.vessel_name, pc.terminal_id, pc.draft_delta, pc.arrival_ts, pc.confidence,
			t.name, t.operator_name, t.country, t.products,
			ST_Y(t.geom::geometry) AS lat, ST_X(t.geom::geometry) AS lon,
			v.crude_capable, v.product_tanker, v.deadweight_tons, v.max_draft_m, v.imo, v.name AS vname
		FROM oil_port_calls pc
		JOIN oil_terminals t ON t.id = pc.terminal_id
		LEFT JOIN oil_vessels v ON v.mmsi = pc.mmsi
		WHERE pc.status = 'closed'
		  AND pc.event_type = 'possible_loading'
		  AND pc.draft_delta >= 1
		  AND pc.arrival_ts > now() - interval '180 days'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []mcrDraft
	for rows.Next() {
		var pcID, tid uuid.UUID
		var mmsi int64
		var vesselName, tname, operator, country string
		var products []string
		var draftDelta, conf, lat, lon float64
		var arrival time.Time
		var crudeCapable, productTanker *bool
		var dwt, maxDraft *float64
		var imo, vname *string
		if err := rows.Scan(
			&pcID, &mmsi, &vesselName, &tid, &draftDelta, &arrival, &conf,
			&tname, &operator, &country, &products, &lat, &lon,
			&crudeCapable, &productTanker, &dwt, &maxDraft, &imo, &vname,
		); err != nil {
			return out, err
		}
		family := inferCommodityFamily(products, crudeCapable, productTanker)
		if family == "" {
			continue
		}
		if family == "crude_oil" && (crudeCapable == nil || !*crudeCapable) {
			continue
		}
		score := 2
		evidence := []any{
			fmt.Sprintf("Port call: possible_loading, draft +%.1fm", draftDelta),
			fmt.Sprintf("Terminal products: %s", strings.Join(products, ", ")),
		}
		sources := []any{
			map[string]string{"name": "oil_port_calls", "field": "event_type"},
			map[string]string{"name": "oil_terminals", "field": "products"},
		}
		if crudeCapable != nil && *crudeCapable {
			score++
			evidence = append(evidence, "Vessel flagged crude_capable")
			sources = append(sources, map[string]string{"name": "oil_vessels", "field": "crude_capable"})
		} else if productTanker != nil && *productTanker {
			score++
			evidence = append(evidence, "Vessel flagged product_tanker")
			sources = append(sources, map[string]string{"name": "oil_vessels", "field": "product_tanker"})
		}

		var volLow, volHigh, volBest *float64
		method := strPtr("draft_delta")
		if dwt != nil && maxDraft != nil {
			if bbl, ok := volume.EstimateBarrels(*dwt, draftDelta, *maxDraft); ok {
				volBest = &bbl
				lo := bbl * 0.85
				hi := bbl * 1.15
				volLow = &lo
				volHigh = &hi
			}
		}

		shipper := operator
		if shipper == "" {
			shipper = tname
		}
		shipperID, _ := resolveCompany(ctx, pool, shipper, country)
		name := vesselName
		if name == "" && vname != nil {
			name = *vname
		}
		vn := name
		fp := fingerprint(RecipeLikelyLoad, pcID.String())
		out = append(out, mcrDraft{
			Fingerprint:          fp,
			Recipe:               RecipeLikelyLoad,
			CommodityFamily:      family,
			Confidence:           clampConf(conf * 0.95),
			TriangulationScore:   score,
			ShipperName:          strPtr(shipper),
			ShipperCompanyID:     shipperID,
			VesselName:           strPtr(vn),
			MMSI:                 &mmsi,
			IMO:                  imo,
			LoadTerminalID:       &tid,
			LoadPortName:         strPtr(tname),
			LoadCountry:          strPtr(country),
			CommodityDescription: strPtr(family + " at " + tname),
			VolumeLow:            volLow,
			VolumeHigh:           volHigh,
			VolumeBestEstimate:   volBest,
			VolumeMethod:         method,
			VolumeUnit:           "bbl",
			EventDate:            &arrival,
			PortCallID:           &pcID,
			CorridorMMSI:         &mmsi,
			CorridorLoadLat:      &lat,
			CorridorLoadLng:      &lon,
			EvidenceChain:        evidence,
			Sources:              sources,
		})
	}
	return out, rows.Err()
}

func recipeCorridorTrade(ctx context.Context, pool *pgxpool.Pool) ([]mcrDraft, error) {
	rows, err := pool.Query(ctx, `
		SELECT e.id, e.mmsi, e.vessel_name, e.terminal_id, e.arrival_ts, e.draft_delta,
			te.name, te.country, te.products,
			ST_Y(te.geom::geometry) AS elat, ST_X(te.geom::geometry) AS elon,
			i.id, i.arrival_ts, ti.name, ti.country,
			ST_Y(ti.geom::geometry) AS ilat, ST_X(ti.geom::geometry) AS ilon
		FROM oil_port_calls e
		JOIN oil_terminals te ON te.id = e.terminal_id
		JOIN oil_port_calls i ON i.mmsi = e.mmsi
			AND i.status = 'closed'
			AND i.event_type = 'possible_unloading'
			AND i.arrival_ts > e.departure_ts
			AND i.arrival_ts < e.departure_ts + interval '60 days'
		JOIN oil_terminals ti ON ti.id = i.terminal_id
		WHERE e.status = 'closed'
		  AND e.event_type = 'possible_loading'
		  AND te.country IS NOT NULL AND ti.country IS NOT NULL
		  AND te.country <> ti.country
		  AND e.arrival_ts > now() - interval '120 days'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []mcrDraft
	for rows.Next() {
		var exportPC, importPC, exportTerm uuid.UUID
		var mmsi int64
		var vessel, exportName, exportCountry string
		var importName, importCountry string
		var products []string
		var exportArrival, importArrival time.Time
		var draftDelta, elat, elon, ilat, ilon float64
		if err := rows.Scan(
			&exportPC, &mmsi, &vessel, &exportTerm, &exportArrival, &draftDelta,
			&exportName, &exportCountry, &products, &elat, &elon,
			&importPC, &importArrival, &importName, &importCountry, &ilat, &ilon,
		); err != nil {
			return out, err
		}
		hs := hsForFamily(inferCommodityFamily(products, nil, nil))
		hasTrade, tradeVal := corridorTradeMatch(ctx, pool, exportCountry, importCountry, hs)
		score := 2
		evidence := []any{
			fmt.Sprintf("Export visit: %s (%s)", exportName, exportCountry),
			fmt.Sprintf("Import visit: %s (%s)", importName, importCountry),
		}
		sources := []any{
			map[string]string{"name": "oil_port_calls", "role": "export"},
			map[string]string{"name": "oil_port_calls", "role": "import"},
		}
		if hasTrade {
			score++
			evidence = append(evidence, fmt.Sprintf("Comtrade corridor %s → %s HS %s", exportCountry, importCountry, hs))
			sources = append(sources, map[string]string{"name": "oil_trade_flows", "hs_code": hs})
		}
		family := inferCommodityFamily(products, nil, nil)
		if family == "" {
			family = "refined_products"
		}
		fp := fingerprint(RecipeCorridor, exportPC.String(), importPC.String())
		conf := 0.62
		if hasTrade {
			conf = 0.78
		}
		var volBest *float64
		if tradeVal != nil && *tradeVal > 0 {
			est := *tradeVal / 80 // rough macro band per voyage
			volBest = &est
		}
		out = append(out, mcrDraft{
			Fingerprint:        fp,
			Recipe:               RecipeCorridor,
			CommodityFamily:      family,
			Confidence:           conf,
			TriangulationScore:   score,
			VesselName:           strPtr(vessel),
			MMSI:                 &mmsi,
			LoadTerminalID:       &exportTerm,
			LoadPortName:         strPtr(exportName),
			LoadCountry:          strPtr(exportCountry),
			DischargeHint:        strPtr(importName),
			DischargeCountry:     strPtr(importCountry),
			VolumeBestEstimate:   volBest,
			VolumeMethod:         strPtr("macro_corridor"),
			VolumeUnit:           "bbl",
			EventDate:            &exportArrival,
			PortCallID:           &exportPC,
			CorridorMMSI:         &mmsi,
			CorridorLoadLat:      &elat,
			CorridorLoadLng:      &elon,
			CorridorDischargeLat: &ilat,
			CorridorDischargeLng: &ilon,
			EvidenceChain:        evidence,
			Sources:              sources,
			Metadata:             map[string]any{"import_port_call_id": importPC.String()},
		})
	}
	return out, rows.Err()
}

func recipeTenderBuyer(ctx context.Context, pool *pgxpool.Pool) ([]mcrDraft, error) {
	if !tableExists(ctx, pool, "oil_commercial_events") {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT id, title, summary, country, partner_country, commodity_family, company_id, occurred_at
		FROM oil_commercial_events
		WHERE event_type = 'procurement_notice'
		  AND (commodity_family IS NOT NULL OR summary ILIKE '%diesel%' OR summary ILIKE '%gasoil%' OR title ILIKE '%fuel%')
		  AND occurred_at > now() - interval '365 days'
		ORDER BY occurred_at DESC NULLS LAST
		LIMIT 200
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
		hasImport := countryHasHSImport(ctx, pool, country, "2710")
		score := 2
		evidence := []any{
			"TED/procurement notice matched petroleum keywords",
			title,
		}
		sources := []any{map[string]string{"name": "oil_commercial_events", "event_type": "procurement_notice"}}
		if hasImport {
			score++
			evidence = append(evidence, fmt.Sprintf("Comtrade import HS 2710 for %s", country))
			sources = append(sources, map[string]string{"name": "oil_trade_flows", "hs_code": "2710"})
		}
		buyer := title
		if len(buyer) > 80 {
			buyer = buyer[:80]
		}
		fp := fingerprint(RecipeTenderBuyer, id.String())
		out = append(out, mcrDraft{
			Fingerprint:        fp,
			Recipe:               RecipeTenderBuyer,
			CommodityFamily:      fam,
			Confidence:           0.58,
			TriangulationScore:   score,
			ConsigneeName:        strPtr(buyer),
			ConsigneeCompanyID:   companyID,
			LoadCountry:          partner,
			DischargeCountry:     strPtr(country),
			CommodityDescription: strPtr("Procurement demand signal — " + fam),
			VolumeMethod:         strPtr("macro_demand"),
			VolumeUnit:           "bbl",
			EventDate:            occurred,
			CommercialEventID:    &id,
			EvidenceChain:        evidence,
			Sources:              sources,
		})
	}
	return out, rows.Err()
}

func recipeSulfurBulk(ctx context.Context, pool *pgxpool.Pool) ([]mcrDraft, error) {
	rows, err := pool.Query(ctx, `
		SELECT pc.id, pc.mmsi, pc.vessel_name, pc.terminal_id, pc.duration_hours, pc.arrival_ts,
			t.name, t.operator_name, t.country, t.products,
			ST_Y(t.geom::geometry) AS lat, ST_X(t.geom::geometry) AS lon
		FROM oil_port_calls pc
		JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.status = 'closed'
		  AND 'sulfur' = ANY(t.products)
		  AND pc.arrival_ts > now() - interval '180 days'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []mcrDraft
	for rows.Next() {
		var pcID, tid uuid.UUID
		var mmsi int64
		var vessel, tname, operator, country string
		var products []string
		var duration, lat, lon float64
		var arrival time.Time
		if err := rows.Scan(&pcID, &mmsi, &vessel, &tid, &duration, &arrival, &tname, &operator, &country, &products, &lat, &lon); err != nil {
			return out, err
		}
		hasExport := countryHasHSExport(ctx, pool, country, "2802")
		score := 2
		evidence := []any{
			fmt.Sprintf("Bulk visit at sulfur terminal %s (%.1fh)", tname, duration),
			"Terminal tagged sulfur",
		}
		sources := []any{
			map[string]string{"name": "oil_terminals", "field": "products"},
			map[string]string{"name": "oil_port_calls", "field": "duration"},
		}
		if hasExport {
			score++
			evidence = append(evidence, fmt.Sprintf("Comtrade HS 2802 export from %s", country))
			sources = append(sources, map[string]string{"name": "oil_trade_flows", "hs_code": "2802"})
		}
		shipper := operator
		if shipper == "" {
			shipper = tname
		}
		shipperID, _ := resolveCompany(ctx, pool, shipper, country)
		tonnes := duration * 500.0 // heuristic bulk throughput
		if tonnes < 1000 {
			tonnes = 1000
		}
		fp := fingerprint(RecipeSulfurBulk, pcID.String())
		out = append(out, mcrDraft{
			Fingerprint:          fp,
			Recipe:               RecipeSulfurBulk,
			CommodityFamily:      "sulfur",
			Confidence:           0.65,
			TriangulationScore:   score,
			ShipperName:          strPtr(shipper),
			ShipperCompanyID:     shipperID,
			VesselName:           strPtr(vessel),
			MMSI:                 &mmsi,
			LoadTerminalID:       &tid,
			LoadPortName:         strPtr(tname),
			LoadCountry:          strPtr(country),
			CommodityDescription: strPtr("Elemental sulfur bulk export (inferred)"),
			VolumeBestEstimate:   &tonnes,
			VolumeMethod:         strPtr("stay_duration_heuristic"),
			VolumeUnit:           "mt",
			EventDate:            &arrival,
			PortCallID:           &pcID,
			CorridorMMSI:         &mmsi,
			CorridorLoadLat:      &lat,
			CorridorLoadLng:      &lon,
			EvidenceChain:        evidence,
			Sources:              sources,
		})
	}
	return out, rows.Err()
}

func recipeGovOfftake(ctx context.Context, pool *pgxpool.Pool) ([]mcrDraft, error) {
	if !tableExists(ctx, pool, "oil_commercial_events") {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT id, title, summary, country, company_id, occurred_at, raw
		FROM oil_commercial_events
		WHERE event_type = 'gov_contract'
		  AND (summary ILIKE '%fuel%' OR summary ILIKE '%petroleum%' OR title ILIKE '%fuel%')
		  AND occurred_at > now() - interval '730 days'
		ORDER BY occurred_at DESC NULLS LAST
		LIMIT 100
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
		var raw []byte
		if err := rows.Scan(&id, &title, &summary, &country, &companyID, &occurred, &raw); err != nil {
			return out, err
		}
		hasMacro := countryHasHSExport(ctx, pool, "United States", "2710") || countryHasHSExport(ctx, pool, country, "2710")
		score := 2
		evidence := []any{"USAspending/gov contract petroleum keyword match", title}
		sources := []any{map[string]string{"name": "oil_commercial_events", "event_type": "gov_contract"}}
		if hasMacro {
			score++
			evidence = append(evidence, "Macro refined export context (HS 2710)")
			sources = append(sources, map[string]string{"name": "oil_trade_flows", "hs_code": "2710"})
		}
		var rawMap map[string]any
		_ = json.Unmarshal(raw, &rawMap)
		awardee, _ := rawMap["awardee"].(string)
		if awardee == "" {
			awardee = title
		}
		fp := fingerprint(RecipeGovOfftake, id.String())
		out = append(out, mcrDraft{
			Fingerprint:          fp,
			Recipe:               RecipeGovOfftake,
			CommodityFamily:      "refined_products",
			Confidence:           0.55,
			TriangulationScore:   score,
			ShipperName:          strPtr(awardee),
			ShipperCompanyID:     companyID,
			ConsigneeName:        strPtr("US Government offtake"),
			LoadCountry:          strPtr("United States"),
			DischargeCountry:     strPtr(country),
			CommodityDescription: strPtr("Government fuel offtake (inferred)"),
			VolumeMethod:         strPtr("contract_macro"),
			VolumeUnit:           "bbl",
			EventDate:            occurred,
			CommercialEventID:    &id,
			EvidenceChain:        evidence,
			Sources:              sources,
		})
	}
	return out, rows.Err()
}

func recipeRepeatDealer(ctx context.Context, pool *pgxpool.Pool) ([]mcrDraft, error) {
	rows, err := pool.Query(ctx, `
		SELECT pc.terminal_id, t.name, t.operator_name, t.country, pc.mmsi,
			COUNT(*)::int, AVG(pc.draft_delta) AS avg_delta,
			MAX(pc.arrival_ts) AS last_visit,
			ST_Y(t.geom::geometry) AS lat, ST_X(t.geom::geometry) AS lon
		FROM oil_port_calls pc
		JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.status = 'closed' AND pc.arrival_ts > now() - interval '90 days'
		GROUP BY pc.terminal_id, t.name, t.operator_name, t.country, pc.mmsi, t.geom
		HAVING COUNT(*) >= 3
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []mcrDraft
	for rows.Next() {
		var tid uuid.UUID
		var tname, operator, country string
		var mmsi int64
		var visits int
		var avgDelta, lat, lon float64
		var lastVisit time.Time
		if err := rows.Scan(&tid, &tname, &operator, &country, &mmsi, &visits, &avgDelta, &lastVisit, &lat, &lon); err != nil {
			return out, err
		}
		shipper := operator
		if shipper == "" {
			shipper = tname
		}
		shipperID, _ := resolveCompany(ctx, pool, shipper, country)
		hasContact := companyHasContact(ctx, pool, shipperID)
		score := 2
		evidence := []any{
			fmt.Sprintf("Repeat visits: %d in 90 days at %s", visits, tname),
			fmt.Sprintf("Average draft delta: %.1fm", avgDelta),
		}
		sources := []any{map[string]string{"name": "oil_port_calls", "pattern": "repeat"}}
		if hasContact {
			score++
			evidence = append(evidence, "Operator contact on file")
			sources = append(sources, map[string]string{"name": "oil_companies", "field": "contacts"})
		}
		var oppID *uuid.UUID
		_ = pool.QueryRow(ctx, `
			SELECT id FROM oil_opportunities
			WHERE opportunity_type = 'possible_term_contract_lead'
			  AND mmsi = $1 AND terminal_id = $2 AND status = 'open'
			LIMIT 1
		`, mmsi, tid).Scan(&oppID)

		fp := fingerprint(RecipeRepeatDealer, fmt.Sprintf("%d", mmsi), tid.String())
		conf := 0.72
		if hasContact {
			conf = 0.78
		}
		out = append(out, mcrDraft{
			Fingerprint:          fp,
			Recipe:               RecipeRepeatDealer,
			CommodityFamily:      "crude_oil",
			Confidence:           conf,
			TriangulationScore:   score,
			ShipperName:          strPtr(shipper),
			ShipperCompanyID:     shipperID,
			MMSI:                 &mmsi,
			LoadTerminalID:       &tid,
			LoadPortName:         strPtr(tname),
			LoadCountry:          strPtr(country),
			CommodityDescription: strPtr("Possible term lift series (inferred)"),
			VolumeMethod:         strPtr("repeat_visit_average"),
			VolumeUnit:           "bbl",
			EventDate:            &lastVisit,
			OpportunityID:        oppID,
			CorridorMMSI:         &mmsi,
			CorridorLoadLat:      &lat,
			CorridorLoadLng:      &lon,
			EvidenceChain:        evidence,
			Sources:              sources,
			Metadata:             map[string]any{"visit_count": visits, "avg_draft_delta": avgDelta},
		})
	}
	return out, rows.Err()
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
	tag, err := pool.Exec(ctx, `
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
			shipper_name = EXCLUDED.shipper_name,
			consignee_name = EXCLUDED.consignee_name,
			shipper_company_id = EXCLUDED.shipper_company_id,
			consignee_company_id = EXCLUDED.consignee_company_id,
			discharge_hint = COALESCE(EXCLUDED.discharge_hint, meridian_cargo_records.discharge_hint),
			discharge_country = COALESCE(EXCLUDED.discharge_country, meridian_cargo_records.discharge_country),
			volume_low = EXCLUDED.volume_low,
			volume_high = EXCLUDED.volume_high,
			volume_best_estimate = EXCLUDED.volume_best_estimate,
			volume_method = EXCLUDED.volume_method,
			corridor_mmsi = COALESCE(EXCLUDED.corridor_mmsi, meridian_cargo_records.corridor_mmsi),
			corridor_load_lat = COALESCE(EXCLUDED.corridor_load_lat, meridian_cargo_records.corridor_load_lat),
			corridor_load_lng = COALESCE(EXCLUDED.corridor_load_lng, meridian_cargo_records.corridor_load_lng),
			corridor_discharge_lat = COALESCE(EXCLUDED.corridor_discharge_lat, meridian_cargo_records.corridor_discharge_lat),
			corridor_discharge_lng = COALESCE(EXCLUDED.corridor_discharge_lng, meridian_cargo_records.corridor_discharge_lng),
			evidence_chain = EXCLUDED.evidence_chain,
			sources = EXCLUDED.sources,
			metadata = EXCLUDED.metadata,
			updated_at = now()
	`, synID, d.Fingerprint, d.Recipe, d.CommodityFamily, d.Confidence, d.TriangulationScore,
		d.ShipperName, d.ConsigneeName, d.ShipperCompanyID, d.ConsigneeCompanyID,
		d.VesselName, d.MMSI, d.IMO, d.LoadTerminalID, d.LoadPortName, d.LoadCountry,
		d.DischargeHint, d.DischargeCountry, d.CommodityDescription,
		d.VolumeLow, d.VolumeHigh, d.VolumeBestEstimate, d.VolumeMethod, unit,
		d.EventDate, d.PortCallID, d.CommercialEventID, d.OpportunityID,
		d.CorridorMMSI, d.CorridorLoadLat, d.CorridorLoadLng, d.CorridorDischargeLat, d.CorridorDischargeLng,
		evidence, sources, d.ContactIDs, meta,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func inferCommodityFamily(products []string, crudeCapable, productTanker *bool) string {
	for _, p := range products {
		pl := strings.ToLower(p)
		switch {
		case strings.Contains(pl, "crude"):
			return "crude_oil"
		case strings.Contains(pl, "sulfur"):
			return "sulfur"
		case strings.Contains(pl, "lng"):
			return "lng"
		case strings.Contains(pl, "lpg"):
			return "lpg"
		case strings.Contains(pl, "diesel"), strings.Contains(pl, "gasoil"):
			return "diesel"
		case strings.Contains(pl, "gasoline"), strings.Contains(pl, "petrol"):
			return "gasoline"
		case strings.Contains(pl, "jet"), strings.Contains(pl, "kerosene"):
			return "jet_fuel"
		case strings.Contains(pl, "naphtha"):
			return "naphtha"
		case strings.Contains(pl, "bitumen"), strings.Contains(pl, "asphalt"):
			return "asphalt"
		case strings.Contains(pl, "fuel_oil"), strings.Contains(pl, "bunker"):
			return "fuel_oil"
		case strings.Contains(pl, "petrochemical"), strings.Contains(pl, "chemical"):
			return "petrochemical"
		case strings.Contains(pl, "refined"):
			return "refined_products"
		}
	}
	if crudeCapable != nil && *crudeCapable {
		return "crude_oil"
	}
	if productTanker != nil && *productTanker {
		return "refined_products"
	}
	return ""
}

func hsForFamily(family string) string {
	switch family {
	case "crude_oil":
		return "2709"
	case "sulfur":
		return "2802"
	case "lng", "lpg":
		return "2711"
	default:
		return "2710"
	}
}

func corridorTradeMatch(ctx context.Context, pool *pgxpool.Pool, exportCountry, importCountry, hs string) (bool, *float64) {
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
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM oil_trade_flows
		WHERE flow_type = 'M' AND hs_code = $2 AND (reporter ILIKE $1 OR partner ILIKE $1)
	`, "%"+country+"%", hs).Scan(&n)
	return n > 0
}

func countryHasHSExport(ctx context.Context, pool *pgxpool.Pool, country, hs string) bool {
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM oil_trade_flows
		WHERE flow_type = 'X' AND hs_code = $2 AND reporter ILIKE $1
	`, "%"+country+"%", hs).Scan(&n)
	return n > 0
}

func resolveCompany(ctx context.Context, pool *pgxpool.Pool, name, country string) (*uuid.UUID, error) {
	if name == "" {
		return nil, nil
	}
	norm := strings.ToLower(strings.TrimSpace(name))
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		SELECT id FROM oil_companies
		WHERE (normalized_name = $1 OR name ILIKE $2)
		  AND ($3 = '' OR country ILIKE $3 OR country IS NULL)
		LIMIT 1
	`, norm, name, country).Scan(&id)
	if err != nil {
		return nil, nil
	}
	return &id, nil
}

func companyHasContact(ctx context.Context, pool *pgxpool.Pool, companyID *uuid.UUID) bool {
	if companyID == nil {
		return false
	}
	var supplierID *string
	if err := pool.QueryRow(ctx, `SELECT supplier_id::text FROM oil_companies WHERE id=$1`, *companyID).Scan(&supplierID); err != nil || supplierID == nil {
		return false
	}
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM entity_contacts
		WHERE entity_kind = 'license' AND entity_id = $1
	`, *supplierID).Scan(&n)
	return n > 0
}

func tableExists(ctx context.Context, pool *pgxpool.Pool, table string) bool {
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = $1
	`, table).Scan(&n)
	return n > 0
}

func fingerprint(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(h[:16])
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func clampConf(v float64) float64 {
	if v > 0.95 {
		return 0.95
	}
	if v < 0.35 {
		return 0.35
	}
	return v
}
