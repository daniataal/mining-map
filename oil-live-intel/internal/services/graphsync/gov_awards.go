package graphsync

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MirrorGovAwardsResult mirrors the Python gov_awards step payload.
type MirrorGovAwardsResult struct {
	Events int `json:"events"`
}

type govAwardRow struct {
	AwardID            string
	CommodityTag       *string
	RecipientName      *string
	Agency             *string
	Amount             *float64
	AwardDate          *time.Time
	DescriptionSnippet *string
}

// MirrorGovAwards mirrors petroleum-related US gov procurement awards into oil_commercial_events.
func MirrorGovAwards(ctx context.Context, pool *pgxpool.Pool) (MirrorGovAwardsResult, error) {
	exists, err := TableExists(ctx, pool, "gov_procurement_awards")
	if err != nil {
		return MirrorGovAwardsResult{}, err
	}
	if !exists {
		return MirrorGovAwardsResult{}, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT award_id, commodity_tag, recipient_name, agency, amount, award_date, description_snippet
		FROM gov_procurement_awards
		WHERE commodity_tag ILIKE '%petroleum%'
		   OR commodity_tag ILIKE '%fuel%'
		   OR description_snippet ILIKE ANY(ARRAY['%fuel%','%petroleum%','%diesel%','%JP8%','%F76%'])
		ORDER BY award_date DESC NULLS LAST
		LIMIT 2000
	`)
	if err != nil {
		return MirrorGovAwardsResult{}, err
	}
	defer rows.Close()

	result := MirrorGovAwardsResult{}
	nowISO := time.Now().UTC().Format(time.RFC3339)

	for rows.Next() {
		var row govAwardRow
		if err := rows.Scan(
			&row.AwardID, &row.CommodityTag, &row.RecipientName, &row.Agency,
			&row.Amount, &row.AwardDate, &row.DescriptionSnippet,
		); err != nil {
			return result, err
		}

		tag := stringPtr(row.CommodityTag)
		recipient := stringPtr(row.RecipientName)
		if recipient == "" {
			recipient = "Award recipient"
		}
		agency := stringPtr(row.Agency)
		desc := stringPtr(row.DescriptionSnippet)
		if len(desc) > 300 {
			desc = desc[:300]
		}

		companyID, err := UpsertCompany(
			ctx, pool, recipient, "United States", "gov_awardee", "usaspending", 0.55, nil,
		)
		if err != nil {
			return result, err
		}

		var companyPtr *string
		if companyID != "" {
			companyPtr = &companyID
		}

		titleRecipient := recipient
		if titleRecipient == "Award recipient" {
			titleRecipient = row.AwardID
		}

		var occurredAt *time.Time
		if row.AwardDate != nil {
			t := row.AwardDate.UTC()
			occurredAt = &t
		}

		raw := map[string]any{"agency": agency}
		if row.Amount != nil {
			raw["amount"] = *row.Amount
		}

		written, err := UpsertCommercialEvent(ctx, pool, CommercialEventInput{
			EventType:       "gov_contract",
			Fingerprint:     fmt.Sprintf("usaspending:%s:%s", row.AwardID, tag),
			Title:           fmt.Sprintf("US award: %s", titleRecipient),
			Summary:         desc,
			Country:         "United States",
			CommodityFamily: "refined",
			CompanyID:       companyPtr,
			Confidence:      0.58,
			Sources: []map[string]any{
				{"name": "usaspending", "fetched_at": nowISO},
			},
			Evidence: []string{
				fmt.Sprintf("Agency: %s", agency),
				fmt.Sprintf("Commodity tag: %s", tag),
			},
			Raw:        raw,
			OccurredAt: occurredAt,
		})
		if err != nil {
			return result, err
		}
		if written {
			result.Events++
		}
	}
	return result, rows.Err()
}
