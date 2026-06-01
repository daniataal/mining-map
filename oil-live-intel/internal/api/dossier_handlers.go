package api

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DossierHandler struct {
	pool *pgxpool.Pool
}

func NewDossierHandler(pool *pgxpool.Pool) *DossierHandler {
	return &DossierHandler{pool: pool}
}

func (h *DossierHandler) proxyToPythonFallback(w http.ResponseWriter, r *http.Request) bool {
	refresh := r.URL.Query().Get("refresh")
	forceRefresh := r.URL.Query().Get("force_refresh")
	live := r.URL.Query().Get("live")

	if refresh == "true" || forceRefresh == "true" || live == "true" || refresh == "1" || live == "1" {
		targetURL := "http://backend:8000" + r.URL.Path
		if r.URL.RawQuery != "" {
			targetURL += "?" + r.URL.RawQuery
		}

		req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
		if err != nil {
			http.Error(w, "Failed to create proxy request", http.StatusInternalServerError)
			return true
		}
		for k, vv := range r.Header {
			for _, v := range vv {
				req.Header.Add(k, v)
			}
		}

		client := &http.Client{Timeout: 90 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "Proxy request failed: "+err.Error(), http.StatusBadGateway)
			return true
		}
		defer resp.Body.Close()

		for k, vv := range resp.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
		return true
	}
	return false
}

func (h *DossierHandler) proxyAllToPython(w http.ResponseWriter, r *http.Request) {
	targetURL := "http://backend:8000" + r.URL.Path
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		http.Error(w, "Failed to create proxy request", http.StatusInternalServerError)
		return
	}
	for k, vv := range r.Header {
		for _, v := range vv {
			req.Header.Add(k, v)
		}
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "Proxy request failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (h *DossierHandler) GetEntityContacts(w http.ResponseWriter, r *http.Request) {
	if h.proxyToPythonFallback(w, r) {
		return
	}

	entityID := chi.URLParam(r, "entity_id")
	entityKind := r.URL.Query().Get("entity_kind")
	if entityKind == "" {
		entityKind = "license"
	}

	query := `
        SELECT
            id,
            entity_kind as "entityKind",
            entity_id as "entityId",
            contact_type as "contactType",
            contact_scope as "contactScope",
            label as "label",
            value as "value",
            source_name as "sourceName",
            source_url as "sourceUrl",
            source_type as "sourceType",
            confidence_score as "confidenceScore",
            raw_payload as "rawPayload",
            extracted_from as "extractedFrom",
            discovered_by as "discoveredBy",
            phone_verified_at as "phoneVerifiedAt",
            verified_at as "verifiedAt",
            last_seen_at as "lastSeenAt"
        FROM entity_contacts
        WHERE entity_id = $1
          AND entity_kind = $2
        ORDER BY
            CASE contact_type
                WHEN 'phone' THEN 1
                WHEN 'email' THEN 2
                WHEN 'website' THEN 3
                WHEN 'address' THEN 4
                ELSE 5
            END,
            confidence_score DESC NULLS LAST,
            value ASC
    `

	rows, err := h.pool.Query(r.Context(), query, entityID, entityKind)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var contacts []map[string]any
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			continue
		}
		
		contact := map[string]any{
			"id":              values[0],
			"entityKind":      values[1],
			"entityId":        values[2],
			"contactType":     values[3],
			"contactScope":    values[4],
			"label":           values[5],
			"value":           values[6],
			"sourceName":      values[7],
			"sourceUrl":       values[8],
			"sourceType":      values[9],
			"confidenceScore": values[10],
			"rawPayload":      values[11],
			"extractedFrom":   values[12],
			"discoveredBy":    values[13],
			"phoneVerifiedAt": values[14],
			"verifiedAt":      values[15],
			"lastSeenAt":      values[16],
		}
		contacts = append(contacts, contact)
	}

	if contacts == nil {
		contacts = []map[string]any{}
	}

	jsonResponse(w, http.StatusOK, contacts)
}

func (h *DossierHandler) GetLatestDDReport(w http.ResponseWriter, r *http.Request) {
	if h.proxyToPythonFallback(w, r) {
		return
	}
	h.proxyAllToPython(w, r)
}

