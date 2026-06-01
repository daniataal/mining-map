package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mining-map/oil-live-intel/internal/services/search"
)

// SearchHit is the per-result shape returned by /api/oil-live/search. Source
// is the raw `_source` document indexed by the indexer worker (so we don't
// need a typed Go struct per entity — the UI uses just the surfaced fields).
type SearchHit struct {
	Type   string          `json:"type"`
	ID     string          `json:"id"`
	Score  float64         `json:"score"`
	Source json.RawMessage `json:"source"`
}

// SearchResponse is the response envelope of GET /api/oil-live/search.
type SearchResponse struct {
	Hits   []SearchHit `json:"hits"`
	Total  int64       `json:"total"`
	TookMs int         `json:"took_ms"`
	Query  string      `json:"query"`
	// Degraded is "postgres" when Elasticsearch was unavailable and company hits came from PG ILIKE.
	Degraded string `json:"degraded,omitempty"`
	Error    string `json:"error,omitempty"`
}

// SearchHealth is the response of GET /api/oil-live/search/health.
type SearchHealth struct {
	Status  string           `json:"status"`
	Indices map[string]int64 `json:"indices"`
}

// Search handles GET /api/oil-live/search. Multi-index multi_match with
// fuzziness=AUTO. Returns the unified envelope above. When Elasticsearch is
// unavailable (or s.Search is nil because the operator hasn't booted ES yet),
// the response is the empty envelope with HTTP 503 and error="search_unavailable"
// so the UI can degrade gracefully.
func (s *Server) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := queryInt(r, "limit", 20)
	if limit > 100 {
		limit = 100
	}
	offset := queryOffset(r, "offset")
	types := search.ParseTypesParam(r.URL.Query().Get("types"))

	resp := SearchResponse{Query: q, Hits: []SearchHit{}}
	start := time.Now()

	if q == "" {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	if s.SearchClient == nil {
		if pgHits, pgTotal, ok := s.trySearchCompaniesPG(r, q, types, limit); ok {
			resp.Hits = pgHits
			resp.Total = pgTotal
			resp.Degraded = "postgres"
			resp.TookMs = int(time.Since(start) / time.Millisecond)
			writeJSON(w, http.StatusOK, resp)
			return
		}
		resp.Error = "search_unavailable"
		writeJSON(w, http.StatusServiceUnavailable, resp)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// Fan out one query per requested type, in parallel. ES has a multi-index
	// search but we want per-type field weights, so per-index requests are
	// simpler and still bounded.
	var (
		mu      sync.Mutex
		failed  bool
		totalN  int64
		allHits []SearchHit
	)
	wg := sync.WaitGroup{}
	for _, t := range types {
		idx := search.IndexFor(t)
		if idx == "" {
			continue
		}
		entity := t
		index := idx
		wg.Add(1)
		go func() {
			defer wg.Done()
			body := search.BuildQuery(q, entity, limit, offset)
			res, err := s.SearchClient.Search(ctx, index, body)
			if err != nil {
				mu.Lock()
				failed = true
				mu.Unlock()
				if s.Log.GetLevel() <= 0 {
					s.Log.Warn().Err(err).Str("index", index).Msg("search error")
				}
				return
			}
			mu.Lock()
			defer mu.Unlock()
			totalN += res.Hits.Total.Value
			for _, h := range res.Hits.Hits {
				allHits = append(allHits, SearchHit{
					Type:   string(entity),
					ID:     h.ID,
					Score:  h.Score,
					Source: h.Source,
				})
			}
		}()
	}
	wg.Wait()

	if failed && len(allHits) == 0 {
		if pgHits, pgTotal, ok := s.trySearchCompaniesPG(r, q, types, limit); ok {
			resp.Hits = pgHits
			resp.Total = pgTotal
			resp.Degraded = "postgres"
			resp.TookMs = int(time.Since(start) / time.Millisecond)
			writeJSON(w, http.StatusOK, resp)
			return
		}
		resp.Error = "search_unavailable"
		writeJSON(w, http.StatusServiceUnavailable, resp)
		return
	}

	// Sort hits by score desc, then trim to global limit.
	sortHitsByScoreDesc(allHits)
	if len(allHits) > limit {
		allHits = allHits[:limit]
	}
	resp.Hits = allHits
	resp.Total = totalN
	resp.TookMs = int(time.Since(start) / time.Millisecond)
	writeJSON(w, http.StatusOK, resp)
}

// SearchHealthHandler handles GET /api/oil-live/search/health. Returns the
// doc count per index when ES is reachable; otherwise status=unavailable with
// HTTP 503.
func (s *Server) SearchHealthHandler(w http.ResponseWriter, r *http.Request) {
	if s.SearchClient == nil {
		writeJSON(w, http.StatusServiceUnavailable, SearchHealth{
			Status:  "unavailable",
			Indices: map[string]int64{},
		})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := s.SearchClient.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, SearchHealth{
			Status:  "unavailable",
			Indices: map[string]int64{},
		})
		return
	}
	counts := make(map[string]int64, 4)
	for _, idx := range search.AllIndices() {
		n, err := s.SearchClient.Count(ctx, idx)
		if err != nil {
			counts[idx] = 0
			continue
		}
		counts[idx] = n
	}
	writeJSON(w, http.StatusOK, SearchHealth{
		Status:  "ok",
		Indices: counts,
	})
}

