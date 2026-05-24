package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/mining-map/oil-live-intel/internal/services/vesselmerge"
)

func (s *Server) MapLayers(w http.ResponseWriter, r *http.Request) {
	minLon, minLat, maxLon, maxLat, bboxOK := parseBBox(r.URL.Query().Get("bbox"))
	if !bboxOK {
		writeErr(w, http.StatusBadRequest, "bbox required: minLon,minLat,maxLon,maxLat")
		return
	}
	bbox := [4]float64{minLon, minLat, maxLon, maxLat}
	zoom := queryFloat(r, "zoom", 0)
	limit := vesselmerge.ClampLimit(queryInt(r, "limit", 500))
	if zoom > 0 && zoom < 8 {
		limit = min(limit, 250)
	}
	layers := parseMapLayerSet(r.URL.Query().Get("layers"))
	commodity := r.URL.Query().Get("commodity")
	dealSignal := r.URL.Query().Get("dealSignal")
	minDealScore := queryFloat(r, "min_deal_score", 0)
	excludeSeed := queryBool(r, "exclude_seed", s.Config.DisableDemoSeed)

	points := make([]map[string]any, 0, limit)
	arcs := make([]map[string]any, 0, 160)
	counts := map[string]int{}

	if layers["terminals"] {
		terminals, err := s.listTerminals(r, bbox, true, limit)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, terminal := range terminals {
			points = append(points, terminalMapLayerPoint(terminal))
		}
		counts["terminals"] = len(terminals)
	}

	if layers["vessels"] {
		vesselResult, err := s.listLiveVesselsWithMeta(r, bbox, true, limit)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, vessel := range vesselResult.Vessels {
			points = append(points, vesselMapLayerPoint(vessel))
		}
		counts["vessels"] = len(vesselResult.Vessels)
	}

	if layers["opportunities"] {
		oppPoints, err := s.listMapLayerOpportunities(r, bbox, 0.55, minDealScore, min(limit, 120), excludeSeed, dealSignal)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		points = append(points, oppPoints...)
		counts["opportunities"] = len(oppPoints)
	}

	if layers["corridors"] {
		cargoPoints, cargoArcs, err := s.listMapLayerCargo(r, bbox, commodity, 0.6, min(limit, 200), excludeSeed)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		points = append(points, cargoPoints...)
		arcs = append(arcs, cargoArcs...)
		counts["cargo_points"] = len(cargoPoints)
		counts["cargo_arcs"] = len(cargoArcs)
	}

	if layers["trade_flows"] {
		tradeArcs, err := s.listMapLayerTradeFlows(r, bbox, commodity, 0.55, min(limit, 120), zoom)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		arcs = append(arcs, tradeArcs...)
		counts["trade_flow_arcs"] = len(tradeArcs)
	}

	writeJSONCached(w, http.StatusOK, map[string]any{
		"points":   points,
		"arcs":     arcs,
		"coverage": []any{},
		"meta": map[string]any{
			"bbox":       r.URL.Query().Get("bbox"),
			"zoom":       zoom,
			"limit":      limit,
			"layers":     layerSetKeys(layers),
			"commodity":  commodity,
			"dealSignal": dealSignal,
			"lod":        "bbox_server_cap_canvas_client_lod",
			"counts":     counts,
			"disclaimer": "Map layers blend live, macro, synthetic, inferred, and user-supplied tiers. Synthetic rows are hypotheses, not legal BOLs.",
		},
	}, 45)
}

func parseMapLayerSet(raw string) map[string]bool {
	defaults := []string{"terminals", "vessels", "corridors", "opportunities", "trade_flows"}
	out := map[string]bool{}
	if strings.TrimSpace(raw) == "" {
		for _, key := range defaults {
			out[key] = true
		}
		return out
	}
	for _, part := range strings.Split(raw, ",") {
		key := strings.TrimSpace(strings.ToLower(part))
		if key != "" {
			out[key] = true
		}
	}
	return out
}

func layerSetKeys(layers map[string]bool) []string {
	keys := make([]string, 0, len(layers))
	for key, on := range layers {
		if on {
			keys = append(keys, key)
		}
	}
	return keys
}

