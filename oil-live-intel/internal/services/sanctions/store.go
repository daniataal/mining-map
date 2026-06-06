package sanctions

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/services/countrymatch"
)

const SourceTier = "opensanctions_screening"

// Coverage describes whether stored counterparties were screened for a country.
type Coverage string

const (
	CoverageScreened Coverage = "screened"
	CoverageNoData   Coverage = "no_data"
)

// CountrySummary is one row in the country sanctions choropleth.
type CountrySummary struct {
	CountryCode         string    `json:"country_code"`
	CountryName         string    `json:"country_name"`
	Coverage            Coverage  `json:"coverage"`
	FlagLevel           FlagLevel `json:"flag_level,omitempty"`
	MatchCount          int       `json:"match_count"`
	ScreenedEntityCount int       `json:"screened_entity_count"`
	FlaggedCount        int       `json:"flagged_count"`
	ReviewCount         int       `json:"review_count"`
	ClearCount          int       `json:"clear_count"`
	SourceTier          string    `json:"source_tier"`
	FetchedAt           time.Time `json:"fetched_at"`
}

// EntityHit is a screened counterparty linked to a country (rail detail).
type EntityHit struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	SanctionsStatus string    `json:"sanctions_status"`
	CheckedAt       time.Time `json:"checked_at,omitempty"`
	OpenSanctionsID string    `json:"opensanctions_entity_id,omitempty"`
}

// SummaryResponse is returned by the country-summary API.
type SummaryResponse struct {
	Countries            []CountrySummary `json:"countries"`
	Disclaimer           string           `json:"disclaimer"`
	SourceTier           string           `json:"source_tier"`
	APIKeyConfigured     bool             `json:"api_key_configured"`
	Cached               bool             `json:"cached"`
	FetchedAt            time.Time        `json:"fetched_at"`
	CountryFilter        string           `json:"country_filter,omitempty"`
	Entities             []EntityHit      `json:"entities,omitempty"`
	ScreenedCompanies    int              `json:"screened_companies,omitempty"`
	ScreenedCountryCount int              `json:"screened_country_count"`
}

type countryRow struct {
	country     string
	flagged     int
	review      int
	clear       int
	screened    int
	lastChecked *time.Time
}

// Store loads and caches country-level aggregates from oil_companies screening.
type Store struct {
	pool             *pgxpool.Pool
	cacheTTL         time.Duration
	apiKeyConfigured bool

	mu        sync.RWMutex
	cachedAt  time.Time
	cachedAll []CountrySummary
}

func NewStore(pool *pgxpool.Pool, cacheTTL time.Duration, apiKeyConfigured bool) *Store {
	if cacheTTL <= 0 {
		cacheTTL = time.Hour
	}
	return &Store{
		pool:             pool,
		cacheTTL:         cacheTTL,
		apiKeyConfigured: apiKeyConfigured,
	}
}

func (s *Store) Summary(ctx context.Context, countryFilter string) (*SummaryResponse, error) {
	if s.pool == nil {
		return nil, fmt.Errorf("database_unavailable")
	}

	countryFilter = strings.TrimSpace(countryFilter)
	all, cached, err := s.loadAll(ctx)
	if err != nil {
		return nil, err
	}

	resp := &SummaryResponse{
		Countries:            all,
		Disclaimer:           DisclaimerText,
		SourceTier:           SourceTier,
		APIKeyConfigured:     s.apiKeyConfigured,
		Cached:               cached,
		FetchedAt:            time.Now().UTC(),
		CountryFilter:        countryFilter,
		ScreenedCountryCount: len(all),
	}

	if countryFilter == "" {
		return resp, nil
	}

	var matched []CountrySummary
	for _, row := range all {
		if countrymatch.KeysMatch(row.CountryName, countryFilter) {
			matched = append(matched, row)
		}
	}
	if len(matched) == 0 {
		resp.Countries = []CountrySummary{{
			CountryName: countryFilter,
			Coverage:    CoverageNoData,
			SourceTier:  SourceTier,
			FetchedAt:   resp.FetchedAt,
		}}
		resp.Entities = []EntityHit{}
		resp.ScreenedCompanies = 0
		return resp, nil
	}
	resp.Countries = matched

	entities, screened, err := s.loadEntities(ctx, countryFilter)
	if err != nil {
		return nil, err
	}
	resp.Entities = entities
	resp.ScreenedCompanies = screened
	return resp, nil
}

