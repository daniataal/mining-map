package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Deal playground: user-built deal graphs on the map. Nodes are suppliers,
// buyers, facilities, vessels, transport legs or custom entries; links connect
// them; every node carries its own due-diligence state.

type dealNodeBody struct {
	Kind          string         `json:"kind"`
	Name          string         `json:"name"`
	RefEntityType string         `json:"ref_entity_type"`
	RefEntityID   string         `json:"ref_entity_id"`
	Lat           *float64       `json:"lat"`
	Lon           *float64       `json:"lon"`
	DDStatus      string         `json:"dd_status"`
	DDNotes       string         `json:"dd_notes"`
	Metadata      map[string]any `json:"metadata"`
}

type dealLinkBody struct {
	FromNode string `json:"from_node"`
	ToNode   string `json:"to_node"`
	Role     string `json:"role"`
	Notes    string `json:"notes"`
}

var dealNodeKinds = map[string]bool{
	"supplier": true, "buyer": true, "facility": true,
	"vessel": true, "transport": true, "custom": true,
}

var dealDDStatuses = map[string]bool{
	"pending": true, "in_review": true, "verified": true, "rejected": true,
}

func (s *Server) listPlaygroundDeals(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT d.id, COALESCE(d.title,''), COALESCE(d.commodity,''), COALESCE(d.status,'draft'),
			d.created_at, d.updated_at,
			COUNT(DISTINCT n.id)::int AS nodes,
			COUNT(DISTINCT l.id)::int AS links,
			COUNT(DISTINCT n.id) FILTER (WHERE n.dd_status = 'verified')::int AS dd_verified,
			COUNT(DISTINCT n.id) FILTER (WHERE n.dd_status = 'rejected')::int AS dd_rejected
		FROM deals d
		LEFT JOIN deal_nodes n ON n.deal_id = d.id
		LEFT JOIN deal_links l ON l.deal_id = d.id
		GROUP BY d.id
		ORDER BY d.updated_at DESC NULLS LAST
		LIMIT 200
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id uuid.UUID
		var title, commodity, status string
		var createdAt, updatedAt *time.Time
		var nodes, links, ddVerified, ddRejected int
		if rows.Scan(&id, &title, &commodity, &status, &createdAt, &updatedAt, &nodes, &links, &ddVerified, &ddRejected) != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": id.String(), "title": title, "commodity": commodity, "status": status,
			"created_at": createdAt, "updated_at": updatedAt,
			"nodes": nodes, "links": links,
			"dd_verified": ddVerified, "dd_rejected": ddRejected,
		})
	}
	writeJSON(w, map[string]any{"deals": out, "count": len(out)})
}

func (s *Server) createPlaygroundDeal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title     string `json:"title"`
		Commodity string `json:"commodity"`
		Notes     string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Title) == "" {
		http.Error(w, "title required", http.StatusBadRequest)
		return
	}
	var tenantID any
	if claims, ok := authClaims(r); ok && claims.TenantID != "" {
		if tid, err := uuid.Parse(claims.TenantID); err == nil {
			tenantID = tid
		}
	}
	meta, _ := json.Marshal(map[string]any{"notes": body.Notes, "origin": "playground"})
	var id uuid.UUID
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO deals (tenant_id, title, commodity, status, metadata)
		VALUES ($1, $2, NULLIF($3,''), 'draft', $4::jsonb)
		RETURNING id
	`, tenantID, strings.TrimSpace(body.Title), strings.TrimSpace(body.Commodity), meta).Scan(&id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"id": id.String(), "status": "draft"})
}

func (s *Server) updatePlaygroundDeal(w http.ResponseWriter, r *http.Request) {
	dealID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid deal id", http.StatusBadRequest)
		return
	}
	var body struct {
		Title     *string `json:"title"`
		Commodity *string `json:"commodity"`
		Status    *string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE deals SET
			title = COALESCE($2, title),
			commodity = COALESCE($3, commodity),
			status = COALESCE($4, status),
			updated_at = now()
		WHERE id = $1
	`, dealID, body.Title, body.Commodity, body.Status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "updated"})
}

