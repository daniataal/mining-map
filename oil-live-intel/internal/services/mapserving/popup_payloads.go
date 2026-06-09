package mapserving

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PopupPayload is a pre-merged popup served to the map without runtime multi-source joins.
type PopupPayload struct {
	FeatureKey   string          `json:"feature_key"`
	AssetID      *string         `json:"asset_id,omitempty"`
	PopupVersion int             `json:"popup_version"`
	Title        string          `json:"title,omitempty"`
	Subtitle     string          `json:"subtitle,omitempty"`
	BolTier      string          `json:"bol_tier,omitempty"`
	GeocodeTier  string          `json:"geocode_tier,omitempty"`
	Sources      json.RawMessage `json:"sources"`
	Fields       json.RawMessage `json:"fields"`
	Limitations  json.RawMessage `json:"limitations"`
	BuiltAt      string          `json:"built_at,omitempty"`
}

func BunkerFeatureKey(id string) string {
	return "bunker:" + strings.TrimSpace(id)
}

func StorageFeatureKey(id string) string {
	return "storage:" + strings.TrimSpace(id)
}

// RebuildPopupPayloads upserts bunker supplier and storage terminal popups at graph-sync time.
func RebuildPopupPayloads(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	const bunkerQ = `
INSERT INTO map_feature_popup_payload (
  feature_key, asset_id, title, subtitle, bol_tier, geocode_tier, sources, fields, limitations, built_at
)
SELECT
  'bunker:' || id::text,
  id,
  name,
  COALESCE(
    NULLIF(TRIM(metadata->>'port_name'), ''),
    NULLIF(TRIM(metadata->>'port_locode'), ''),
    NULLIF(TRIM(country), ''),
    'Bunker supplier'
  ),
  'open_register',
  COALESCE(NULLIF(TRIM(metadata->>'geocode_tier'), ''), 'unknown'),
  COALESCE(
    CASE
      WHEN NULLIF(TRIM(metadata->>'source_url'), '') IS NOT NULL THEN
        jsonb_build_array(jsonb_build_object('name', 'register', 'url', metadata->>'source_url'))
      ELSE '[]'::jsonb
    END,
    '[]'::jsonb
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'fuels_supplied', NULLIF(TRIM(metadata->>'fuels_supplied'), ''),
    'license_authority', NULLIF(TRIM(metadata->>'license_authority'), ''),
    'contact_person', NULLIF(TRIM(metadata->>'contact_person'), ''),
    'port_locode', NULLIF(TRIM(metadata->>'port_locode'), ''),
    'port_name', NULLIF(TRIM(metadata->>'port_name'), ''),
    'address', NULLIF(TRIM(metadata->>'register_address'), ''),
    'company_type', NULLIF(TRIM(company_type), '')
  )),
  jsonb_build_array('Curated bunker register — verify licence and delivery terms before execution.'),
  now()
FROM oil_companies
WHERE supplier_status = 'active'
  AND metadata->>'enrichment_tier' = 'bunker_fuel_suppliers_curated'
ON CONFLICT (feature_key) DO UPDATE SET
  asset_id = EXCLUDED.asset_id,
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  bol_tier = EXCLUDED.bol_tier,
  geocode_tier = EXCLUDED.geocode_tier,
  sources = EXCLUDED.sources,
  fields = EXCLUDED.fields,
  limitations = EXCLUDED.limitations,
  built_at = now()
`
	tag1, err := pool.Exec(ctx, bunkerQ)
	if err != nil {
		return 0, fmt.Errorf("rebuild bunker popup payloads: %w", err)
	}

	const storageQ = `
INSERT INTO map_feature_popup_payload (
  feature_key, asset_id, title, subtitle, bol_tier, geocode_tier, sources, fields, limitations, built_at
)
SELECT
  'storage:' || id::text,
  id,
  name,
  COALESCE(NULLIF(TRIM(operator_name), ''), NULLIF(TRIM(terminal_type), ''), NULLIF(TRIM(port), ''), 'Storage terminal'),
  'infrastructure_open',
  'facility_point',
  COALESCE(
    CASE
      WHEN NULLIF(TRIM(source_url), '') IS NOT NULL THEN
        jsonb_build_array(jsonb_build_object('name', COALESCE(NULLIF(TRIM(source), ''), 'source'), 'url', source_url))
      ELSE jsonb_build_array(jsonb_build_object('name', COALESCE(NULLIF(TRIM(source), ''), 'curated'), 'url', NULL))
    END,
    '[]'::jsonb
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'operator_name', NULLIF(TRIM(operator_name), ''),
    'owner_name', NULLIF(TRIM(owner_name), ''),
    'country', NULLIF(TRIM(country), ''),
    'port', NULLIF(TRIM(port), ''),
    'terminal_type', NULLIF(TRIM(terminal_type), ''),
    'products', to_jsonb(products)
  )),
  jsonb_build_array('Open infrastructure intelligence — not verified throughput or regulatory status.'),
  now()
FROM oil_terminals
WHERE geom IS NOT NULL
ON CONFLICT (feature_key) DO UPDATE SET
  asset_id = EXCLUDED.asset_id,
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  bol_tier = EXCLUDED.bol_tier,
  geocode_tier = EXCLUDED.geocode_tier,
  sources = EXCLUDED.sources,
  fields = EXCLUDED.fields,
  limitations = EXCLUDED.limitations,
  built_at = now()
`
	tag2, err := pool.Exec(ctx, storageQ)
	if err != nil {
		return int(tag1.RowsAffected()), fmt.Errorf("rebuild storage popup payloads: %w", err)
	}
	total := tag1.RowsAffected() + tag2.RowsAffected()

	if n, err := rebuildOsmPointPopupPayloads(ctx, pool); err != nil {
		return int(total), err
	} else {
		total += n
	}
	if n, err := rebuildGemPipelinePopupPayloads(ctx, pool); err != nil {
		return int(total), err
	} else {
		total += n
	}
	if n, err := rebuildOsmPipelinePopupPayloads(ctx, pool); err != nil {
		return int(total), err
	} else {
		total += n
	}
	return int(total), nil
}

// GetPopupPayload loads a materialized popup by feature_key.
func GetPopupPayload(ctx context.Context, pool *pgxpool.Pool, featureKey string) (*PopupPayload, error) {
	featureKey = strings.TrimSpace(featureKey)
	if featureKey == "" {
		return nil, fmt.Errorf("feature_key required")
	}
	var row PopupPayload
	var builtAt time.Time
	err := pool.QueryRow(ctx, `
SELECT feature_key, asset_id::text, popup_version, title, subtitle, bol_tier, geocode_tier,
       sources, fields, limitations, built_at
FROM map_feature_popup_payload
WHERE feature_key = $1
`, featureKey).Scan(
		&row.FeatureKey,
		&row.AssetID,
		&row.PopupVersion,
		&row.Title,
		&row.Subtitle,
		&row.BolTier,
		&row.GeocodeTier,
		&row.Sources,
		&row.Fields,
		&row.Limitations,
		&builtAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	row.BuiltAt = builtAt.UTC().Format(time.RFC3339)
	return &row, nil
}
