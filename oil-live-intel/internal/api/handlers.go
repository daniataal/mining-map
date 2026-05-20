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
	"github.com/mining-map/oil-live-intel/internal/services/supplier"
)

type Server struct {
	Pool   *pgxpool.Pool
	Log    zerolog.Logger
	Config config.Config
	Hub    *Hub
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (s *Server) Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "oil-live-intel",
	})
}

func (s *Server) Map(w http.ResponseWriter, r *http.Request) {
	minLon, minLat, maxLon, maxLat, bboxOK := parseBBox(r.URL.Query().Get("bbox"))
	bbox := [4]float64{minLon, minLat, maxLon, maxLat}
	limit := queryInt(r, "limit", 500)
	terminals, _ := s.listTerminals(r, bbox, bboxOK, limit)
	vessels, _ := s.listLiveVessels(r, bbox, bboxOK, limit)
	events, _ := s.listRecentPortCalls(r, limit/2)
	cards, _ := s.listIntelligence(r, limit/2)
	companies, _ := s.listCompanies(r, companyFilters{MinConfidence: 0.5}, limit/4)
	writeJSON(w, http.StatusOK, map[string]any{
		"terminals": terminals,
		"vessels":   vessels,
		"events":    events,
		"cards":     cards,
		"companies": companies,
	})
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
	limit := queryInt(r, "limit", 200)
	items, err := s.listLiveVessels(r, bbox, bboxOK, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"vessels": items})
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
		MinConfidence:  queryFloat(r, "min_confidence", 0),
	}
	limit := queryInt(r, "limit", 100)
	items, err := s.listCompanies(r, f, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"companies": items})
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

func (s *Server) SupplierCandidates(w http.ResponseWriter, r *http.Request) {
	f := companyFilters{SupplierStatus: "candidate", MinConfidence: 0.55}
	items, err := s.listCompanies(r, f, 100)
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
	w.Header().Set("Content-Type", "application/json")
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
