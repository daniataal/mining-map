package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mining-map/oil-live-intel/internal/models"
	"github.com/mining-map/oil-live-intel/internal/services/contacts"
)

// CreateLicense handles POST /licenses
func (s *Server) CreateLicense(w http.ResponseWriter, r *http.Request) {
	var item models.LicenseCreate
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	newID := uuid.New().String()
	status := "Operating"
	if item.Status != nil {
		status = *item.Status
	}

	sql := `
		INSERT INTO licenses 
		(id, company, country, region, commodity, license_type, status, lat, lng, phone_number, contact_person, date_issued)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`
	_, err := s.Pool.Exec(r.Context(), sql,
		newID, item.Company, item.Country, item.Region, item.Commodity,
		item.LicenseType, status, item.Lat, item.Lng,
		item.PhoneNumber, item.ContactPerson, nil,
	)
	if err != nil {
		s.Log.Error().Err(err).Msg("create license")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Sync open-data contact rows when license has attributable source metadata.
	if _, syncErr := contacts.SyncLicenseContacts(r.Context(), s.Pool, newID); syncErr != nil {
		s.Log.Warn().Err(syncErr).Str("license_id", newID).Msg("license contact sync failed")
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":      newID,
		"company": item.Company,
		"country": item.Country,
		"region":  item.Region,
	})
}

// UpdateLicense handles PUT /licenses/{id}
func (s *Server) UpdateLicense(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/oil-live/licenses/")
	if id == "" || id == r.URL.Path {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing id"})
		return
	}

	var item models.LicenseUpdate
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	var existingStatus string
	var existingExported bool
	var existingCompany string
	var existingCommodity string
	var existingCapacity float64
	var existingPrice float64

	checkSQL := "SELECT status, is_exported, company, COALESCE(commodity, ''), COALESCE(capacity, 0), COALESCE(price_per_kg, 0) FROM licenses WHERE id = $1"
	err := s.Pool.QueryRow(r.Context(), checkSQL, id).Scan(&existingStatus, &existingExported, &existingCompany, &existingCommodity, &existingCapacity, &existingPrice)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "License not found"})
		return
	}

	updates := []string{}
	args := []any{}
	argId := 1

	addUpdate := func(col string, val any) {
		updates = append(updates, fmt.Sprintf("%s = $%d", col, argId))
		args = append(args, val)
		argId++
	}

	if item.Company != nil {
		addUpdate("company", *item.Company)
	}
	if item.Country != nil {
		addUpdate("country", *item.Country)
	}
	if item.Region != nil {
		addUpdate("region", *item.Region)
	}
	if item.Commodity != nil {
		addUpdate("commodity", *item.Commodity)
	}
	if item.LicenseType != nil {
		addUpdate("license_type", *item.LicenseType)
	}
	if item.Status != nil {
		addUpdate("status", *item.Status)
	}
	if item.Lat != nil {
		addUpdate("lat", *item.Lat)
	}
	if item.Lng != nil {
		addUpdate("lng", *item.Lng)
	}
	if item.PhoneNumber != nil {
		addUpdate("phone_number", *item.PhoneNumber)
	}
	if item.ContactPerson != nil {
		addUpdate("contact_person", *item.ContactPerson)
	}
	if item.PricePerKg != nil {
		addUpdate("price_per_kg", *item.PricePerKg)
	}
	if item.Capacity != nil {
		addUpdate("capacity", *item.Capacity)
	}

	if len(updates) == 0 {
		writeJSON(w, http.StatusOK, map[string]string{"status": "no changes"})
		return
	}

	args = append(args, id)
	updateSQL := fmt.Sprintf("UPDATE licenses SET %s WHERE id = $%d", strings.Join(updates, ", "), argId)

	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback(r.Context())

	_, err = tx.Exec(r.Context(), updateSQL, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Python contact sync was here. We defer it.
	finalStatus := existingStatus
	if item.Status != nil {
		finalStatus = *item.Status
	}

	exported := false
	if finalStatus == "APPROVED" && !existingExported {
		// Marketplace Export Trigger Logic
		cName := existingCompany
		if item.Company != nil {
			cName = *item.Company
		}
		cComm := existingCommodity
		if item.Commodity != nil {
			cComm = *item.Commodity
		}
		cCap := existingCapacity
		if item.Capacity != nil {
			cCap = *item.Capacity
		}
		cPrice := existingPrice
		if item.PricePerKg != nil {
			cPrice = *item.PricePerKg
		}

		if exportLicenseToMarketplace(id, cName, cComm, cCap, cPrice) {
			_, err = tx.Exec(r.Context(), "UPDATE licenses SET is_exported = TRUE WHERE id = $1", id)
			if err == nil {
				exported = true
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if _, syncErr := contacts.SyncLicenseContacts(r.Context(), s.Pool, id); syncErr != nil {
		s.Log.Warn().Err(syncErr).Str("license_id", id).Msg("license contact sync failed")
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "updated",
		"exported": exported,
	})
}

func exportLicenseToMarketplace(id, company, commodity string, capacity, price float64) bool {
	apiKey := os.Getenv("MARKETPLACE_API_KEY")
	if apiKey == "" || apiKey == "demo-key" {
		return false
	}
	url := os.Getenv("MARKETPLACE_API_URL")
	if url == "" {
		return false
	}

	payload := map[string]any{
		"externalId": id,
		"company":    company,
		"commodity":  commodity,
		"quantity":   capacity,
		"pricePerKg": price,
		"discount":   5.0,
		"status":     "OPEN",
	}
	body, _ := json.Marshal(payload)

	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// DeleteLicense handles DELETE /licenses/{id}
func (s *Server) DeleteLicense(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/oil-live/licenses/")
	if id == "" || id == r.URL.Path {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing id"})
		return
	}

	sql := "DELETE FROM licenses WHERE id = $1"
	tag, err := s.Pool.Exec(r.Context(), sql, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// BatchDeleteLicenses handles POST /licenses/batch-delete
func (s *Server) BatchDeleteLicenses(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	if len(req.IDs) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"status": "success", "deleted_count": 0})
		return
	}

	sql := "DELETE FROM licenses WHERE id = ANY($1)"
	tag, err := s.Pool.Exec(r.Context(), sql, req.IDs)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "deleted_count": tag.RowsAffected()})
}
