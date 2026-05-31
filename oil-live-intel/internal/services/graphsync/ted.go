package graphsync

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MirrorTEDNoticesResult mirrors the Python ted step payload.
type MirrorTEDNoticesResult struct {
	Events int `json:"events"`
}

type tedNoticeRow struct {
	NoticeID    string
	Title       *string
	Buyer       *string
	Country     *string
	CPV         *string
	PublishedAt *time.Time
}

// MirrorTEDNotices mirrors petroleum-related EU TED notices into oil_commercial_events.
func MirrorTEDNotices(ctx context.Context, pool *pgxpool.Pool) (MirrorTEDNoticesResult, error) {
	exists, err := TableExists(ctx, pool, "eu_procurement_notices")
	if err != nil {
		return MirrorTEDNoticesResult{}, err
	}
	if !exists {
		return MirrorTEDNoticesResult{}, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT notice_id, title, buyer, country, cpv, published_at
		FROM eu_procurement_notices
		WHERE title ILIKE ANY(ARRAY['%petrol%','%diesel%','%fuel%','%oil%','%gas%','%LPG%','%LNG%'])
		   OR cpv LIKE '09%' OR cpv LIKE '091%'
		ORDER BY published_at DESC NULLS LAST
		LIMIT 2000
	`)
	if err != nil {
		return MirrorTEDNoticesResult{}, err
	}
	defer rows.Close()

	result := MirrorTEDNoticesResult{}
	nowISO := time.Now().UTC().Format(time.RFC3339)
	now := time.Now().UTC()

	for rows.Next() {
		var row tedNoticeRow
		if err := rows.Scan(
			&row.NoticeID, &row.Title, &row.Buyer, &row.Country, &row.CPV, &row.PublishedAt,
		); err != nil {
			return result, err
		}

		buyer := stringPtr(row.Buyer)
		if buyer == "" {
			buyer = "Unknown buyer"
		}
		country := stringPtr(row.Country)
		title := stringPtr(row.Title)
		if title == "" {
			title = "TED notice"
		}
		if len(title) > 200 {
			title = title[:200]
		}

		companyID, err := UpsertCompany(ctx, pool, buyer, country, "possible_buyer", "ted", 0.5, nil)
		if err != nil {
			return result, err
		}

		var companyPtr *string
		if companyID != "" {
			companyPtr = &companyID
		}

		var occurredAt *time.Time
		if row.PublishedAt != nil {
			t := row.PublishedAt.UTC()
			occurredAt = &t
		} else {
			occurredAt = &now
		}

		written, err := UpsertCommercialEvent(ctx, pool, CommercialEventInput{
			EventType:       "procurement_notice",
			Fingerprint:     fmt.Sprintf("ted:%s", row.NoticeID),
			Title:           title,
			Summary:         fmt.Sprintf("EU procurement — buyer %s", buyer),
			Country:         country,
			CommodityFamily: CommodityFromText(stringPtr(row.Title)),
			CompanyID:       companyPtr,
			Confidence:      0.52,
			Sources: []map[string]any{
				{
					"name":       "eu_ted",
					"url":        fmt.Sprintf("https://ted.europa.eu/en/notice/%s", row.NoticeID),
					"fetched_at": nowISO,
				},
			},
			Evidence: []string{"EU TED public notice"},
			Raw: map[string]any{
				"cpv":   stringPtr(row.CPV),
				"buyer": stringPtr(row.Buyer),
			},
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
