package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/intelligence"
	"github.com/madsan/intelligence/internal/realtime"
)

func (s *Server) getEntity(w http.ResponseWriter, r *http.Request) {
	switch chi.URLParam(r, "entityType") {
	case "asset":
		s.getAsset(w, r)
	case "company":
		s.getCompany(w, r)
	case "vessel":
		s.getVessel(w, r)
	default:
		http.Error(w, "unknown entity type", http.StatusBadRequest)
	}
}

func (s *Server) getVessel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid, err := uuid.Parse(id)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	s.writeVesselDossier(w, r, uid, id)
}

func (s *Server) getVesselByMMSI(w http.ResponseWriter, r *http.Request) {
	mmsi := chi.URLParam(r, "mmsi")
	var id uuid.UUID
	err := s.pool.QueryRow(r.Context(), `SELECT id FROM vessels WHERE mmsi = $1`, mmsi).Scan(&id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	s.writeVesselDossier(w, r, id, id.String())
}

func (s *Server) writeVesselDossier(w http.ResponseWriter, r *http.Request, uid uuid.UUID, id string) {
	var name, mmsi, imo, vtype, flag, dest, status string
	var lat, lng, course, speed, conf *float64
	var lastSeen *time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT name, COALESCE(mmsi,''), COALESCE(imo,''), COALESCE(vessel_type,''),
		       COALESCE(flag_country_code,''), latitude, longitude, course, speed_knots,
		       COALESCE(destination,''), last_seen_at, confidence_score, data_quality_status
		FROM vessels WHERE id = $1
	`, uid).Scan(&name, &mmsi, &imo, &vtype, &flag, &lat, &lng, &course, &speed, &dest, &lastSeen, &conf, &status)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	evidence, _ := loadEvidence(r.Context(), s.pool, "vessel", uid)
	var enrich vesselEnrichmentRow
	var ownerProfileJSON []byte
	var enrichBuilder string
	var enrichBuildYear *int
	var enrichRawPayload []byte
	var ownerCompanyID, operatorCompanyID string
	if mmsi != "" {
		_ = s.pool.QueryRow(r.Context(), `
			SELECT COALESCE(owner_name,''), COALESCE(operator_name,''),
			       COALESCE(source,''), COALESCE(tier,''), COALESCE(confidence_score,0),
			       stale_after, fetched_at, deadweight_tons, gross_tonnage,
			       COALESCE(vessel_class,''), COALESCE(flag,''), COALESCE(limitations,'{}'),
			       COALESCE(owner_profile,'{}'::jsonb),
			       COALESCE(owner_company_id::text,''), COALESCE(operator_company_id::text,''),
			       COALESCE(builder,''), build_year,
			       COALESCE(raw_payload,'{}'::jsonb)
			FROM vessel_enrichment WHERE mmsi = $1
		`, mmsi).Scan(
			&enrich.OwnerName, &enrich.OperatorName, &enrich.Source, &enrich.Tier, &enrich.Confidence,
			&enrich.StaleAfter, &enrich.FetchedAt, &enrich.DWT, &enrich.GrossTonnage,
			&enrich.VesselClass, &enrich.Flag, &enrich.Limitations, &ownerProfileJSON,
			&ownerCompanyID, &operatorCompanyID,
			&enrichBuilder, &enrichBuildYear, &enrichRawPayload,
		)
	}
	score := 0.0
	if conf != nil {
		score = *conf
	}
	summary := map[string]any{
		"vessel_type": vtype, "mmsi": mmsi, "imo": imo, "flag": flag, "destination": dest,
	}
	mergeVesselEnrichmentSummary(summary, enrich)
	mergeVesselTechnicalSummary(summary, enrichBuilder, enrichBuildYear, enrichRawPayload)
	if len(ownerProfileJSON) > 0 {
		var ownerProfile map[string]any
		if json.Unmarshal(ownerProfileJSON, &ownerProfile) == nil && len(ownerProfile) > 0 {
			summary["owner_profile"] = ownerProfile
		}
	}
	mergeVesselShipvaultSummary(summary, mmsi, ownerProfileJSON, r.Context(), s.pool)
	ownerProfile, _ := summary["owner_profile"].(map[string]any)
	if contacts := loadVesselCommercialContacts(r.Context(), s.pool, ownerCompanyID, operatorCompanyID, enrich.OwnerName, enrich.OperatorName, ownerProfile); len(contacts) > 0 {
		summary["commercial_contacts"] = contacts
	}
	if lastSeen != nil {
		summary["last_seen_at"] = lastSeen.UTC().Format(time.RFC3339)
		age := time.Since(*lastSeen)
		summary["ais_age_hours"] = age.Hours()
		summary["ais_fresh"] = age < 72*time.Hour
		summary["position_live"] = realtime.PositionIsLive(*lastSeen)
		if !realtime.PositionIsLive(*lastSeen) {
			summary["position_caveat"] = "Last known AIS fix — vessel may have moved since this timestamp. Destination is reported intent, not verified location."
		}
	}
	loc := map[string]any{}
	if lat != nil && lng != nil {
		loc["latitude"] = *lat
		loc["longitude"] = *lng
	}
	if course != nil {
		summary["course"] = *course
	}
	if speed != nil {
		summary["speed_knots"] = *speed
	}
	resp := CoreEntityResponse{
		ID: id, EntityType: "vessel", Name: name,
		Summary: summary, Location: loc,
		Confidence: ConfidenceBlock{Score: score, Status: status, LastVerifiedAt: lastSeen},
		Evidence:   evidence,
		Limitations: append([]string{
			"AIS positions reflect provider coverage — Persian Gulf may be sparse",
			"Intelligence only — not voyage or cargo confirmation",
		}, enrichmentLimitations(enrich)...),
	}
	signals, opp := intelligence.VesselSignals(lastSeen, speed, score)
	resp.Signals = toAPISignals(signals)
	resp.OpportunityScore = &opp
	history := loadSignalHistory(r.Context(), s.pool, "vessel", uid, 15)
	if mmsi != "" {
		history = mergeSignalHistory(history, loadVesselSTSSignalHistory(r.Context(), s.legacyPool, mmsi, 10), 15)
	}
	resp.SignalHistory = history
	resp.Relationships = loadRelationships(r.Context(), s.pool, "vessel", uid)
	s.attachEntityEnvelope(r.Context(), &resp, uid, nil, lastSeen)
	writeJSON(w, resp)
}
