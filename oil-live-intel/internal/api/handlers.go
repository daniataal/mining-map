package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/services/sanctions"
	"github.com/mining-map/oil-live-intel/internal/services/search"
	"github.com/mining-map/oil-live-intel/internal/services/shipvault"
	"github.com/mining-map/oil-live-intel/internal/services/supplier"
	"github.com/mining-map/oil-live-intel/internal/services/vesselmerge"
)

type Server struct {
	Pool   *pgxpool.Pool
	Log    zerolog.Logger
	Config config.Config
	Hub    *Hub
	// sanctionsCache lazily aggregates OpenSanctions screening rows from oil_companies.
	sanctionsCache *sanctions.Store
	// SearchClient is optional — when nil, /api/oil-live/search returns
	// {"error":"search_unavailable"} so the UI degrades gracefully.
	SearchClient search.Client
	// ShipVaultSvc is optional — when nil, vessel dossier omits
	// the shipvault_profile block without error.
	ShipVaultSvc *shipvault.Service
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// HealthLive is a fast liveness probe for Docker/Caddy (no heavy sync-status queries).
func (s *Server) HealthLive(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "oil-live-intel",
		"probe":   "live",
	})
}

func (s *Server) Health(w http.ResponseWriter, r *http.Request) {
	if s.Pool != nil {
		sync := querySyncStatus(r.Context(), s.Pool)
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"service": "oil-live-intel",
			"sync":    sync,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "oil-live-intel",
	})
}

func (s *Server) Map(w http.ResponseWriter, r *http.Request) {
	minLon, minLat, maxLon, maxLat, bboxOK := parseBBox(r.URL.Query().Get("bbox"))
	bbox := [4]float64{minLon, minLat, maxLon, maxLat}
	zoom := queryFloat(r, "zoom", 0)
	limit := vesselmerge.ClampLimit(queryInt(r, "limit", 500))
	if zoom > 0 && zoom < 8 {
		limit = min(limit, 250)
	}
	terminals, _ := s.listTerminals(r, bbox, bboxOK, limit)
	vesselResult, _ := s.listLiveVesselsWithMeta(r, bbox, bboxOK, limit)
	events, _ := s.listRecentPortCalls(r, limit/2)
	cards, _ := s.listIntelligence(r, limit/2)
	companies, _ := s.listCompanies(r, companyFilters{MinConfidence: 0.5}, limit/4, 0, companyListOpts{IncludeMap: true})
	writeJSONCached(w, http.StatusOK, map[string]any{
		"terminals": terminals,
		"vessels":   vesselResult.Vessels,
		"vessel_meta": map[string]any{
			"total_available":  vesselResult.TotalAvailable,
			"returned_count":   vesselResult.ReturnedCount,
			"cap_applied":      vesselResult.CapApplied,
			"ship_type_counts": vesselResult.ShipTypeCounts,
			"limit":            vesselResult.Limit,
			"source_mode":      vesselResult.SourceMode,
		},
		"events":    events,
		"cards":     cards,
		"companies": companies,
		"zoom":      zoom,
	}, 45)
}

func (s *Server) ListTerminals(w http.ResponseWriter, r *http.Request) {
	minLon, minLat, maxLon, maxLat, bboxOK := parseBBox(r.URL.Query().Get("bbox"))
	bbox := [4]float64{minLon, minLat, maxLon, maxLat}
	limit := queryInt(r, "limit", 500)
	items, err := s.listTerminals(r, bbox, bboxOK, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"terminals": items, "count": len(items)})
}

func (s *Server) GetTerminal(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	item, err := s.getTerminal(r, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "terminal not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) ImportGeoJSON(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	var fc struct {
		Features []struct {
			Properties map[string]any `json:"properties"`
			Geometry   struct {
				Type        string    `json:"type"`
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
		} `json:"features"`
	}
	if err := json.Unmarshal(body, &fc); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid geojson")
		return
	}
	imported := 0
	for _, f := range fc.Features {
		if len(f.Geometry.Coordinates) < 2 {
			continue
		}
		lon, lat := f.Geometry.Coordinates[0], f.Geometry.Coordinates[1]
		name, _ := f.Properties["name"].(string)
		if name == "" {
			name = "Imported terminal"
		}
		_, err := s.Pool.Exec(r.Context(), `
			INSERT INTO oil_terminals (name, country, products, source, confidence, geom, metadata)
			VALUES ($1, COALESCE($2,''), $3, 'geojson_import', 0.6,
				ST_SetSRID(ST_MakePoint($4,$5),4326), $6)
		`, name, f.Properties["country"], pgTextArray(f.Properties["products"]), lon, lat, f.Properties)
		if err == nil {
			imported++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"imported": imported})
}

