package graphsync

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LicensesResult mirrors the Python graph-sync licenses step payload.
type LicensesResult struct {
	LicenseEvents       int `json:"license_events"`
	LicenseCompanies    int `json:"license_companies"`
	SkippedNonPetroleum int `json:"skipped_non_petroleum"`
}

type licenseRow struct {
	ID          string
	Company     string
	Country     string
	Commodity   string
	Status      string
	Phone       *string
	LicenseType *string
	Sector      *string
}

// IndexLicenses upserts petroleum license holders into oil_companies and oil_commercial_events.
func IndexLicenses(ctx context.Context, pool *pgxpool.Pool) (LicensesResult, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text, company, COALESCE(country, ''), COALESCE(commodity, ''),
		       COALESCE(status, ''), phone_number, license_type, sector
		FROM licenses
		WHERE company IS NOT NULL AND TRIM(company) <> ''
		LIMIT 10000
	`)
	if err != nil {
		return LicensesResult{}, err
	}
	defer rows.Close()

	result := LicensesResult{}
	nowISO := time.Now().UTC().Format(time.RFC3339)

	for rows.Next() {
		var row licenseRow
		if err := rows.Scan(
			&row.ID, &row.Company, &row.Country, &row.Commodity, &row.Status,
			&row.Phone, &row.LicenseType, &row.Sector,
		); err != nil {
			return result, err
		}

		licenseType := stringPtr(row.LicenseType)
		sector := stringPtr(row.Sector)
		if !IsPetroleumLicenseRow(row.Commodity, licenseType, sector) {
			result.SkippedNonPetroleum++
			continue
		}

		confidence := 0.5
		if strings.EqualFold(strings.TrimSpace(row.Status), "good") ||
			strings.EqualFold(strings.TrimSpace(row.Status), "approved") {
			confidence = 0.65
		}

		cid, err := UpsertCompany(
			ctx, pool,
			row.Company, row.Country,
			"supplier_license", "licenses",
			confidence,
			map[string]any{"license_id": row.ID, "commodity": row.Commodity},
		)
		if err != nil {
			return result, err
		}
		if cid != "" {
			result.LicenseCompanies++
		}

		var companyID *string
		if cid != "" {
			companyID = &cid
		}

		written, err := UpsertCommercialEvent(ctx, pool, CommercialEventInput{
			EventType:       "supplier_license",
			Fingerprint:     fmt.Sprintf("license:%s", row.ID),
			Title:           fmt.Sprintf("License holder: %s", row.Company),
			Summary:         fmt.Sprintf("Supplier/license record in %s", fallbackCountry(row.Country)),
			Country:         row.Country,
			CommodityFamily: CommodityFromText(row.Commodity),
			CompanyID:       companyID,
			Confidence:      0.6,
			Sources: []map[string]any{
				{"name": "licenses", "ref": row.ID, "fetched_at": nowISO},
			},
			Evidence: []string{fmt.Sprintf("License status: %s", fallbackStatus(row.Status))},
			Raw: map[string]any{
				"license_id": row.ID,
				"phone":      stringPtr(row.Phone),
			},
		})
		if err != nil {
			return result, err
		}
		if written {
			result.LicenseEvents++
		}
	}
	return result, rows.Err()
}

func stringPtr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func fallbackCountry(country string) string {
	if strings.TrimSpace(country) == "" {
		return "unknown"
	}
	return country
}

func fallbackStatus(status string) string {
	if strings.TrimSpace(status) == "" {
		return "unknown"
	}
	return status
}
