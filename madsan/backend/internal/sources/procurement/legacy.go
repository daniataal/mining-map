package procurement

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/sources"
)

const slug = "legacy_procurement"

// FetchLegacy imports eu_procurement_notices and gov_procurement_awards from mining_db when present.
func FetchLegacy(ctx context.Context, legacy *pgxpool.Pool) ([]sources.Record, error) {
	if legacy == nil {
		return nil, fmt.Errorf("legacy database pool required")
	}
	var out []sources.Record

	euExists, err := tableExists(ctx, legacy, "eu_procurement_notices")
	if err != nil {
		return nil, err
	}
	if euExists {
		recs, err := fetchEUNotices(ctx, legacy)
		if err != nil {
			return nil, fmt.Errorf("eu_procurement_notices: %w", err)
		}
		out = append(out, recs...)
	}

	govExists, err := tableExists(ctx, legacy, "gov_procurement_awards")
	if err != nil {
		return nil, err
	}
	if govExists {
		recs, err := fetchGovAwards(ctx, legacy)
		if err != nil {
			return nil, fmt.Errorf("gov_procurement_awards: %w", err)
		}
		out = append(out, recs...)
	}
	return out, nil
}

func tableExists(ctx context.Context, pool *pgxpool.Pool, table string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `SELECT to_regclass('public.' || $1) IS NOT NULL`, table).Scan(&exists)
	return exists, err
}

func fetchEUNotices(ctx context.Context, legacy *pgxpool.Pool) ([]sources.Record, error) {
	rows, err := legacy.Query(ctx, `
		SELECT notice_id, title, buyer, country, cpv, award_value, published_at, source_url
		FROM eu_procurement_notices
		WHERE title ILIKE ANY(ARRAY['%petrol%','%diesel%','%fuel%','%oil%','%gas%','%LPG%','%LNG%'])
		   OR cpv LIKE '09%' OR cpv LIKE '091%'
		ORDER BY published_at DESC NULLS LAST
		LIMIT 2000
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []sources.Record
	for rows.Next() {
		var noticeID string
		var title, buyer, country, cpv, sourceURL *string
		var awardValue *float64
		var publishedAt *time.Time
		if err := rows.Scan(&noticeID, &title, &buyer, &country, &cpv, &awardValue, &publishedAt, &sourceURL); err != nil {
			return nil, err
		}
		name := strPtr(buyer)
		if name == "" {
			name = "Unknown buyer"
		}
		rec := sources.Record{
			EntityType:  "company",
			Name:        name,
			CountryCode: strings.ToUpper(strings.TrimSpace(strPtr(country))),
			SourceSlug:  slug,
			ExternalID:  noticeID,
			Commodities: []string{"procurement_lead"},
			RawPayload: map[string]any{
				"lead_type":        "eu_procurement_notice",
				"notice_id":        noticeID,
				"title":            strPtr(title),
				"buyer":            strPtr(buyer),
				"cpv":              strPtr(cpv),
				"register_tier":    "official_register",
				"confidence_score": 52.0,
			},
		}
		if awardValue != nil {
			rec.RawPayload["award_value"] = *awardValue
		}
		if publishedAt != nil {
			rec.RawPayload["published_at"] = publishedAt.UTC().Format(time.RFC3339)
		}
		if u := strPtr(sourceURL); u != "" {
			rec.RawPayload["source_url"] = u
		} else {
			rec.RawPayload["source_url"] = "https://ted.europa.eu/en/notice/" + noticeID
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func fetchGovAwards(ctx context.Context, legacy *pgxpool.Pool) ([]sources.Record, error) {
	rows, err := legacy.Query(ctx, `
		SELECT award_id, commodity_tag, recipient_name, agency, amount, award_date, description_snippet, usaspending_url
		FROM gov_procurement_awards
		WHERE commodity_tag ILIKE '%petroleum%'
		   OR commodity_tag ILIKE '%fuel%'
		   OR description_snippet ILIKE ANY(ARRAY['%fuel%','%petroleum%','%diesel%','%JP8%','%F76%'])
		ORDER BY award_date DESC NULLS LAST
		LIMIT 2000
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []sources.Record
	for rows.Next() {
		var awardID, commodityTag string
		var recipient, agency, desc, usaURL *string
		var amount *float64
		var awardDate *time.Time
		if err := rows.Scan(&awardID, &commodityTag, &recipient, &agency, &amount, &awardDate, &desc, &usaURL); err != nil {
			return nil, err
		}
		name := strPtr(recipient)
		if name == "" {
			name = "Award recipient"
		}
		extID := awardID + ":" + commodityTag
		rec := sources.Record{
			EntityType:  "company",
			Name:        name,
			CountryCode: "US",
			SourceSlug:  slug,
			ExternalID:  extID,
			Commodities: []string{"procurement_lead"},
			RawPayload: map[string]any{
				"lead_type":        "gov_procurement_award",
				"award_id":         awardID,
				"commodity_tag":    commodityTag,
				"agency":           strPtr(agency),
				"description":      strPtr(desc),
				"register_tier":    "official_register",
				"confidence_score": 58.0,
			},
		}
		if amount != nil {
			rec.RawPayload["amount"] = *amount
		}
		if awardDate != nil {
			rec.RawPayload["award_date"] = awardDate.UTC().Format(time.RFC3339)
		}
		if u := strPtr(usaURL); u != "" {
			rec.RawPayload["source_url"] = u
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func strPtr(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}
