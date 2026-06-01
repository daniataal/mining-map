package search

import (
	"context"
	"fmt"
)

// Index names (kept lowercase, matching docker-compose conventions).
const (
	IndexCargo     = "meridian_cargo"
	IndexCompanies = "oil_companies"
	IndexTerminals = "oil_terminals"
	IndexVessels   = "oil_vessels"
	IndexManifest  = "meridian_trade_manifest"
)

// AllIndices returns the four canonical indices the search subsystem owns.
// Order matters for the indexer (cargo last so company/terminal LEI fields are
// resolved first).
func AllIndices() []string {
	return []string{IndexCompanies, IndexTerminals, IndexVessels, IndexCargo, IndexManifest}
}

// IndexExistsOrCreate creates the index if it doesn't exist; otherwise it is
// a no-op. Used by the indexer worker on startup. Mappings are defined per
// IndexDefinitions().
func IndexExistsOrCreate(ctx context.Context, c Client, name string, body map[string]any) error {
	ok, err := c.IndexExists(ctx, name)
	if err != nil {
		return fmt.Errorf("check index %s: %w", name, err)
	}
	if ok {
		return nil
	}
	if err := c.CreateIndex(ctx, name, body); err != nil {
		return fmt.Errorf("create index %s: %w", name, err)
	}
	return nil
}

// EnsureIndices makes sure all four canonical indices exist with the right
// mappings. Safe to call repeatedly; existing indices are not modified.
func EnsureIndices(ctx context.Context, c Client) error {
	defs := IndexDefinitions()
	for _, name := range AllIndices() {
		if err := IndexExistsOrCreate(ctx, c, name, defs[name]); err != nil {
			return err
		}
	}
	return nil
}

// IndexDefinitions returns the per-index settings+mappings used by
// EnsureIndices. Kept as plain map[string]any so they can be diffed against
// golden JSON in tests.
func IndexDefinitions() map[string]map[string]any {
	return map[string]map[string]any{
		IndexCargo:     cargoIndexDef(),
		IndexCompanies: companiesIndexDef(),
		IndexTerminals: terminalsIndexDef(),
		IndexVessels:   vesselsIndexDef(),
		IndexManifest:  manifestIndexDef(),
	}
}

func manifestIndexDef() map[string]any {
	return map[string]any{
		"settings": map[string]any{
			"number_of_shards":   1,
			"number_of_replicas": 0,
		},
		"mappings": map[string]any{
			"properties": map[string]any{
				"id":                keyword(),
				"data_source":       keyword(),
				"bol_tier":          keyword(),
				"importer_name":     text(),
				"exporter_name":     text(),
				"partner_country":   text(),
				"reporter_country":  text(),
				"hs_code":           keyword(),
				"commodity_family":  text(),
				"product_description": text(),
				"source_record_url": keyword(),
				"period_year":       floatField(),
			},
		},
	}
}

func cargoIndexDef() map[string]any {
	return map[string]any{
		"settings": map[string]any{
			"number_of_shards":   1,
			"number_of_replicas": 0,
		},
		"mappings": map[string]any{
			"properties": map[string]any{
				"id":                         keyword(),
				"synthetic_bol_id":           keyword(),
				"recipe":                     keyword(),
				"bol_tier":                   keyword(),
				"shipper_name":               text(),
				"consignee_name":             text(),
				"vessel_name":                text(),
				"commodity_description":      text(),
				"commodity_family":           text(),
				"commodity_family.keyword":   keyword(),
				"discharge_hint":             text(),
				"load_country":               text(),
				"discharge_country":          text(),
				"load_country.keyword":       keyword(),
				"discharge_country.keyword":  keyword(),
				"shipper_lei":                keyword(),
				"consignee_lei":              keyword(),
				"shipper_sanctions_status":   keyword(),
				"consignee_sanctions_status": keyword(),
				"event_date":                 dateField(),
				"confidence":                 floatField(),
				"triangulation_score":        floatField(),
				"volume_best_estimate":       floatField(),
				"corridor_load":              geoPointField(),
				"corridor_discharge":         geoPointField(),
			},
		},
	}
}

func companiesIndexDef() map[string]any {
	return map[string]any{
		"settings": map[string]any{
			"number_of_shards":   1,
			"number_of_replicas": 0,
		},
		"mappings": map[string]any{
			"properties": map[string]any{
				"id":               keyword(),
				"name":             text(),
				"normalized_name":  text(),
				"country":          keyword(),
				"sanctions_status": keyword(),
				"lei":              keyword(),
				"wikidata_qid":     keyword(),
				"confidence":       floatField(),
			},
		},
	}
}

func terminalsIndexDef() map[string]any {
	return map[string]any{
		"settings": map[string]any{
			"number_of_shards":   1,
			"number_of_replicas": 0,
		},
		"mappings": map[string]any{
			"properties": map[string]any{
				"id":            keyword(),
				"name":          text(),
				"operator_name": text(),
				"country":       keyword(),
				"products":      keyword(),
				"location":      geoPointField(),
			},
		},
	}
}

func vesselsIndexDef() map[string]any {
	return map[string]any{
		"settings": map[string]any{
			"number_of_shards":   1,
			"number_of_replicas": 0,
		},
		"mappings": map[string]any{
			"properties": map[string]any{
				"name":         text(),
				"imo":          keyword(),
				"mmsi":         keyword(),
				"flag":         keyword(),
				"tanker_class": keyword(),
			},
		},
	}
}

func text() map[string]any        { return map[string]any{"type": "text"} }
func keyword() map[string]any     { return map[string]any{"type": "keyword"} }
func dateField() map[string]any   { return map[string]any{"type": "date"} }
func floatField() map[string]any  { return map[string]any{"type": "float"} }
func geoPointField() map[string]any { return map[string]any{"type": "geo_point"} }