func typesIncludeCompany(types []search.EntityType) bool {
	for _, t := range types {
		if t == search.TypeCompany {
			return true
		}
	}
	return false
}

// trySearchCompaniesPG returns company hits from oil_companies when ES is down.
func (s *Server) trySearchCompaniesPG(
	r *http.Request,
	q string,
	types []search.EntityType,
	limit int,
) ([]SearchHit, int64, bool) {
	if s.Pool == nil || !typesIncludeCompany(types) {
		return nil, 0, false
	}
	hits, total, err := s.searchCompaniesPG(r, q, limit)
	if err != nil || len(hits) == 0 {
		return nil, 0, false
	}
	return hits, total, true
}

// searchCompaniesPG ILIKE-matches oil_companies and attaches the latest MCR
// corridor load point (when present) so the map can fly to a related location.
func (s *Server) searchCompaniesPG(r *http.Request, q string, limit int) ([]SearchHit, int64, error) {
	pattern := "%" + q + "%"
	const countQ = `
		SELECT COUNT(*)::int FROM oil_companies c
		WHERE c.confidence >= 0
		  AND (c.name ILIKE $1 OR c.normalized_name ILIKE $1)`
	var total int
	if err := s.Pool.QueryRow(r.Context(), countQ, pattern).Scan(&total); err != nil {
		return nil, 0, err
	}
	const listQ = `
		SELECT c.id::text, c.name, c.country, c.confidence,
		       m.corridor_load_lat, m.corridor_load_lng
		FROM oil_companies c
		LEFT JOIN LATERAL (
			SELECT corridor_load_lat, corridor_load_lng
			FROM meridian_cargo_records
			WHERE (shipper_company_id = c.id OR consignee_company_id = c.id)
			  AND corridor_load_lat IS NOT NULL AND corridor_load_lng IS NOT NULL
			ORDER BY updated_at DESC
			LIMIT 1
		) m ON true
		WHERE c.confidence >= 0
		  AND (c.name ILIKE $1 OR c.normalized_name ILIKE $1)
		ORDER BY c.confidence DESC, c.name
		LIMIT $2`
	rows, err := s.Pool.Query(r.Context(), listQ, pattern, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var hits []SearchHit
	for rows.Next() {
		var id, name, country string
		var confidence float64
		var loadLat, loadLng *float64
		if err := rows.Scan(&id, &name, &country, &confidence, &loadLat, &loadLng); err != nil {
			return nil, 0, err
		}
		src := map[string]any{
			"id":         id,
			"name":       name,
			"country":    country,
			"confidence": confidence,
		}
		if loadLat != nil && loadLng != nil {
			src["corridor_load"] = map[string]any{"lat": *loadLat, "lon": *loadLng}
		}
		raw, err := json.Marshal(src)
		if err != nil {
			return nil, 0, err
		}
		score := confidence * 10
		if score <= 0 {
			score = 1
		}
		hits = append(hits, SearchHit{
			Type:   string(search.TypeCompany),
			ID:     id,
			Score:  score,
			Source: raw,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return hits, int64(total), nil
}

// sortHitsByScoreDesc is a small in-place merge — kept inline so we don't
// pull in sort just for this. n is tiny (<= 4*limit ≤ 400).
func sortHitsByScoreDesc(hits []SearchHit) {
	for i := 1; i < len(hits); i++ {
		for j := i; j > 0 && hits[j].Score > hits[j-1].Score; j-- {
			hits[j], hits[j-1] = hits[j-1], hits[j]
		}
	}
}
