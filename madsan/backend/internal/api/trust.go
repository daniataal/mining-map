package api

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
	"github.com/madsan/intelligence/internal/trust"
)

func (s *Server) getTrustScore(w http.ResponseWriter, r *http.Request) {
	entityType := chi.URLParam(r, "entityType")
	id := chi.URLParam(r, "id")
	uid, err := uuid.Parse(id)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}

	switch entityType {
	case "company":
		s.writeCompanyTrust(w, r, uid, id)
	case "asset":
		s.writeAssetTrust(w, r, uid, id)
	case "vessel":
		s.writeVesselTrust(w, r, uid, id)
	default:
		http.Error(w, "unknown entity type", http.StatusBadRequest)
	}
}

func (s *Server) writeCompanyTrust(w http.ResponseWriter, r *http.Request, uid uuid.UUID, id string) {
	var conf float64
	var status string
	var commodities []string
	err := s.pool.QueryRow(r.Context(), `
		SELECT confidence_score, data_quality_status, commodities
		FROM companies WHERE id = $1
	`, uid).Scan(&conf, &status, &commodities)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	evidence, _ := loadEvidence(r.Context(), s.pool, "company", uid)
	signals, _ := intelligence.CompanySignals(conf, evidenceInputs(evidence), commodities)
	rels := loadRelationships(r.Context(), s.pool, "company", uid)
	flags, _ := loadRiskFlags(r.Context(), s.pool, "company", uid)
	writeJSON(w, trust.Compute(trust.Input{
		EntityType: "company", EntityID: id,
		BaseConfidence: conf, DataQualityStatus: status,
		EvidenceCount: len(evidence), Signals: signals,
		RiskFlags: flags, RelationshipCount: len(rels),
	}))
}

func (s *Server) writeAssetTrust(w http.ResponseWriter, r *http.Request, uid uuid.UUID, id string) {
	var conf float64
	var status, assetType string
	var commodities []string
	err := s.pool.QueryRow(r.Context(), `
		SELECT confidence_score, data_quality_status, asset_type, commodities_supported
		FROM assets WHERE id = $1
	`, uid).Scan(&conf, &status, &assetType, &commodities)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	evidence, _ := loadEvidence(r.Context(), s.pool, "asset", uid)
	signals, _ := intelligence.AssetSignals(assetType, conf, len(evidence), commodities)
	rels := loadRelationships(r.Context(), s.pool, "asset", uid)
	flags, _ := loadRiskFlags(r.Context(), s.pool, "asset", uid)
	writeJSON(w, trust.Compute(trust.Input{
		EntityType: "asset", EntityID: id,
		BaseConfidence: conf, DataQualityStatus: status,
		EvidenceCount: len(evidence), Signals: signals,
		RiskFlags: flags, RelationshipCount: len(rels),
	}))
}

func (s *Server) writeVesselTrust(w http.ResponseWriter, r *http.Request, uid uuid.UUID, id string) {
	var conf *float64
	var status string
	var speed *float64
	var lastSeen *time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT confidence_score, data_quality_status, speed_knots, last_seen_at
		FROM vessels WHERE id = $1
	`, uid).Scan(&conf, &status, &speed, &lastSeen)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	score := 0.0
	if conf != nil {
		score = *conf
	}
	evidence, _ := loadEvidence(r.Context(), s.pool, "vessel", uid)
	signals, _ := intelligence.VesselSignals(lastSeen, speed, score)
	rels := loadRelationships(r.Context(), s.pool, "vessel", uid)
	flags, _ := loadRiskFlags(r.Context(), s.pool, "vessel", uid)
	writeJSON(w, trust.Compute(trust.Input{
		EntityType: "vessel", EntityID: id,
		BaseConfidence: score, DataQualityStatus: status,
		EvidenceCount: len(evidence), Signals: signals,
		RiskFlags: flags, RelationshipCount: len(rels),
	}))
}

func loadRiskFlags(ctx context.Context, pool *pgxpool.Pool, entityType string, entityID uuid.UUID) ([]trust.RiskFlag, error) {
	rows, err := pool.Query(ctx, `
		SELECT flag_type, COALESCE(severity,'warning')
		FROM risk_flags
		WHERE entity_type = $1 AND entity_id = $2
		ORDER BY created_at DESC
		LIMIT 10
	`, entityType, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []trust.RiskFlag
	for rows.Next() {
		var rf trust.RiskFlag
		if err := rows.Scan(&rf.FlagType, &rf.Severity); err != nil {
			return nil, err
		}
		out = append(out, rf)
	}
	return out, rows.Err()
}
