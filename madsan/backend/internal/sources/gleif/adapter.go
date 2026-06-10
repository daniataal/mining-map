package gleif

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/sources"
)

const (
	slug         = "gleif"
	apiBase      = "https://api.gleif.org/api/v1/lei-records"
	defaultLimit = 50
	sleepBetween = 400 * time.Millisecond
)

type candidate struct {
	ID   uuid.UUID
	Name string
}

// FetchEnrichment returns NormalizedRecords for madsan companies missing GLEIF LEI evidence.
func FetchEnrichment(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, client *http.Client) ([]sources.Record, error) {
	if pool == nil {
		return nil, fmt.Errorf("database pool required")
	}
	if client == nil {
		client = sources.HTTPClient()
	}
	limit := cfg.GLEIFBatchLimit
	if limit <= 0 {
		limit = defaultLimit
	}

	candidates, err := listCandidates(ctx, pool, limit)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, nil
	}

	ua := cfg.GLEIFUserAgent
	if ua == "" {
		ua = "MadSanIntelligence/1.0 (open-data; contact: ops@madsan.local)"
	}

	var out []sources.Record
	for _, c := range candidates {
		rec, err := lookupLEI(ctx, client, ua, c)
		if err != nil {
			continue
		}
		if rec != nil {
			out = append(out, *rec)
		}
		time.Sleep(sleepBetween)
	}
	return out, nil
}

func listCandidates(ctx context.Context, pool *pgxpool.Pool, limit int) ([]candidate, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.id, c.name
		FROM companies c
		WHERE length(trim(c.name)) > 2
		  AND NOT EXISTS (
		    SELECT 1 FROM evidence e
		    JOIN sources s ON s.id = e.source_id
		    WHERE e.entity_type = 'company'
		      AND e.entity_id = c.id
		      AND s.slug = 'gleif'
		      AND e.claim_type = 'lei'
		  )
		ORDER BY c.confidence_score DESC NULLS LAST, c.updated_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.ID, &c.Name); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func lookupLEI(ctx context.Context, client *http.Client, userAgent string, c candidate) (*sources.Record, error) {
	q := url.Values{}
	q.Set("filter[entity.legalName]", c.Name)
	q.Set("page[size]", "5")
	reqURL := apiBase + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("User-Agent", userAgent)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gleif api status %d", resp.StatusCode)
	}

	var payload gleifResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	match := pickBestMatch(payload.Data, c.Name)
	if match == nil {
		return nil, nil
	}

	lei := match.ID
	legalName := match.Attributes.Entity.LegalName.Name
	country := strings.ToUpper(strings.TrimSpace(match.Attributes.Entity.LegalAddress.Country))
	if legalName == "" {
		legalName = c.Name
	}

	return &sources.Record{
		EntityType:  "company",
		Name:        legalName,
		CountryCode: country,
		SourceSlug:  slug,
		ExternalID:  lei,
		RawPayload: map[string]any{
			"lei":                 lei,
			"legal_name":          legalName,
			"register_tier":       "official_register",
			"source_url":          "https://search.gleif.org/#/record/" + lei,
			"enriched_company_id": c.ID.String(),
			"confidence_score":    78.0,
		},
	}, nil
}

type gleifResponse struct {
	Data []gleifRecord `json:"data"`
}

type gleifRecord struct {
	ID         string `json:"id"`
	Attributes struct {
		Entity struct {
			LegalName struct {
				Name string `json:"name"`
			} `json:"legalName"`
			LegalAddress struct {
				Country string `json:"country"`
			} `json:"legalAddress"`
		} `json:"entity"`
	} `json:"attributes"`
}

func pickBestMatch(rows []gleifRecord, companyName string) *gleifRecord {
	if len(rows) == 0 {
		return nil
	}
	norm := strings.ToLower(strings.TrimSpace(companyName))
	for i := range rows {
		legal := strings.ToLower(strings.TrimSpace(rows[i].Attributes.Entity.LegalName.Name))
		if norm != "" && legal != "" && (strings.Contains(legal, norm) || strings.Contains(norm, legal)) {
			return &rows[i]
		}
	}
	return &rows[0]
}