func terminalMapLayerPoint(item map[string]any) map[string]any {
	return map[string]any{
		"id":           fmt.Sprint(item["id"]),
		"kind":         "terminal",
		"lat":          item["lat"],
		"lng":          item["lng"],
		"title":        item["name"],
		"subtitle":     joinSubtitle(item["operator_name"], item["country"]),
		"tier":         "inferred",
		"confidence":   item["confidence"],
		"source_count": productsCount(item["products"]),
		"deal_score":   item["confidence"],
		"style_key":    item["terminal_type"],
		"ref_id":       item["id"],
	}
}

func vesselMapLayerPoint(item map[string]any) map[string]any {
	id := fmt.Sprint(item["mmsi"])
	title := item["name"]
	if title == nil || fmt.Sprint(title) == "" {
		title = "MMSI " + id
	}
	return map[string]any{
		"id":         id,
		"kind":       "vessel",
		"lat":        item["lat"],
		"lng":        item["lng"],
		"title":      title,
		"subtitle":   item["tanker_class"],
		"tier":       "live_ais",
		"confidence": item["confidence"],
		"deal_score": 0.75,
		"style_key":  item["tanker_class"],
		"ref_id":     id,
	}
}

func joinSubtitle(parts ...any) string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == nil {
			continue
		}
		s := strings.TrimSpace(fmt.Sprint(part))
		if s != "" && s != "<nil>" {
			out = append(out, s)
		}
	}
	return strings.Join(out, " · ")
}

func productsCount(value any) int {
	switch v := value.(type) {
	case []string:
		return len(v)
	case []any:
		return len(v)
	default:
		return 0
	}
}

func (s *Server) listMapLayerOpportunities(
	r *http.Request,
	bbox [4]float64,
	minConf float64,
	minDealScore float64,
	limit int,
	excludeSeed bool,
	dealSignal string,
) ([]map[string]any, error) {
	q := `
		SELECT o.id, o.opportunity_type, o.title, o.hypothesis, o.confidence,
			COALESCE(jsonb_array_length(o.evidence), 0) AS source_count,
			o.terminal_id::text, t.name, t.country, ST_Y(t.geom::geometry), ST_X(t.geom::geometry),
			COALESCE(o.deal_score, o.confidence)::float8,
			COALESCE(o.source_tiers, ARRAY['synthetic']::text[]) AS source_tiers,
			COALESCE(o.signal_json->>'signal_kind', o.opportunity_type) AS signal_kind
		FROM oil_opportunities o
		JOIN oil_terminals t ON t.id = o.terminal_id
		LEFT JOIN oil_port_calls pc ON pc.id = o.port_call_id
		WHERE o.status = 'open'
		  AND o.confidence >= $1
		  AND COALESCE(o.deal_score, o.confidence) >= $8
		  AND t.geom && ST_MakeEnvelope($2,$3,$4,$5,4326)
		  AND (
		    $9 = ''
		    OR o.opportunity_type = $9
		    OR COALESCE(o.signal_json->>'signal_kind', '') = $9
		  )
		  AND (
		    $7 = false
		    OR (
		      (o.mmsi IS NULL OR o.mmsi <> 636012345)
		      AND o.title NOT ILIKE '%DEMO%'
		      AND COALESCE(o.hypothesis, '') NOT ILIKE '%DEMO%'
		      AND COALESCE(pc.evidence::text, '') NOT ILIKE '%seed_port_calls%'
		      AND COALESCE(pc.metadata::text, '') NOT ILIKE '%seed_port_calls%'
		    )
		  )
		ORDER BY COALESCE(o.deal_score, o.confidence) DESC, o.confidence DESC, o.created_at DESC
		LIMIT $6
	`
	rows, err := s.Pool.Query(r.Context(), q, minConf, bbox[0], bbox[1], bbox[2], bbox[3], limit, excludeSeed, minDealScore, strings.TrimSpace(dealSignal))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]map[string]any, 0, limit)
	for rows.Next() {
		var id uuid.UUID
		var otype, title string
		var hypothesis, terminalID, terminalName, country *string
		var confidence float64
		var sourceCount int
		var lat, lng float64
		var dealScore float64
		var tiers []string
		var signalKind string
		if err := rows.Scan(&id, &otype, &title, &hypothesis, &confidence, &sourceCount, &terminalID, &terminalName, &country, &lat, &lng, &dealScore, &tiers, &signalKind); err != nil {
			return nil, err
		}
		tier := "synthetic"
		if len(tiers) > 0 && strings.TrimSpace(tiers[0]) != "" {
			tier = strings.TrimSpace(tiers[0])
		}
		out = append(out, map[string]any{
			"id":           id.String(),
			"kind":         "opportunity",
			"lat":          lat,
			"lng":          lng,
			"title":        title,
			"subtitle":     hypothesis,
			"tier":         tier,
			"confidence":   confidence,
			"source_count": sourceCount,
			"deal_score":   dealScore,
			"style_key":    "deal_radar",
			"signal_kind":  signalKind,
			"source_tiers": tiers,
			"ref_id":       id.String(),
			"terminal_id":  terminalID,
			"terminal":     terminalName,
			"country":      country,
		})
	}
	return out, rows.Err()
}