func (s *Server) LiveVessels(w http.ResponseWriter, r *http.Request) {
	minLon, minLat, maxLon, maxLat, bboxOK := parseBBox(r.URL.Query().Get("bbox"))
	bbox := [4]float64{minLon, minLat, maxLon, maxLat}
	limit := vesselmerge.ClampLimit(queryInt(r, "limit", 200))
	items, err := s.listLiveVessels(r, bbox, bboxOK, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"vessels": nonNilMapSlice(items)})
}

func (s *Server) GetVessel(w http.ResponseWriter, r *http.Request) {
	mmsi, err := strconv.ParseInt(chi.URLParam(r, "mmsi"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid mmsi")
		return
	}
	rows, err := s.Pool.Query(r.Context(), `
		SELECT mmsi, imo, name, vessel_type, tanker_class, crude_capable, product_tanker,
			deadweight_tons, max_draft_m, metadata, updated_at
		FROM oil_vessels WHERE mmsi=$1
	`, mmsi)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	if !rows.Next() {
		writeErr(w, http.StatusNotFound, "vessel not found")
		return
	}
	var imo, name, vtype, tclass *string
	var crude, product *bool
	var dwt, mdraft *float64
	var meta []byte
	var updated time.Time
	if err := rows.Scan(&mmsi, &imo, &name, &vtype, &tclass, &crude, &product, &dwt, &mdraft, &meta, &updated); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var metaMap map[string]any
	_ = json.Unmarshal(meta, &metaMap)
	writeJSON(w, http.StatusOK, map[string]any{
		"mmsi": mmsi, "imo": imo, "name": name, "vessel_type": vtype, "tanker_class": tclass,
		"crude_capable": crude, "product_tanker": product, "deadweight_tons": dwt,
		"max_draft_m": mdraft, "updated_at": updated, "metadata": metaMap,
	})
}

func (s *Server) RecentPortCalls(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 50)
	items, err := s.listRecentPortCalls(r, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"port_calls": items})
}

