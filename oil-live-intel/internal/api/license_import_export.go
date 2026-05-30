package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ExportLicenses handles GET /licenses/export
func (s *Server) ExportLicenses(w http.ResponseWriter, r *http.Request) {
	withProvenance := false
	if v := r.URL.Query().Get("include_provenance"); v == "1" || strings.EqualFold(v, "true") {
		withProvenance = true
	}

	sql := `
        SELECT
            licenses.id, licenses.company, licenses.country, licenses.region, licenses.commodity,
            licenses.license_type, licenses.status, licenses.lat, licenses.lng, licenses.phone_number,
            licenses.contact_person, licenses.date_issued,
            public_phone.value AS public_business_phone,
            public_phone.source_name AS public_business_phone_source,
            public_phone.source_type AS public_business_phone_source_type,
            licenses.sector, licenses.record_origin, licenses.source_id, licenses.source_name,
            licenses.source_url, licenses.source_record_url, licenses.source_updated_at,
            licenses.last_synced_at, licenses.manually_edited
        FROM licenses
        LEFT JOIN LATERAL (
            SELECT
                value,
                source_name,
                source_type
            FROM entity_contacts
            WHERE entity_id = licenses.id
              AND entity_kind = 'license'
              AND contact_type = 'phone'
              AND contact_scope = 'public_business'
            ORDER BY
                CASE source_type
                    WHEN 'official_open_data' THEN 1
                    WHEN 'source_backed_record' THEN 2
                    WHEN 'llm_extracted_from_source' THEN 3
                    ELSE 4
                END,
                confidence_score DESC NULLS LAST,
                last_seen_at DESC NULLS LAST
            LIMIT 1
        ) AS public_phone ON TRUE
    `
	rows, err := s.Pool.Query(r.Context(), sql)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="licenses.csv"`)

	cw := csv.NewWriter(w)
	headers := []string{
		"id", "company", "country", "region", "commodity", "license_type", "status",
		"lat", "lng", "phone_number", "contact_person", "public_business_phone",
		"public_business_phone_source", "public_business_phone_source_type", "date_issued",
	}
	if withProvenance {
		headers = append(headers,
			"sector", "record_origin", "source_id", "source_name", "source_url",
			"source_record_url", "source_updated_at", "last_synced_at", "manually_edited",
		)
	}
	_ = cw.Write(headers)

	for rows.Next() {
		var id, company, country, region, commodity, lType, status, phone, contact, pbPhone, pbSource, pbSourceType string
		var lat, lng *float64
		var dIssued *time.Time
		var sector, recOrg, sID, sName, sURL, sRecURL string
		var sUpdated, lastSynced *time.Time
		var manualEdited bool

		err := rows.Scan(
			&id, &company, &country, &region, &commodity, &lType, &status, &lat, &lng, &phone, &contact, &dIssued,
			&pbPhone, &pbSource, &pbSourceType,
			&sector, &recOrg, &sID, &sName, &sURL, &sRecURL, &sUpdated, &lastSynced, &manualEdited,
		)
		if err != nil {
			continue
		}

		record := []string{
			id, company, country, region, commodity, lType, status,
			fmtStrFloat(lat), fmtStrFloat(lng), phone, contact, pbPhone, pbSource, pbSourceType, fmtStrTime(dIssued),
		}
		if withProvenance {
			record = append(record,
				sector, recOrg, sID, sName, sURL, sRecURL, fmtStrTime(sUpdated), fmtStrTime(lastSynced), fmt.Sprintf("%v", manualEdited),
			)
		}
		_ = cw.Write(record)
	}
	cw.Flush()
}

func fmtStrFloat(f *float64) string {
	if f == nil {
		return ""
	}
	return fmt.Sprintf("%f", *f)
}

func fmtStrTime(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

// ImportLicensesText handles POST /licenses/import-text
func (s *Server) ImportLicensesText(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CSV string `json:"csv"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	s.processCSVImport(w, r, strings.NewReader(body.CSV))
}

// ImportLicenses handles POST /licenses/import
func (s *Server) ImportLicenses(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "form parse error"})
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing file"})
		return
	}
	defer file.Close()
	s.processCSVImport(w, r, file)
}

func (s *Server) processCSVImport(w http.ResponseWriter, r *http.Request, reader io.Reader) {
	cr := csv.NewReader(reader)
	headers, err := cr.Read()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing header row"})
		return
	}

	for i, h := range headers {
		headers[i] = strings.ToLower(strings.TrimSpace(h))
	}

	idx := func(col string) int {
		for i, h := range headers {
			if h == col {
				return i
			}
		}
		return -1
	}

	cCompany := idx("company")
	cCountry := idx("country")
	cRegion := idx("region")
	cCommodity := idx("commodity")
	cType := idx("licensetype")
	if cType == -1 {
		cType = idx("license_type")
	}
	cStatus := idx("status")
	cLat := idx("lat")
	cLng := idx("lng")

	if cCompany == -1 || cCountry == -1 || cLat == -1 || cLng == -1 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "CSV must contain company, country, lat, lng"})
		return
	}

	imported := 0
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback(r.Context())

	for {
		record, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil || len(record) == 0 {
			continue
		}

		company := strings.TrimSpace(record[cCompany])
		country := strings.TrimSpace(record[cCountry])
		if company == "" || country == "" {
			continue
		}

		lat, errLat := strconv.ParseFloat(record[cLat], 64)
		lng, errLng := strconv.ParseFloat(record[cLng], 64)
		if errLat != nil || errLng != nil {
			continue
		}

		region := ""
		if cRegion != -1 {
			region = strings.TrimSpace(record[cRegion])
		}
		commodity := ""
		if cCommodity != -1 {
			commodity = strings.TrimSpace(record[cCommodity])
		}
		lType := ""
		if cType != -1 {
			lType = strings.TrimSpace(record[cType])
		}
		status := "Operating"
		if cStatus != -1 && strings.TrimSpace(record[cStatus]) != "" {
			status = strings.TrimSpace(record[cStatus])
		}

		id := uuid.New().String()
		sql := `
			INSERT INTO licenses 
			(id, company, country, region, commodity, license_type, status, lat, lng, record_origin)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'user_upload')
		`
		_, err = tx.Exec(r.Context(), sql, id, company, country, region, commodity, lType, status, lat, lng)
		if err == nil {
			imported++
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "imported_count": imported})
}
