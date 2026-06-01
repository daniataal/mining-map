package graphsync

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// NormalizeName mirrors backend/services/oil_live_graph_sync._normalize_name.
func NormalizeName(name string) string {
	text := strings.ToLower(strings.TrimSpace(name))
	text = nonAlnum.ReplaceAllString(text, " ")
	return strings.Join(strings.Fields(text), " ")
}

// MergeCompanyMetadata mirrors backend/services/oil_live_graph_sync._merge_company_metadata.
func MergeCompanyMetadata(existing, incoming map[string]any, source, companyType string) map[string]any {
	base := map[string]any{}
	for k, v := range existing {
		base[k] = v
	}
	for k, v := range incoming {
		base[k] = v
	}

	roles := make([]string, 0)
	seenRole := map[string]struct{}{}
	appendRole := func(r string) {
		r = strings.TrimSpace(r)
		if r == "" {
			return
		}
		if _, ok := seenRole[r]; ok {
			return
		}
		seenRole[r] = struct{}{}
		roles = append(roles, r)
	}
	for _, item := range asStringSlice(base["roles"]) {
		appendRole(item)
	}
	appendRole(companyType)
	base["roles"] = roles

	sources := make([]map[string]any, 0)
	seenSource := map[string]struct{}{}
	for _, item := range asMapSlice(base["sources"]) {
		name := strings.TrimSpace(stringFromAny(item["name"]))
		if name == "" {
			continue
		}
		if _, ok := seenSource[name]; ok {
			continue
		}
		seenSource[name] = struct{}{}
		sources = append(sources, item)
	}
	if source != "" {
		if _, ok := seenSource[source]; !ok {
			sources = append(sources, map[string]any{
				"name":       source,
				"fetched_at": time.Now().UTC().Format(time.RFC3339),
			})
		}
	}
	base["sources"] = sources
	return base
}

// UpsertCompany mirrors backend/services/oil_live_graph_sync._upsert_company.
func UpsertCompany(
	ctx context.Context,
	pool *pgxpool.Pool,
	name, country, companyType, source string,
	confidence float64,
	metadata map[string]any,
) (string, error) {
	name = strings.TrimSpace(name)
	if len(name) < 2 {
		return "", nil
	}
	norm := NormalizeName(name)
	if norm == "" {
		return "", nil
	}
	if metadata == nil {
		metadata = map[string]any{}
	}

	var existingMeta []byte
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(metadata, '{}'::jsonb) FROM oil_companies
		WHERE normalized_name = $1 AND country = $2
		LIMIT 1
	`, norm, country).Scan(&existingMeta)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	existing := map[string]any{}
	if len(existingMeta) > 0 {
		_ = json.Unmarshal(existingMeta, &existing)
	}
	merged := MergeCompanyMetadata(existing, metadata, source, companyType)
	metaJSON, err := json.Marshal(merged)
	if err != nil {
		return "", err
	}

	var id string
	err = pool.QueryRow(ctx, `
		INSERT INTO oil_companies (name, normalized_name, company_type, country, source, confidence, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
		ON CONFLICT (normalized_name, country) DO UPDATE SET
		  name = EXCLUDED.name,
		  company_type = CASE
		    WHEN EXCLUDED.confidence >= oil_companies.confidence THEN EXCLUDED.company_type
		    ELSE oil_companies.company_type
		  END,
		  source = CASE
		    WHEN EXCLUDED.confidence >= oil_companies.confidence THEN EXCLUDED.source
		    ELSE oil_companies.source
		  END,
		  confidence = GREATEST(oil_companies.confidence, EXCLUDED.confidence),
		  metadata = EXCLUDED.metadata,
		  updated_at = now()
		RETURNING id::text
	`, name, norm, companyType, country, source, confidence, metaJSON).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

func asStringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func asMapSlice(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return t
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, item := range t {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func stringFromAny(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
