package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type Workspace struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	IsDefault   bool      `json:"is_default"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type WorkspaceNode struct {
	ID          string   `json:"id"`
	WorkspaceID string   `json:"workspace_id"`
	NodeType    string   `json:"node_type"`
	RefID       *string  `json:"ref_id,omitempty"`
	PrivateData any      `json:"private_data,omitempty"`
	CanvasX     *float64 `json:"canvas_x,omitempty"`
	CanvasY     *float64 `json:"canvas_y,omitempty"`
}

type WorkspaceEdge struct {
	ID           string `json:"id"`
	WorkspaceID  string `json:"workspace_id"`
	SourceNodeID string `json:"source_node_id"`
	TargetNodeID string `json:"target_node_id"`
	Label        string `json:"label,omitempty"`
}

func (s *Server) ListWorkspaces(w http.ResponseWriter, r *http.Request) {
	userID := brokerUserID(r)

	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, user_id, name, description, COALESCE(is_default, false), created_at, COALESCE(updated_at, created_at)
		FROM user_workspaces WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC
	`, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var workspaces []Workspace
	for rows.Next() {
		var ws Workspace
		var desc *string
		if err := rows.Scan(&ws.ID, &ws.UserID, &ws.Name, &desc, &ws.IsDefault, &ws.CreatedAt, &ws.UpdatedAt); err == nil {
			if desc != nil {
				ws.Description = *desc
			}
			workspaces = append(workspaces, ws)
		}
	}
	if workspaces == nil {
		workspaces = []Workspace{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"workspaces": workspaces})
}

func (s *Server) CreateWorkspace(w http.ResponseWriter, r *http.Request) {
	userID := brokerUserID(r)

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		IsDefault   bool   `json:"is_default"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}

	var id string
	err := s.Pool.QueryRow(r.Context(), `
		INSERT INTO user_workspaces (user_id, name, description, is_default) 
		VALUES ($1, $2, $3, $4) RETURNING id
	`, userID, req.Name, req.Description, req.IsDefault).Scan(&id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "created"})
}

func (s *Server) ListWorkspaceNodes(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "id")
	rows, err := s.Pool.Query(r.Context(), "SELECT id, workspace_id, node_type, ref_id, private_data, canvas_x, canvas_y FROM workspace_nodes WHERE workspace_id = $1", wsID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var nodes []WorkspaceNode
	for rows.Next() {
		var n WorkspaceNode
		if err := rows.Scan(&n.ID, &n.WorkspaceID, &n.NodeType, &n.RefID, &n.PrivateData, &n.CanvasX, &n.CanvasY); err == nil {
			nodes = append(nodes, n)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
}

func (s *Server) CreateWorkspaceNode(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "id")
	var req WorkspaceNode
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var id string
	err := s.Pool.QueryRow(r.Context(), `
		INSERT INTO workspace_nodes (workspace_id, node_type, ref_id, private_data, canvas_x, canvas_y) 
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
	`, wsID, req.NodeType, req.RefID, req.PrivateData, req.CanvasX, req.CanvasY).Scan(&id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "created"})
}

func (s *Server) ListWorkspaceEdges(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "id")
	rows, err := s.Pool.Query(r.Context(), "SELECT id, workspace_id, source_node_id, target_node_id, label FROM workspace_edges WHERE workspace_id = $1", wsID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var edges []WorkspaceEdge
	for rows.Next() {
		var e WorkspaceEdge
		if err := rows.Scan(&e.ID, &e.WorkspaceID, &e.SourceNodeID, &e.TargetNodeID, &e.Label); err == nil {
			edges = append(edges, e)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"edges": edges})
}

func (s *Server) CreateWorkspaceEdge(w http.ResponseWriter, r *http.Request) {
	wsID := chi.URLParam(r, "id")
	var req WorkspaceEdge
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var id string
	err := s.Pool.QueryRow(r.Context(), `
		INSERT INTO workspace_edges (workspace_id, source_node_id, target_node_id, label) 
		VALUES ($1, $2, $3, $4) RETURNING id
	`, wsID, req.SourceNodeID, req.TargetNodeID, req.Label).Scan(&id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "created"})
}