func (s *Server) deletePlaygroundDeal(w http.ResponseWriter, r *http.Request) {
	dealID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid deal id", http.StatusBadRequest)
		return
	}
	if _, err := s.pool.Exec(r.Context(), `DELETE FROM deals WHERE id = $1`, dealID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "deleted"})
}

func (s *Server) getDealGraph(w http.ResponseWriter, r *http.Request) {
	dealID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid deal id", http.StatusBadRequest)
		return
	}
	var title, commodity, status string
	var meta []byte
	err = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(title,''), COALESCE(commodity,''), COALESCE(status,'draft'), COALESCE(metadata,'{}')
		FROM deals WHERE id = $1
	`, dealID).Scan(&title, &commodity, &status, &meta)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	nodes := []map[string]any{}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, kind, COALESCE(ref_entity_type,''), ref_entity_id, name, lat, lon,
			dd_status, COALESCE(dd_notes,''), metadata, created_at
		FROM deal_nodes WHERE deal_id = $1 ORDER BY created_at
	`, dealID)
	if err == nil {
		for rows.Next() {
			var id uuid.UUID
			var kind, refType, name, ddStatus, ddNotes string
			var refID *uuid.UUID
			var lat, lon *float64
			var nodeMeta []byte
			var createdAt time.Time
			if rows.Scan(&id, &kind, &refType, &refID, &name, &lat, &lon, &ddStatus, &ddNotes, &nodeMeta, &createdAt) != nil {
				continue
			}
			var metaMap map[string]any
			_ = json.Unmarshal(nodeMeta, &metaMap)
			n := map[string]any{
				"id": id.String(), "kind": kind, "name": name,
				"ref_entity_type": refType, "lat": lat, "lon": lon,
				"dd_status": ddStatus, "dd_notes": ddNotes,
				"metadata": metaMap, "created_at": createdAt,
			}
			if refID != nil {
				n["ref_entity_id"] = refID.String()
			}
			nodes = append(nodes, n)
		}
		rows.Close()
	}

	links := []map[string]any{}
	linkRows, err := s.pool.Query(r.Context(), `
		SELECT id, from_node, to_node, role, COALESCE(notes,'')
		FROM deal_links WHERE deal_id = $1 ORDER BY created_at
	`, dealID)
	if err == nil {
		for linkRows.Next() {
			var id, from, to uuid.UUID
			var role, notes string
			if linkRows.Scan(&id, &from, &to, &role, &notes) != nil {
				continue
			}
			links = append(links, map[string]any{
				"id": id.String(), "from_node": from.String(), "to_node": to.String(),
				"role": role, "notes": notes,
			})
		}
		linkRows.Close()
	}

	var metaMap map[string]any
	_ = json.Unmarshal(meta, &metaMap)
	writeJSON(w, map[string]any{
		"id": dealID.String(), "title": title, "commodity": commodity, "status": status,
		"metadata": metaMap, "nodes": nodes, "links": links,
	})
}

