package api

import (
	"encoding/json"
	"net/http"
)

type GraphNode struct {
	ID       string `json:"id"`
	Type     string `json:"type"` // "asset", "organization", "contact"
	Label    string `json:"label"`
	Metadata any    `json:"metadata,omitempty"`
}

type GraphEdge struct {
	SourceID string `json:"source_id"`
	TargetID string `json:"target_id"`
	Label    string `json:"label"` // e.g. "owner", "operator"
}

type GraphPayload struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

func (s *Server) ExploreGraph(w http.ResponseWriter, r *http.Request) {
	nodeID := r.URL.Query().Get("node_id")
	nodeType := r.URL.Query().Get("node_type")

	if nodeID == "" || nodeType == "" {
		http.Error(w, "missing node_id or node_type", http.StatusBadRequest)
		return
	}

	nodesMap := make(map[string]GraphNode)
	edgesList := make([]GraphEdge, 0)

	// Single degree traversal for now
	if nodeType == "asset" {
		// Add the root asset
		var name, assetType string
		err := s.Pool.QueryRow(r.Context(), "SELECT name, asset_type FROM core_assets WHERE id = $1", nodeID).Scan(&name, &assetType)
		if err == nil {
			nodesMap[nodeID] = GraphNode{ID: nodeID, Type: "asset", Label: name, Metadata: map[string]string{"asset_type": assetType}}
		}

		// Find organizations related to this asset
		rows, err := s.Pool.Query(r.Context(), `
			SELECT o.id, o.name, r.relationship_role 
			FROM core_asset_relationships r
			JOIN core_organizations o ON r.organization_id = o.id
			WHERE r.asset_id = $1
		`, nodeID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var orgID, orgName, role string
				if err := rows.Scan(&orgID, &orgName, &role); err == nil {
					nodesMap[orgID] = GraphNode{ID: orgID, Type: "organization", Label: orgName}
					edgesList = append(edgesList, GraphEdge{
						SourceID: nodeID,
						TargetID: orgID,
						Label:    role,
					})
				}
			}
		}

	} else if nodeType == "organization" {
		// Add the root organization
		var name string
		err := s.Pool.QueryRow(r.Context(), "SELECT name FROM core_organizations WHERE id = $1", nodeID).Scan(&name)
		if err == nil {
			nodesMap[nodeID] = GraphNode{ID: nodeID, Type: "organization", Label: name}
		}

		// Find assets related to this organization
		rows, err := s.Pool.Query(r.Context(), `
			SELECT a.id, a.name, r.relationship_role 
			FROM core_asset_relationships r
			JOIN core_assets a ON r.asset_id = a.id
			WHERE r.organization_id = $1
		`, nodeID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var assetID, assetName, role string
				if err := rows.Scan(&assetID, &assetName, &role); err == nil {
					nodesMap[assetID] = GraphNode{ID: assetID, Type: "asset", Label: assetName}
					edgesList = append(edgesList, GraphEdge{
						SourceID: nodeID, // Or TargetID depending on direction preference
						TargetID: assetID,
						Label:    role,
					})
				}
			}
		}
	} else {
		http.Error(w, "unsupported node_type", http.StatusBadRequest)
		return
	}

	payload := GraphPayload{
		Nodes: make([]GraphNode, 0, len(nodesMap)),
		Edges: edgesList,
	}
	for _, n := range nodesMap {
		payload.Nodes = append(payload.Nodes, n)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payload)
}
