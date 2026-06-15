package deals

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
)

type graphNode struct {
	ID         string  `json:"id"`
	EntityType string  `json:"entity_type"`
	Name       string  `json:"name"`
	Role       string  `json:"role,omitempty"`
	AssetType  string  `json:"asset_type,omitempty"`
	MMSI       string  `json:"mmsi,omitempty"`
	Confidence float64 `json:"confidence_score,omitempty"`
}

type graphEdge struct {
	From       string  `json:"from"`
	To         string  `json:"to"`
	Type       string  `json:"type"`
	Confidence float64 `json:"confidence_score,omitempty"`
	Detail     string  `json:"detail,omitempty"`
}

func (s *Service) buildRelationshipGraph(ctx context.Context, seller, buyer string, verification map[string]any) map[string]any {
	nodes := []graphNode{}
	edges := []graphEdge{}
	seen := map[string]bool{}

	addNode := func(n graphNode) {
		key := n.EntityType + ":" + n.ID
		if seen[key] {
			return
		}
		seen[key] = true
		nodes = append(nodes, n)
	}

	for _, party := range []struct{ role, name string }{{"seller", seller}, {"buyer", buyer}} {
		if party.name == "" {
			continue
		}
		var cid uuid.UUID
		var conf *float64
		err := s.pool.QueryRow(ctx, `
			SELECT id, confidence_score FROM companies
			WHERE name ILIKE $1 OR normalized_name ILIKE lower($1)
			ORDER BY confidence_score DESC NULLS LAST LIMIT 1
		`, "%"+party.name+"%").Scan(&cid, &conf)
		if err != nil {
			continue
		}
		node := graphNode{ID: cid.String(), EntityType: "company", Name: party.name, Role: party.role}
		if conf != nil {
			node.Confidence = *conf
		}
		addNode(node)

		rows, _ := s.pool.Query(ctx, `
			SELECT id, name, asset_type, confidence_score
			FROM assets WHERE operator_company_id = $1
			ORDER BY confidence_score DESC NULLS LAST LIMIT 6
		`, cid)
		if rows != nil {
			for rows.Next() {
				var aid uuid.UUID
				var name, assetType string
				var aconf float64
				if rows.Scan(&aid, &name, &assetType, &aconf) != nil {
					continue
				}
				addNode(graphNode{ID: aid.String(), EntityType: "asset", Name: name, AssetType: assetType, Confidence: aconf})
				edges = append(edges, graphEdge{
					From: cid.String(), To: aid.String(), Type: "operates", Confidence: aconf,
				})
			}
			rows.Close()
		}
	}

	mmsi, _ := verification["claimed_vessel_mmsi"].(string)
	if mmsi == "" {
		if m, ok := verification["claimed_vessel"].(string); ok {
			mmsi = m
		}
	}
	if mmsi != "" {
		var vid uuid.UUID
		var name, dest string
		var conf *float64
		err := s.pool.QueryRow(ctx, `
			SELECT id, COALESCE(name,''), COALESCE(destination,''), confidence_score
			FROM vessels WHERE mmsi = $1
		`, mmsi).Scan(&vid, &name, &dest, &conf)
		if err == nil {
			vnode := graphNode{ID: vid.String(), EntityType: "vessel", Name: name, MMSI: mmsi, Role: "claimed_vessel"}
			if conf != nil {
				vnode.Confidence = *conf
			}
			addNode(vnode)
			rows, _ := s.pool.Query(ctx, `
				SELECT r.relationship_type, a.id, a.name, a.asset_type, r.confidence_score
				FROM relationships r JOIN assets a ON a.id = r.to_entity_id
				WHERE r.from_entity_type = 'vessel' AND r.from_entity_id = $1
				LIMIT 6
			`, vid)
			if rows != nil {
				for rows.Next() {
					var relType, aname, atype string
					var aid uuid.UUID
					var rconf float64
					if rows.Scan(&relType, &aid, &aname, &atype, &rconf) != nil {
						continue
					}
					addNode(graphNode{ID: aid.String(), EntityType: "asset", Name: aname, AssetType: atype, Confidence: rconf})
					detail := ""
					if dest != "" {
						detail = "AIS destination: " + dest
					}
					edges = append(edges, graphEdge{
						From: vid.String(), To: aid.String(), Type: relType, Confidence: rconf, Detail: detail,
					})
				}
				rows.Close()
			}
		}
	}

	assetID, _ := verification["claimed_asset_id"].(string)
	if assetID != "" {
		var name, assetType string
		var conf *float64
		var opID *uuid.UUID
		err := s.pool.QueryRow(ctx, `
			SELECT name, asset_type, confidence_score, operator_company_id
			FROM assets WHERE id = $1
		`, assetID).Scan(&name, &assetType, &conf, &opID)
		if err == nil {
			an := graphNode{ID: assetID, EntityType: "asset", Name: name, AssetType: assetType, Role: "claimed_asset"}
			if conf != nil {
				an.Confidence = *conf
			}
			addNode(an)
			if opID != nil {
				var cname string
				if s.pool.QueryRow(ctx, `SELECT name FROM companies WHERE id = $1`, *opID).Scan(&cname) == nil {
					addNode(graphNode{ID: opID.String(), EntityType: "company", Name: cname, Role: "operator"})
					edges = append(edges, graphEdge{From: opID.String(), To: assetID, Type: "operates"})
				}
			}
		}
	}

	return map[string]any{
		"nodes": nodes,
		"edges": edges,
		"summary": map[string]any{
			"node_count": len(nodes),
			"edge_count": len(edges),
		},
	}
}

func verificationClaims(resultJSON []byte) map[string]any {
	var v map[string]any
	if len(resultJSON) > 0 {
		_ = json.Unmarshal(resultJSON, &v)
	}
	if v == nil {
		v = map[string]any{}
	}
	return v
}