func (s *Server) listMapLayerCargo(
	r *http.Request,
	bbox [4]float64,
	commodity string,
	minConf float64,
	limit int,
	excludeSeed bool,
) ([]map[string]any, []map[string]any, error) {
	q := `
		SELECT m.id, m.commodity_family, m.confidence, m.triangulation_score, m.bol_tier,
			m.shipper_name, m.consignee_name, m.vessel_name,
			m.load_port_name, m.discharge_hint,
			m.corridor_load_lat, m.corridor_load_lng, m.corridor_discharge_lat, m.corridor_discharge_lng,
			COALESCE(jsonb_array_length(m.sources), 0) + COALESCE(jsonb_array_length(m.evidence_chain), 0) AS source_count
		FROM meridian_cargo_records m
		LEFT JOIN oil_port_calls pc ON pc.id = m.port_call_id
		WHERE m.confidence >= $1
		  AND m.corridor_load_lat IS NOT NULL
		  AND m.corridor_load_lng IS NOT NULL
		  AND (
		    (m.corridor_load_lat BETWEEN $2 AND $3 AND m.corridor_load_lng BETWEEN $4 AND $5)
		    OR (
		      m.corridor_discharge_lat BETWEEN $2 AND $3
		      AND m.corridor_discharge_lng BETWEEN $4 AND $5
		    )
		  )
		  AND (
		    $7 = false
		    OR (
		      COALESCE(pc.evidence::text, '') NOT ILIKE '%seed_port_calls%'
		      AND COALESCE(pc.metadata::text, '') NOT ILIKE '%seed_port_calls%'
		    )
		  )
	`
	args := []any{minConf, bbox[1], bbox[3], bbox[0], bbox[2], limit, excludeSeed}
	n := 8
	if commodity != "" {
		q += fmt.Sprintf(` AND m.commodity_family = $%d`, n)
		args = append(args, commodity)
		n++
	}
	q += fmt.Sprintf(`
		ORDER BY m.triangulation_score DESC NULLS LAST, m.confidence DESC
		LIMIT $%d`, n)
	args = append(args, limit)

	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	points := []map[string]any{}
	arcs := []map[string]any{}
	for rows.Next() {
		var id uuid.UUID
		var family, tier string
		var shipper, consignee, vessel, loadPort, discharge *string
		var confidence float64
		var tri int
		var loadLat, loadLng float64
		var discLat, discLng *float64
		var sourceCount int
		if err := rows.Scan(&id, &family, &confidence, &tri, &tier, &shipper, &consignee, &vessel, &loadPort, &discharge, &loadLat, &loadLng, &discLat, &discLng, &sourceCount); err != nil {
			return nil, nil, err
		}
		dealScore := float64(tri) / 100.0
		title := family
		if vessel != nil && *vessel != "" {
			title = *vessel
		}
		subtitle := joinSubtitle(loadPort, discharge)
		if discLat == nil || discLng == nil {
			points = append(points, map[string]any{
				"id":           id.String(),
				"kind":         "cargo",
				"lat":          loadLat,
				"lng":          loadLng,
				"title":        title,
				"subtitle":     subtitle,
				"tier":         tier,
				"confidence":   confidence,
				"source_count": sourceCount,
				"deal_score":   dealScore,
				"style_key":    family,
				"ref_id":       id.String(),
			})
			continue
		}
		midLat := (loadLat + *discLat) / 2
		midLng := (loadLng + *discLng) / 2
		arcs = append(arcs, map[string]any{
			"id":           id.String(),
			"kind":         "cargo",
			"positions":    [][]float64{{loadLat, loadLng}, {midLat, midLng}, {*discLat, *discLng}},
			"title":        title,
			"subtitle":     subtitle,
			"tier":         tier,
			"confidence":   confidence,
			"source_count": sourceCount,
			"deal_score":   dealScore,
			"style_key":    family,
			"ref_id":       id.String(),
			"shipper":      shipper,
			"consignee":    consignee,
		})
	}
	return points, arcs, rows.Err()
}

