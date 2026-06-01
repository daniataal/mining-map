package supplier

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Company struct {
	ID          uuid.UUID
	Name        string
	CompanyType string
	Country     string
	Website     string
	Confidence  float64
	Metadata    map[string]any
}

type SaveResult struct {
	Status     string         `json:"status"`
	SupplierID string         `json:"supplier_id,omitempty"`
	ExportID   string         `json:"export_id,omitempty"`
	Payload    map[string]any `json:"payload,omitempty"`
	Error      string         `json:"error,omitempty"`
}

// SaveToSuppliers creates a license + deal annotation on the existing Python backend.
func SaveToSuppliers(
	ctx context.Context,
	pool *pgxpool.Pool,
	backendURL, licensePath string,
	company Company,
	authHeader string,
	terminalNames []string,
) (SaveResult, error) {
	notes := fmt.Sprintf(
		"Discovered from oil-live-intel. Company type: %s. Confidence: %.2f. Related terminals: %s. Inferred intelligence only — not a confirmed transaction.",
		company.CompanyType, company.Confidence, strings.Join(terminalNames, ", "),
	)
	licenseBody := map[string]any{
		"company":       company.Name,
		"country":       company.Country,
		"region":        company.Country,
		"commodity":     "Oil & Energy",
		"licenseType":   "Partner",
		"status":        "Prospect",
		"contactPerson": nil,
		"phoneNumber":   nil,
	}
	payload := map[string]any{
		"name":         company.Name,
		"type":         mapCompanyType(company.CompanyType),
		"category":     "Oil & Energy",
		"sub_category": subCategory(company.CompanyType),
		"country":      company.Country,
		"website":      company.Website,
		"source":       "oil-live-intel",
		"status":       "candidate",
		"notes":        notes,
		"metadata": map[string]any{
			"oil_company_id": company.ID.String(),
			"company_type":   company.CompanyType,
			"confidence":     company.Confidence,
			"related_terminals": terminalNames,
		},
		"license_create": licenseBody,
	}

	exportID := uuid.New()
	_, _ = pool.Exec(ctx, `
		INSERT INTO oil_supplier_exports (id, company_id, export_status, payload)
		VALUES ($1,$2,'pending',$3)
	`, exportID, company.ID, payload)

	client := &http.Client{Timeout: 20 * time.Second}
	licenseURL := strings.TrimRight(backendURL, "/") + licensePath
	licPayload, _ := json.Marshal(licenseBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, licenseURL, bytes.NewReader(licPayload))
	if err != nil {
		return failExport(ctx, pool, exportID, company.ID, payload, err)
	}
	req.Header.Set("Content-Type", "application/json")
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	resp, err := client.Do(req)
	if err != nil {
		return failExport(ctx, pool, exportID, company.ID, payload, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return failExport(ctx, pool, exportID, company.ID, payload, fmt.Errorf("license create %d: %s", resp.StatusCode, string(body)))
	}
	var licResp struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(body, &licResp)
	if licResp.ID == "" {
		return failExport(ctx, pool, exportID, company.ID, payload, fmt.Errorf("license create missing id"))
	}

	annURL := strings.TrimRight(backendURL, "/") + "/api/licenses/" + licResp.ID + "/annotations"
	annBody, _ := json.Marshal(map[string]any{
		"annotation": map[string]any{
			"status":  "good",
			"stage":   "New",
			"comment": notes,
		},
	})
	annReq, err := http.NewRequestWithContext(ctx, http.MethodPut, annURL, bytes.NewReader(annBody))
	if err != nil {
		return failExport(ctx, pool, exportID, company.ID, payload, err)
	}
	annReq.Header.Set("Content-Type", "application/json")
	if authHeader != "" {
		annReq.Header.Set("Authorization", authHeader)
	}
	annResp, err := client.Do(annReq)
	if err != nil {
		return failExport(ctx, pool, exportID, company.ID, payload, err)
	}
	defer annResp.Body.Close()
	annBytes, _ := io.ReadAll(annResp.Body)
	if annResp.StatusCode >= 300 {
		return failExport(ctx, pool, exportID, company.ID, payload, fmt.Errorf("annotation %d: %s", annResp.StatusCode, string(annBytes)))
	}

	_, _ = pool.Exec(ctx, `
		UPDATE oil_companies SET supplier_status='saved', supplier_id=$2, updated_at=now() WHERE id=$1
	`, company.ID, licResp.ID)
	_, _ = pool.Exec(ctx, `
		UPDATE oil_supplier_exports SET export_status='saved', supplier_id=$2, response=$3, updated_at=now() WHERE id=$1
	`, exportID, licResp.ID, map[string]any{"license_id": licResp.ID})

	return SaveResult{Status: "saved", SupplierID: licResp.ID, ExportID: exportID.String()}, nil
}

func failExport(ctx context.Context, pool *pgxpool.Pool, exportID, companyID uuid.UUID, payload map[string]any, err error) (SaveResult, error) {
	_, _ = pool.Exec(ctx, `
		UPDATE oil_supplier_exports SET export_status='failed', error=$2, updated_at=now() WHERE id=$1
	`, exportID, err.Error())
	_, _ = pool.Exec(ctx, `UPDATE oil_companies SET supplier_status='failed', updated_at=now() WHERE id=$1`, companyID)
	return SaveResult{
		Status:   "failed",
		ExportID: exportID.String(),
		Payload:  payload,
		Error:    err.Error(),
	}, nil
}

func mapCompanyType(t string) string {
	switch t {
	case "terminal_operator":
		return "oil_terminal_operator"
	case "storage_company":
		return "oil_storage_company"
	case "port_operator":
		return "port_operator"
	default:
		return "oil_energy_company"
	}
}

func subCategory(t string) string {
	switch t {
	case "terminal_operator":
		return "Terminal Operator"
	case "storage_company":
		return "Storage"
	case "port_operator":
		return "Port Operator"
	default:
		return "Oil & Energy"
	}
}

// BuildPayloadForFrontend returns generic supplier payload when backend save fails.
func BuildPayloadForFrontend(c Company, terminals []string) map[string]any {
	return map[string]any{
		"name":         c.Name,
		"type":         mapCompanyType(c.CompanyType),
		"category":     "Oil & Energy",
		"sub_category": subCategory(c.CompanyType),
		"country":      c.Country,
		"website":      c.Website,
		"source":       "oil-live-intel",
		"status":       "candidate",
		"metadata": map[string]any{
			"oil_company_id":      c.ID.String(),
			"company_type":        c.CompanyType,
			"confidence":          c.Confidence,
			"related_terminals":   terminals,
		},
	}
}
