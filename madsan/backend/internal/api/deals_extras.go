package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/deals"
	"github.com/madsan/intelligence/internal/documents"
)

func (s *Server) uploadDocument(w http.ResponseWriter, r *http.Request) {
	claims, ok := authClaims(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := r.ParseMultipartForm(documents.MaxUploadBytes + 4096); err != nil {
		http.Error(w, "multipart parse failed", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file field required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	tid, _ := uuid.Parse(claims.TenantID)
	uid, _ := uuid.Parse(claims.UserID)
	in := documents.UploadInput{
		TenantID:   &tid,
		UploadedBy: &uid,
		FileName:   header.Filename,
		MimeType:   header.Header.Get("Content-Type"),
		EntityType: r.FormValue("entity_type"),
	}
	if eid := r.FormValue("entity_id"); eid != "" {
		if parsed, err := uuid.Parse(eid); err == nil {
			in.EntityID = &parsed
		}
	}
	if did := r.FormValue("deal_id"); did != "" {
		if parsed, err := uuid.Parse(did); err == nil {
			in.DealID = &parsed
		}
	}

	size := header.Size
	if size <= 0 {
		size = r.ContentLength
	}
	rec, err := s.documents.Save(r.Context(), in, file, size)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_ = s.ent.RecordUsage(r.Context(), &tid, &uid, featureDealVerification, 1)
	writeJSON(w, rec)
}

func (s *Server) dealDDAssist(w http.ResponseWriter, r *http.Request) {
	claims, ok := authClaims(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := chi.URLParam(r, "id")
	var req deals.DDAssistRequest
	if r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	resp, err := s.deals.DDAssist(r.Context(), id, req, s.llm)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	tid, _ := uuid.Parse(claims.TenantID)
	uid, _ := uuid.Parse(claims.UserID)
	_ = s.ent.RecordUsage(r.Context(), &tid, &uid, featureDealVerification, 1)
	writeJSON(w, resp)
}