func (s *Server) listMapLayerTradeFlows(
	r *http.Request,
	bbox [4]float64,
	commodity string,
	minConf float64,
	limit int,
	zoom float64,
) ([]map[string]any, error) {
	group := "company_pair"
	view := "mcr_corridor_aggregates_company"
	shipperCol := "shipper_name"
	consigneeCol := "consignee_name"
	if zoom > 0 && zoom < 8 {
		group = "country_pair"
		view = "mcr_corridor_aggregates_country"
		shipperCol = "load_country"
		consigneeCol = "discharge_country"
	}
	q := fmt.Sprintf(`
		SELECT %s, %s, commodity_family, cargo_count, volume_total, volume_unit,
			avg_confidence, origin_lat, origin_lng, dest_lat, dest_lng, sample_mcr_ids
		FROM %s
		WHERE avg_confidence >= $1
		  AND (
		    (origin_lat BETWEEN $2 AND $3 AND origin_lng BETWEEN $4 AND $5)
		    OR (dest_lat BETWEEN $2 AND $3 AND dest_lng BETWEEN $4 AND $5)
		  )
	`, shipperCol, consigneeCol, view)
	args := []any{minConf, bbox[1], bbox[3], bbox[0], bbox[2]}
	n := 6
	if commodity != "" {
		q += fmt.Sprintf(` AND commodity_family = $%d`, n)
		args = append(args, commodity)
		n++
	}
	q += fmt.Sprintf(` ORDER BY cargo_count DESC, avg_confidence DESC NULLS LAST LIMIT $%d`, n)
	args = append(args, limit)

	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	arcs := make([]map[string]any, 0, limit)
	for rows.Next() {
		var shipper, consignee, family string
		var cargoCount int
		var volume, avgConf *float64
		var volumeUnit *string
		var oLat, oLng, dLat, dLng *float64
		var sampleIDs []uuid.UUID
		if err := rows.Scan(&shipper, &consignee, &family, &cargoCount, &volume, &volumeUnit, &avgConf, &oLat, &oLng, &dLat, &dLng, &sampleIDs); err != nil {
			return nil, err
		}
		if oLat == nil || oLng == nil || dLat == nil || dLng == nil {
			continue
		}
		conf := 0.0
		if avgConf != nil {
			conf = *avgConf
		}
		unit := "bbl"
		if volumeUnit != nil && *volumeUnit != "" {
			unit = *volumeUnit
		}
		vol := 0.0
		if volume != nil {
			vol = *volume
		}
		midLat := (*oLat + *dLat) / 2
		midLng := (*oLng + *dLng) / 2
		key := fmt.Sprintf("%s|%s|%s", shipper, consignee, family)
		arcs = append(arcs, map[string]any{
			"id":           key,
			"kind":         "trade_flow",
			"positions":    [][]float64{{*oLat, *oLng}, {midLat, midLng}, {*dLat, *dLng}},
			"title":        shipper + " → " + consignee,
			"subtitle":     fmt.Sprintf("%d cargoes · %.0f %s", cargoCount, vol, unit),
			"tier":         "synthetic",
			"confidence":   conf,
			"source_count": len(sampleIDs),
			"deal_score":   conf,
			"style_key":    family,
			"ref_id":       key,
			"group":        group,
		})
	}
	return arcs, rows.Err()
}
