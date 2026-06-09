package supplier

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// UpsertCompanyContact inserts a public business contact when not already present.
func UpsertCompanyContact(
	ctx context.Context,
	pool *pgxpool.Pool,
	companyID, contactType, value, label, sourceURL string,
) (bool, error) {
	value = trim(value)
	if value == "" {
		return false, nil
	}
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM oil_company_contacts
			WHERE company_id = $1::uuid AND contact_type = $2 AND value = $3
		)
	`, companyID, contactType, value).Scan(&exists)
	if err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO oil_company_contacts (
			company_id, contact_type, contact_scope, label, value, source_type, notes
		)
		VALUES ($1::uuid, $2, 'public_business', $3, $4, 'official_open_data', $5)
	`, companyID, contactType, label, value, sourceURL)
	if err != nil {
		return false, err
	}
	return true, nil
}

func trim(s string) string {
	return strings.TrimSpace(s)
}