func (s *Store) loadAll(ctx context.Context) ([]CountrySummary, bool, error) {
	s.mu.RLock()
	if !s.cachedAt.IsZero() && time.Since(s.cachedAt) < s.cacheTTL && len(s.cachedAll) > 0 {
		out := append([]CountrySummary(nil), s.cachedAll...)
		s.mu.RUnlock()
		return out, true, nil
	}
	s.mu.RUnlock()

	rows, err := s.queryCountryRows(ctx)
	if err != nil {
		return nil, false, err
	}

	fetchedAt := time.Now().UTC()
	out := make([]CountrySummary, 0, len(rows))
	for _, row := range rows {
		level := AggregateFlagLevel(row.flagged, row.review)
		item := CountrySummary{
			CountryName:         row.country,
			Coverage:            CoverageScreened,
			FlagLevel:           level,
			MatchCount:          MatchCount(row.flagged, row.review),
			ScreenedEntityCount: row.screened,
			FlaggedCount:        row.flagged,
			ReviewCount:         row.review,
			ClearCount:          row.clear,
			SourceTier:          SourceTier,
			FetchedAt:           fetchedAt,
		}
		if row.lastChecked != nil {
			item.FetchedAt = row.lastChecked.UTC()
		}
		out = append(out, item)
	}

	s.mu.Lock()
	s.cachedAll = out
	s.cachedAt = time.Now()
	s.mu.Unlock()

	return out, false, nil
}

func (s *Store) queryCountryRows(ctx context.Context) ([]countryRow, error) {
	const q = `
		SELECT TRIM(country) AS country,
		       COUNT(*) FILTER (WHERE LOWER(TRIM(sanctions_status)) = 'flagged')::int,
		       COUNT(*) FILTER (WHERE LOWER(TRIM(sanctions_status)) = 'review')::int,
		       COUNT(*) FILTER (WHERE LOWER(TRIM(sanctions_status)) = 'clear')::int,
		       COUNT(*) FILTER (WHERE sanctions_status IS NOT NULL)::int,
		       MAX(sanctions_checked_at)
		FROM oil_companies
		WHERE TRIM(COALESCE(country, '')) <> ''
		GROUP BY TRIM(country)
		HAVING COUNT(*) FILTER (WHERE sanctions_status IS NOT NULL) > 0
		ORDER BY TRIM(country)
	`
	dbRows, err := s.pool.Query(ctx, q)
	if err != nil {
		if isUndefinedColumn(err) {
			return nil, nil
		}
		return nil, err
	}
	defer dbRows.Close()

	var out []countryRow
	for dbRows.Next() {
		var row countryRow
		if err := dbRows.Scan(&row.country, &row.flagged, &row.review, &row.clear, &row.screened, &row.lastChecked); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, dbRows.Err()
}

func (s *Store) loadEntities(ctx context.Context, countryFilter string) ([]EntityHit, int, error) {
	matchKeys := countrymatch.MatchKeys(countryFilter)
	const q = `
		SELECT id::text,
		       TRIM(name),
		       COALESCE(sanctions_status, ''),
		       sanctions_checked_at,
		       COALESCE(sanctions_matches->0->>'id', '')
		FROM oil_companies
		WHERE sanctions_status IS NOT NULL
		  AND TRIM(COALESCE(country, '')) <> ''
		  AND LOWER(TRIM(country)) = ANY($1::text[])
		ORDER BY
		  CASE LOWER(TRIM(sanctions_status))
		    WHEN 'flagged' THEN 0
		    WHEN 'review' THEN 1
		    ELSE 2
		  END,
		  name
		LIMIT 12
	`
	dbRows, err := s.pool.Query(ctx, q, matchKeys)
	if err != nil {
		if isUndefinedColumn(err) {
			return []EntityHit{}, 0, nil
		}
		return nil, 0, err
	}
	defer dbRows.Close()

	var entities []EntityHit
	for dbRows.Next() {
		var hit EntityHit
		var checkedAt *time.Time
		if err := dbRows.Scan(&hit.ID, &hit.Name, &hit.SanctionsStatus, &checkedAt, &hit.OpenSanctionsID); err != nil {
			return nil, 0, err
		}
		if checkedAt != nil {
			hit.CheckedAt = checkedAt.UTC()
		}
		entities = append(entities, hit)
	}
	if entities == nil {
		entities = []EntityHit{}
	}
	return entities, len(entities), dbRows.Err()
}

const DisclaimerText = "Screening signal from OpenSanctions entity matches on stored counterparties — not a legal determination. Verify independently before acting."

func isUndefinedColumn(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "42703") || strings.Contains(msg, "undefined column")
}