func (h *DossierHandler) GetLegalEvents(w http.ResponseWriter, r *http.Request) {
	if h.proxyToPythonFallback(w, r) {
		return
	}
	
	entityID := chi.URLParam(r, "entity_id")
	entityKind := r.URL.Query().Get("entity_kind")
	if entityKind == "" {
		entityKind = "license"
	}

	query := `
        SELECT
            id,
            fingerprint,
            entity_kind as "entityKind",
            entity_id as "entityId",
            case_title as "caseTitle",
            parties,
            role,
            court,
            jurisdiction,
            filed_date as "filedDate",
            status,
            summary,
            source_name as "sourceName",
            source_url as "sourceUrl",
            source_type as "sourceType",
            discovered_by as "discoveredBy",
            confidence_score as "confidenceScore",
            last_seen_at as "lastSeenAt",
            created_at as "createdAt"
        FROM legal_events
        WHERE entity_id = $1
          AND entity_kind = $2
        ORDER BY filed_date DESC NULLS LAST, id DESC
    `

	rows, err := h.pool.Query(r.Context(), query, entityID, entityKind)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var events []map[string]any
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			continue
		}

		event := map[string]any{
			"id":              values[0],
			"fingerprint":     values[1],
			"entityKind":      values[2],
			"entityId":        values[3],
			"caseTitle":       values[4],
			"parties":         values[5],
			"role":            values[6],
			"court":           values[7],
			"jurisdiction":    values[8],
			"filedDate":       values[9],
			"status":          values[10],
			"summary":         values[11],
			"sourceName":      values[12],
			"sourceUrl":       values[13],
			"sourceType":      values[14],
			"discoveredBy":    values[15],
			"confidenceScore": values[16],
			"lastSeenAt":      values[17],
			"createdAt":       values[18],
		}
		
		// Map time/date objects properly
		if d, ok := event["filedDate"].(time.Time); ok {
			event["filedDate"] = d.Format("2006-01-02")
		}
		if t, ok := event["lastSeenAt"].(time.Time); ok {
			event["lastSeenAt"] = t.Format(time.RFC3339)
		}
		if t, ok := event["createdAt"].(time.Time); ok {
			event["createdAt"] = t.Format(time.RFC3339)
		}

		events = append(events, event)
	}

	if events == nil {
		events = []map[string]any{}
	}

	jsonResponse(w, http.StatusOK, events)
}

func (h *DossierHandler) GetGovProcurement(w http.ResponseWriter, r *http.Request) {
	if h.proxyToPythonFallback(w, r) {
		return
	}
	h.proxyAllToPython(w, r)
}

func (h *DossierHandler) GetEntityRelationships(w http.ResponseWriter, r *http.Request) {
	if h.proxyToPythonFallback(w, r) {
		return
	}

	entityID := chi.URLParam(r, "entity_id")
	entityKind := r.URL.Query().Get("entity_kind")
	if entityKind == "" {
		entityKind = "license"
	}

	query := `
        SELECT
            id,
            source_entity_kind,
            source_entity_ref,
            target_entity_kind,
            target_entity_ref,
            target_name,
            COALESCE(relationship_type, rel_type) as relationship_type,
            relationship_label,
            ownership_pct,
            effective_date,
            source_name,
            source_url,
            source_type,
            confidence_score,
            raw_payload,
            extracted_from,
            verified_at,
            last_seen_at
        FROM entity_relationships
        WHERE source_entity_ref = $1
          AND source_entity_kind = $2
        ORDER BY confidence_score DESC NULLS LAST, target_name ASC
    `

	rows, err := h.pool.Query(r.Context(), query, entityID, entityKind)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var rels []map[string]any
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			continue
		}

		rel := map[string]any{
			"id":                values[0],
			"sourceEntityKind":  values[1],
			"sourceEntityRef":   values[2],
			"targetEntityKind":  values[3],
			"targetEntityRef":   values[4],
			"targetName":        values[5],
			"relationshipType":  values[6],
			"relationshipLabel": values[7],
			"ownershipPct":      values[8],
			"effectiveDate":     values[9],
			"sourceName":        values[10],
			"sourceUrl":         values[11],
			"sourceType":        values[12],
			"confidenceScore":   values[13],
			"rawPayload":        values[14],
			"extractedFrom":     values[15],
			"verifiedAt":        values[16],
			"lastSeenAt":        values[17],
		}

		rels = append(rels, rel)
	}

	if rels == nil {
		rels = []map[string]any{}
	}

	jsonResponse(w, http.StatusOK, rels)
}

func (h *DossierHandler) GetEntityTradeFlows(w http.ResponseWriter, r *http.Request) {
	if h.proxyToPythonFallback(w, r) {
		return
	}
	h.proxyAllToPython(w, r)
}

func (h *DossierHandler) GetSatelliteSites(w http.ResponseWriter, r *http.Request) {
	if h.proxyToPythonFallback(w, r) {
		return
	}
	h.proxyAllToPython(w, r)
}

func (h *DossierHandler) GetGoldbodLicenses(w http.ResponseWriter, r *http.Request) {
	if h.proxyToPythonFallback(w, r) {
		return
	}
	h.proxyAllToPython(w, r)
}

func (h *DossierHandler) GetEUProcurement(w http.ResponseWriter, r *http.Request) {
	if h.proxyToPythonFallback(w, r) {
		return
	}
	h.proxyAllToPython(w, r)
}

func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		json.NewEncoder(w).Encode(data)
	}
}
