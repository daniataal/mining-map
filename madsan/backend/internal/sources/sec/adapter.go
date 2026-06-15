package sec

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/sources"
)

const (
	slug              = "sec_edgar"
	tickersURL        = "https://www.sec.gov/files/company_tickers.json"
	tickerCacheTTL    = 24 * time.Hour
	defaultBatchLimit = 25
)

var suffixRE = regexp.MustCompile(`\b(inc|ltd|llc|corp|corporation|company|co|plc|limited|sa|ag)\b`)

type tickerRow struct {
	CIK    int    `json:"cik_str"`
	Ticker string `json:"ticker"`
	Title  string `json:"title"`
}

var tickerCache struct {
	mu      sync.RWMutex
	loaded  time.Time
	rows    []tickerRow
	loadErr error
}

// FetchEnrichment matches US companies against SEC EDGAR tickers (heuristic CIK linker stub).
// Tier is honest: observed CIK/ticker from SEC file; name match is inferred/heuristic.
func FetchEnrichment(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, client *http.Client) ([]sources.Record, error) {
	if pool == nil {
		return nil, fmt.Errorf("database pool required")
	}
	if client == nil {
		client = sources.HTTPClient()
	}
	limit := cfg.SECEdgarBatchLimit
	if limit <= 0 {
		limit = defaultBatchLimit
	}

	ua := cfg.SECEdgarUserAgent
	if ua == "" {
		ua = "MadSanIntelligence/1.0 (open-data; contact: ops@madsan.local)"
	}

	tickers, err := loadTickers(ctx, client, ua)
	if err != nil {
		return nil, err
	}
	if len(tickers) == 0 {
		return nil, fmt.Errorf("sec edgar tickers empty")
	}

	candidates, err := listUSCandidates(ctx, pool, limit)
	if err != nil {
		return nil, err
	}

	var out []sources.Record
	for _, c := range candidates {
		match := bestTickerMatch(tickers, c.Name)
		if match == nil {
			continue
		}
		cik := fmt.Sprintf("%010d", match.CIK)
		out = append(out, sources.Record{
			EntityType:  "company",
			Name:        match.Title,
			CountryCode: "US",
			SourceSlug:  slug,
			ExternalID:  cik,
			RawPayload: map[string]any{
				"cik":                 cik,
				"ticker":              match.Ticker,
				"register_tier":       "official_register",
				"source_url":          edgarBrowseURL(cik),
				"match_tier":          "inferred",
				"match_disclaimer":    "Heuristic name match against SEC tickers — confirm CIK on sec.gov before compliance use.",
				"enriched_company_id": c.ID.String(),
				"confidence_score":    62.0,
			},
		})
	}
	return out, nil
}

type candidate struct {
	ID   uuid.UUID
	Name string
}

func listUSCandidates(ctx context.Context, pool *pgxpool.Pool, limit int) ([]candidate, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.id, c.name
		FROM companies c
		WHERE length(trim(c.name)) > 2
		  AND (c.country_code = 'US' OR c.country_code IS NULL OR c.country_code = '')
		  AND NOT EXISTS (
		    SELECT 1 FROM evidence e
		    JOIN sources s ON s.id = e.source_id
		    WHERE e.entity_type = 'company'
		      AND e.entity_id = c.id
		      AND s.slug = 'sec_edgar'
		      AND e.claim_type = 'cik'
		  )
		ORDER BY c.updated_at DESC
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

func loadTickers(ctx context.Context, client *http.Client, userAgent string) ([]tickerRow, error) {
	tickerCache.mu.RLock()
	if time.Since(tickerCache.loaded) < tickerCacheTTL && len(tickerCache.rows) > 0 {
		rows := tickerCache.rows
		tickerCache.mu.RUnlock()
		return rows, nil
	}
	tickerCache.mu.RUnlock()

	tickerCache.mu.Lock()
	defer tickerCache.mu.Unlock()
	if time.Since(tickerCache.loaded) < tickerCacheTTL && len(tickerCache.rows) > 0 {
		return tickerCache.rows, tickerCache.loadErr
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, tickersURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)

	resp, err := client.Do(req)
	if err != nil {
		tickerCache.loadErr = err
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		err = fmt.Errorf("sec edgar tickers status %d", resp.StatusCode)
		tickerCache.loadErr = err
		return nil, err
	}

	var payload map[string]tickerRow
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		tickerCache.loadErr = err
		return nil, err
	}
	rows := make([]tickerRow, 0, len(payload))
	for _, row := range payload {
		if row.Title != "" {
			rows = append(rows, row)
		}
	}
	tickerCache.rows = rows
	tickerCache.loaded = time.Now().UTC()
	tickerCache.loadErr = nil
	return rows, nil
}

func normalizeName(s string) string {
	text := strings.ToLower(strings.TrimSpace(s))
	text = suffixRE.ReplaceAllString(text, " ")
	text = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(text, " ")
	return strings.Join(strings.Fields(text), " ")
}

func nameScore(a, b string) float64 {
	if a == "" || b == "" {
		return 0
	}
	if a == b {
		return 1
	}
	if strings.Contains(a, b) || strings.Contains(b, a) {
		return 0.85
	}
	// simple token overlap
	ta := strings.Fields(a)
	tb := strings.Fields(b)
	if len(ta) == 0 || len(tb) == 0 {
		return 0
	}
	hits := 0
	for _, x := range ta {
		for _, y := range tb {
			if x == y {
				hits++
				break
			}
		}
	}
	denom := len(ta)
	if len(tb) > denom {
		denom = len(tb)
	}
	return float64(hits) / float64(denom)
}

func bestTickerMatch(rows []tickerRow, companyName string) *tickerRow {
	query := normalizeName(companyName)
	if query == "" {
		return nil
	}
	const minScore = 0.72
	var best *tickerRow
	var bestScore float64
	for i := range rows {
		score := nameScore(query, normalizeName(rows[i].Title))
		if score >= minScore && score > bestScore {
			bestScore = score
			best = &rows[i]
		}
	}
	return best
}

func edgarBrowseURL(cik string) string {
	return "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + cik + "&owner=exclude&count=40"
}

// ResetTickerCache clears the in-process ticker cache (tests only).
func ResetTickerCache() {
	tickerCache.mu.Lock()
	defer tickerCache.mu.Unlock()
	tickerCache.loaded = time.Time{}
	tickerCache.rows = nil
	tickerCache.loadErr = nil
}
