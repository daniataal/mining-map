package api

import (
	"net/http"
	"strings"
)

// LookupVesselByIMO resolves MMSI + latest position for map selection from fleet tables.
// GET /api/oil-live/vessels/lookup?imo=
func (s *Server) LookupVesselByIMO(w http.ResponseWriter, r *http.Request) {
	imo := strings.TrimSpace(r.URL.Query().Get("imo"))
	if imo == "" {
		writeErr(w, http.StatusBadRequest, "imo query required")
		return
	}
	ctx := r.Context()
	var mmsi int64
	var name *string
	err := s.Pool.QueryRow(ctx, `
		SELECT mmsi, name FROM oil_vessels WHERE imo = $1 LIMIT 1
	`, imo).Scan(&mmsi, &name)
	if err != nil {
		writeErr(w, http.StatusNotFound, "vessel not found for imo")
		return
	}
	var lat, lng *float64
	var posTime *string
	_ = s.Pool.QueryRow(ctx, `
		SELECT ST_Y(geom::geometry), ST_X(geom::geometry), received_at::text
		FROM oil_ais_positions
		WHERE mmsi = $1
		ORDER BY received_at DESC NULLS LAST
		LIMIT 1
	`, mmsi).Scan(&lat, &lng, &posTime)

	out := map[string]any{
		"mmsi": mmsi,
		"imo":  imo,
	}
	if name != nil {
		out["name"] = *name
	}
	if lat != nil && lng != nil {
		out["lat"] = *lat
		out["lng"] = *lng
	}
	if posTime != nil {
		out["position_time"] = *posTime
	}
	writeJSON(w, http.StatusOK, out)
}

// SearchVessels resolves vessel registry records for deal-pack planning.
// GET /api/oil-live/vessels/search?q=NAME_OR_IMO_OR_MMSI
func (s *Server) SearchVessels(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeErr(w, http.StatusBadRequest, "q query required")
		return
	}
	if s.Pool == nil {
		writeErr(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	limit := queryInt(r, "limit", 8)
	if limit > 25 {
		limit = 25
	}
	like := "%" + strings.ToLower(q) + "%"
	rows, err := s.Pool.Query(r.Context(), `
		SELECT v.mmsi, v.imo, v.name, v.callsign, v.vessel_type, v.tanker_class,
			v.crude_capable, v.product_tanker, v.deadweight_tons, v.max_draft_m,
			NULLIF(v.metadata->>'flag', '') AS flag,
			p.lat, p.lon, p.ts::text, p.destination, p.speed, p.draft_m
		FROM oil_vessels v
		LEFT JOIN LATERAL (
			SELECT lat, lon, ts, destination, speed, draft_m
			FROM oil_ais_positions p
			WHERE p.mmsi = v.mmsi
			ORDER BY p.ts DESC NULLS LAST
			LIMIT 1
		) p ON true
		WHERE v.imo = $1
			OR v.mmsi::text = $1
			OR lower(COALESCE(v.name, '')) LIKE $2
			OR lower(COALESCE(v.callsign, '')) LIKE $2
		ORDER BY
			CASE
				WHEN v.imo = $1 THEN 0
				WHEN v.mmsi::text = $1 THEN 1
				WHEN lower(COALESCE(v.name, '')) = lower($1) THEN 2
				ELSE 3
			END,
			v.updated_at DESC NULLS LAST,
			v.name ASC NULLS LAST
		LIMIT $3
	`, q, like, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	var vessels []map[string]any
	for rows.Next() {
		var mmsi int64
		var imo, name, callsign, vesselType, tankerClass, flag *string
		var crudeCapable, productTanker *bool
		var deadweightTons, maxDraftM, lat, lon, speed, draftM *float64
		var lastPositionAt, destination *string
		if err := rows.Scan(
			&mmsi, &imo, &name, &callsign, &vesselType, &tankerClass,
			&crudeCapable, &productTanker, &deadweightTons, &maxDraftM, &flag,
			&lat, &lon, &lastPositionAt, &destination, &speed, &draftM,
		); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		item := map[string]any{"mmsi": mmsi}
		if imo != nil {
			item["imo"] = *imo
		}
		if name != nil {
			item["name"] = *name
		}
		if callsign != nil {
			item["callsign"] = *callsign
		}
		if vesselType != nil {
			item["vessel_type"] = *vesselType
		}
		if tankerClass != nil {
			item["tanker_class"] = *tankerClass
		}
		if crudeCapable != nil {
			item["crude_capable"] = *crudeCapable
		}
		if productTanker != nil {
			item["product_tanker"] = *productTanker
		}
		if deadweightTons != nil {
			item["deadweight_tons"] = *deadweightTons
		}
		if maxDraftM != nil {
			item["max_draft_m"] = *maxDraftM
		}
		if flag != nil {
			item["flag"] = *flag
		}
		if lat != nil && lon != nil {
			item["lat"] = *lat
			item["lng"] = *lon
		}
		if lastPositionAt != nil {
			item["last_position_at"] = *lastPositionAt
		}
		if destination != nil {
			item["destination"] = *destination
		}
		if speed != nil {
			item["speed_knots"] = *speed
		}
		if draftM != nil {
			item["draft_m"] = *draftM
		}
		vessels = append(vessels, item)
	}
	if vessels == nil {
		vessels = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"vessels": vessels,
		"query":   q,
	})
}