func (s *Server) addDealNode(w http.ResponseWriter, r *http.Request) {
	dealID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid deal id", http.StatusBadRequest)
		return
	}
	var body dealNodeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	kind := strings.ToLower(strings.TrimSpace(body.Kind))
	if !dealNodeKinds[kind] {
		kind = "custom"
	}
	ddStatus := strings.ToLower(strings.TrimSpace(body.DDStatus))
	if !dealDDStatuses[ddStatus] {
		ddStatus = "pending"
	}
	var refID any
	if body.RefEntityID != "" {
		if rid, err := uuid.Parse(body.RefEntityID); err == nil {
			refID = rid
		}
	}
	if body.Metadata == nil {
		body.Metadata = map[string]any{}
	}
	meta, _ := json.Marshal(body.Metadata)
	var nodeID uuid.UUID
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO deal_nodes (deal_id, kind, ref_entity_type, ref_entity_id, name, lat, lon, dd_status, dd_notes, metadata)
		VALUES ($1, $2, NULLIF($3,''), $4, $5, $6, $7, $8, NULLIF($9,''), $10::jsonb)
		RETURNING id
	`, dealID, kind, strings.TrimSpace(body.RefEntityType), refID, strings.TrimSpace(body.Name),
		body.Lat, body.Lon, ddStatus, strings.TrimSpace(body.DDNotes), meta).Scan(&nodeID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_, _ = s.pool.Exec(r.Context(), `UPDATE deals SET updated_at = now() WHERE id = $1`, dealID)
	writeJSON(w, map[string]string{"id": nodeID.String(), "status": "created"})
}

func (s *Server) updateDealNode(w http.ResponseWriter, r *http.Request) {
	dealID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid deal id", http.StatusBadRequest)
		return
	}
	nodeID, err := uuid.Parse(chi.URLParam(r, "nodeID"))
	if err != nil {
		http.Error(w, "invalid node id", http.StatusBadRequest)
		return
	}
	var body struct {
		Name     *string  `json:"name"`
		Kind     *string  `json:"kind"`
		Lat      *float64 `json:"lat"`
		Lon      *float64 `json:"lon"`
		DDStatus *string  `json:"dd_status"`
		DDNotes  *string  `json:"dd_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if body.Kind != nil && !dealNodeKinds[strings.ToLower(*body.Kind)] {
		body.Kind = nil
	}
	if body.DDStatus != nil && !dealDDStatuses[strings.ToLower(*body.DDStatus)] {
		body.DDStatus = nil
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE deal_nodes SET
			name = COALESCE($3, name),
			kind = COALESCE(LOWER($4), kind),
			lat = COALESCE($5, lat),
			lon = COALESCE($6, lon),
			dd_status = COALESCE(LOWER($7), dd_status),
			dd_notes = COALESCE($8, dd_notes),
			updated_at = now()
		WHERE id = $2 AND deal_id = $1
	`, dealID, nodeID, body.Name, body.Kind, body.Lat, body.Lon, body.DDStatus, body.DDNotes)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_, _ = s.pool.Exec(r.Context(), `UPDATE deals SET updated_at = now() WHERE id = $1`, dealID)
	writeJSON(w, map[string]string{"status": "updated"})
}

func (s *Server) deleteDealNode(w http.ResponseWriter, r *http.Request) {
	dealID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid deal id", http.StatusBadRequest)
		return
	}
	nodeID, err := uuid.Parse(chi.URLParam(r, "nodeID"))
	if err != nil {
		http.Error(w, "invalid node id", http.StatusBadRequest)
		return
	}
	if _, err := s.pool.Exec(r.Context(), `DELETE FROM deal_nodes WHERE id = $2 AND deal_id = $1`, dealID, nodeID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "deleted"})
}

func (s *Server) addDealLink(w http.ResponseWriter, r *http.Request) {
	dealID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid deal id", http.StatusBadRequest)
		return
	}
	var body dealLinkBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	from, err := uuid.Parse(body.FromNode)
	if err != nil {
		http.Error(w, "invalid from_node", http.StatusBadRequest)
		return
	}
	to, err := uuid.Parse(body.ToNode)
	if err != nil {
		http.Error(w, "invalid to_node", http.StatusBadRequest)
		return
	}
	if from == to {
		http.Error(w, "cannot link a node to itself", http.StatusBadRequest)
		return
	}
	role := strings.ToLower(strings.TrimSpace(body.Role))
	if role == "" {
		role = "supply"
	}
	var linkID uuid.UUID
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO deal_links (deal_id, from_node, to_node, role, notes)
		SELECT $1, $2, $3, $4, NULLIF($5,'')
		WHERE EXISTS (SELECT 1 FROM deal_nodes WHERE id = $2 AND deal_id = $1)
		  AND EXISTS (SELECT 1 FROM deal_nodes WHERE id = $3 AND deal_id = $1)
		RETURNING id
	`, dealID, from, to, role, strings.TrimSpace(body.Notes)).Scan(&linkID)
	if err != nil {
		http.Error(w, "nodes must belong to this deal", http.StatusBadRequest)
		return
	}
	_, _ = s.pool.Exec(r.Context(), `UPDATE deals SET updated_at = now() WHERE id = $1`, dealID)
	writeJSON(w, map[string]string{"id": linkID.String(), "status": "created"})
}

