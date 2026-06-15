package api

import (
	"net/http"
)

func (s *Server) listPlans(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT p.slug, p.display_name, array_agg(pf.feature_key) AS features
		FROM plans p
		LEFT JOIN plan_features pf ON pf.plan_id = p.id
		GROUP BY p.id
		ORDER BY p.slug
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var slug, name string
		var features []string
		_ = rows.Scan(&slug, &name, &features)
		out = append(out, map[string]any{"slug": slug, "display_name": name, "features": features})
	}
	writeJSON(w, out)
}