func (s *Server) GetPortCall(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	item, err := s.getPortCall(r, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "port call not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) ListIntelligence(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 50)
	items, err := s.listIntelligence(r, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cards": items})
}

func (s *Server) GetIntelligence(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	item, err := s.getIntelligence(r, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "card not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) ListCompanies(w http.ResponseWriter, r *http.Request) {
	f := companyFilters{
		Q:              r.URL.Query().Get("q"),
		Type:           r.URL.Query().Get("type"),
		Country:        r.URL.Query().Get("country"),
		SupplierStatus: r.URL.Query().Get("supplier_status"),
		Role:           firstNonEmpty(r.URL.Query().Get("role"), r.URL.Query().Get("company_type")),
		MinConfidence:  queryFloat(r, "min_confidence", 0),
		MinEvents:      queryOffset(r, "min_events"),
	}
	limit := queryInt(r, "limit", 100)
	offset := queryOffset(r, "offset")
	listOpts := companyListOpts{IncludeMap: r.URL.Query().Get("include_map") != "false"}
	total, err := s.countCompanies(r, f, companyListOpts{})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	items, err := s.listCompanies(r, f, limit, offset, listOpts)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"companies": items,
		"count":     len(items),
		"total":     total,
		"offset":    offset,
		"limit":     limit,
	})
}

func (s *Server) GetCompany(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	item, err := s.getCompany(r, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "company not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// GetCompanyShipments returns paginated MCR rows for a company (ImportYeti-style ledger).
func (s *Server) GetCompanyShipments(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)
	if limit > 200 {
		limit = 200
	}
	company, err := s.getCompany(r, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "company not found")
		return
	}
	name, _ := company["name"].(string)
	companyID, _ := company["id"].(string)

	rows, err := s.Pool.Query(r.Context(), `
		SELECT m.id, m.synthetic_bol_id, m.recipe, m.commodity_family, m.confidence,
			m.bol_tier, m.shipper_name, m.consignee_name, m.vessel_name,
			m.load_port_name, m.load_country, m.discharge_hint, m.discharge_country,
			m.volume_best_estimate, m.volume_unit, m.event_date,
			m.corridor_load_lat, m.corridor_load_lng, m.corridor_discharge_lat, m.corridor_discharge_lng,
			m.evidence_chain, m.sources
		FROM meridian_cargo_records m
		WHERE m.shipper_company_id::text = $1 OR m.consignee_company_id::text = $1
		   OR ($2 <> '' AND (LOWER(m.shipper_name) = LOWER($2) OR LOWER(m.consignee_name) = LOWER($2)))
		ORDER BY m.event_date DESC NULLS LAST, m.confidence DESC
		LIMIT $3 OFFSET $4
	`, companyID, name, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var rid uuid.UUID
		var bolID, recipe, family, tier string
		var shipper, consignee, vessel, loadPort, loadCountry, discharge, discCountry *string
		var volBest *float64
		var volUnit *string
		var conf float64
		var eventDate *time.Time
		var loadLat, loadLng, discLat, discLng *float64
		var evidenceChain, sources []byte
		if err := rows.Scan(&rid, &bolID, &recipe, &family, &conf, &tier,
			&shipper, &consignee, &vessel, &loadPort, &loadCountry, &discharge, &discCountry,
			&volBest, &volUnit, &eventDate,
			&loadLat, &loadLng, &discLat, &discLng, &evidenceChain, &sources); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		var evChain, srcList any
		_ = json.Unmarshal(evidenceChain, &evChain)
		_ = json.Unmarshal(sources, &srcList)
		items = append(items, map[string]any{
			"id": rid.String(), "synthetic_bol_id": bolID, "recipe": recipe,
			"commodity_family": family, "confidence": conf, "bol_tier": tier,
			"shipper_name": shipper, "consignee_name": consignee, "vessel_name": vessel,
			"load_port_name": loadPort, "load_country": loadCountry,
			"discharge_hint": discharge, "discharge_country": discCountry,
			"volume_best_estimate": volBest, "volume_unit": volUnit,
			"event_date":        formatTimePtr(eventDate),
			"corridor_load_lat": loadLat, "corridor_load_lng": loadLng,
			"corridor_discharge_lat": discLat, "corridor_discharge_lng": discLng,
			"evidence_chain": evChain, "sources": srcList,
			"disclaimer": "Synthetic cargo record — inferred from public sources, not a legal BOL.",
		})
	}
	var total int
	_ = s.Pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM meridian_cargo_records m
		WHERE m.shipper_company_id::text = $1 OR m.consignee_company_id::text = $1
		   OR ($2 <> '' AND (LOWER(m.shipper_name) = LOWER($2) OR LOWER(m.consignee_name) = LOWER($2)))
	`, companyID, name).Scan(&total)
	writeJSON(w, http.StatusOK, map[string]any{
		"company": company, "shipments": items, "total": total, "limit": limit, "offset": offset,
	})
}

func (s *Server) SupplierCandidates(w http.ResponseWriter, r *http.Request) {
	f := companyFilters{SupplierStatus: "candidate", MinConfidence: 0.55}
	items, err := s.listCompanies(r, f, 100, 0, companyListOpts{IncludeMap: false})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"candidates": items})
}

func (s *Server) SaveToSuppliers(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid company id")
		return
	}
	c, err := s.getCompanyRow(r, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "company not found")
		return
	}
	terminals, _ := s.terminalNamesForCompany(r, c.Name, c.Country)
	result, err := supplier.SaveToSuppliers(
		r.Context(), s.Pool, s.Config.ExistingBackendURL, s.Config.SupplierCreateEndpoint,
		c, r.Header.Get("Authorization"), terminals,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if result.Status == "failed" {
		result.Payload = supplier.BuildPayloadForFrontend(c, terminals)
		writeJSON(w, http.StatusAccepted, result)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) InternalBroadcast(w http.ResponseWriter, r *http.Request) {
	if s.Config.InternalBroadcastKey == "" || r.Header.Get("X-Oil-Intel-Internal") != s.Config.InternalBroadcastKey {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var body struct {
		Type string         `json:"type"`
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Type == "" {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	s.Hub.Broadcast(body.Type, body.Data)
	writeJSON(w, http.StatusOK, map[string]string{"status": "broadcast"})
}

func (s *Server) WebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.Hub.Register(conn)
	defer s.Hub.Unregister(conn)
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	writeJSONCached(w, code, v, 0)
}

func writeJSONCached(w http.ResponseWriter, code int, v any, maxAgeSec int) {
	w.Header().Set("Content-Type", "application/json")
	if maxAgeSec > 0 {
		w.Header().Set("Cache-Control", "public, max-age="+strconv.Itoa(maxAgeSec))
	}
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func queryInt(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func queryFloat(r *http.Request, key string, def float64) float64 {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			return n
		}
	}
	return def
}

func queryBool(r *http.Request, key string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(r.URL.Query().Get(key)))
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return def
	}
}

func queryOffset(r *http.Request, key string) int {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func parseBBox(raw string) (minLon, minLat, maxLon, maxLat float64, ok bool) {
	if raw == "" {
		return 0, 0, 0, 0, false
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return 0, 0, 0, 0, false
	}
	vals := make([]float64, 4)
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return 0, 0, 0, 0, false
		}
		vals[i] = v
	}
	return vals[0], vals[1], vals[2], vals[3], true
}

func pgTextArray(v any) []string {
	switch t := v.(type) {
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	case []string:
		return t
	default:
		return nil
	}
}