func (s *Server) deleteDealLink(w http.ResponseWriter, r *http.Request) {
	dealID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid deal id", http.StatusBadRequest)
		return
	}
	linkID, err := uuid.Parse(chi.URLParam(r, "linkID"))
	if err != nil {
		http.Error(w, "invalid link id", http.StatusBadRequest)
		return
	}
	if _, err := s.pool.Exec(r.Context(), `DELETE FROM deal_links WHERE id = $2 AND deal_id = $1`, dealID, linkID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "deleted"})
}

// dealPlaygroundMap serves all deal nodes and links as GeoJSON for the map.
func (s *Server) dealPlaygroundMap(w http.ResponseWriter, r *http.Request) {
	features := []any{}

	rows, err := s.pool.Query(r.Context(), `
		SELECT n.id, n.deal_id, n.kind, n.name, n.lat, n.lon, n.dd_status,
			COALESCE(d.title,''), COALESCE(d.status,'draft'), COALESCE(d.commodity,'')
		FROM deal_nodes n
		JOIN deals d ON d.id = n.deal_id
		WHERE n.lat IS NOT NULL AND n.lon IS NOT NULL
		LIMIT 5000
	`)
	if err == nil {
		for rows.Next() {
			var id, dealID uuid.UUID
			var kind, name, ddStatus, dealTitle, dealStatus, commodity string
			var lat, lon float64
			if rows.Scan(&id, &dealID, &kind, &name, &lat, &lon, &ddStatus, &dealTitle, &dealStatus, &commodity) != nil {
				continue
			}
			features = append(features, map[string]any{
				"type": "Feature",
				"id":   id.String(),
				"geometry": map[string]any{
					"type":        "Point",
					"coordinates": []float64{lon, lat},
				},
				"properties": map[string]any{
					"feature_kind": "deal_node",
					"node_id":      id.String(),
					"deal_id":      dealID.String(),
					"kind":         kind,
					"name":         name,
					"dd_status":    ddStatus,
					"deal_title":   dealTitle,
					"deal_status":  dealStatus,
					"commodity":    commodity,
				},
			})
		}
		rows.Close()
	}

	linkRows, err := s.pool.Query(r.Context(), `
		SELECT l.id, l.deal_id, l.role, a.lat, a.lon, b.lat, b.lon, a.name, b.name, COALESCE(d.title,'')
		FROM deal_links l
		JOIN deal_nodes a ON a.id = l.from_node
		JOIN deal_nodes b ON b.id = l.to_node
		JOIN deals d ON d.id = l.deal_id
		WHERE a.lat IS NOT NULL AND a.lon IS NOT NULL AND b.lat IS NOT NULL AND b.lon IS NOT NULL
		LIMIT 5000
	`)
	if err == nil {
		for linkRows.Next() {
			var id, dealID uuid.UUID
			var role, nameA, nameB, dealTitle string
			var latA, lonA, latB, lonB float64
			if linkRows.Scan(&id, &dealID, &role, &latA, &lonA, &latB, &lonB, &nameA, &nameB, &dealTitle) != nil {
				continue
			}
			features = append(features, map[string]any{
				"type": "Feature",
				"id":   id.String(),
				"geometry": map[string]any{
					"type":        "LineString",
					"coordinates": [][]float64{{lonA, latA}, {lonB, latB}},
				},
				"properties": map[string]any{
					"feature_kind": "deal_link",
					"link_id":      id.String(),
					"deal_id":      dealID.String(),
					"role":         role,
					"name":         nameA + " → " + nameB,
					"deal_title":   dealTitle,
				},
			})
		}
		linkRows.Close()
	}

	writeJSON(w, map[string]any{"type": "FeatureCollection", "features": features, "count": len(features)})
}
