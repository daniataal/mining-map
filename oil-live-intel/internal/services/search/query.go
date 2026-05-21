package search

import (
	"strings"
)

// EntityType is the public string code returned alongside each hit so the UI
// can dispatch to the right drawer ("cargo" → cargo drawer, etc.).
type EntityType string

const (
	TypeCargo    EntityType = "cargo"
	TypeCompany  EntityType = "company"
	TypeTerminal EntityType = "terminal"
	TypeVessel   EntityType = "vessel"
)

// IndexFor maps the public entity type code to the underlying ES index name.
func IndexFor(t EntityType) string {
	switch t {
	case TypeCargo:
		return IndexCargo
	case TypeCompany:
		return IndexCompanies
	case TypeTerminal:
		return IndexTerminals
	case TypeVessel:
		return IndexVessels
	}
	return ""
}

// TypeFromIndex is the reverse of IndexFor — used when materialising hits.
func TypeFromIndex(idx string) EntityType {
	switch idx {
	case IndexCargo:
		return TypeCargo
	case IndexCompanies:
		return TypeCompany
	case IndexTerminals:
		return TypeTerminal
	case IndexVessels:
		return TypeVessel
	}
	return ""
}

// DefaultTypes returns the four canonical entity types we expose via
// /api/oil-live/search.
func DefaultTypes() []EntityType {
	return []EntityType{TypeCargo, TypeCompany, TypeTerminal, TypeVessel}
}

// ParseTypesParam normalises the comma-separated ?types= query string to a
// deduplicated, ordered slice of EntityType. Unknown values are ignored. An
// empty input returns DefaultTypes() so the API defaults to "all".
func ParseTypesParam(raw string) []EntityType {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultTypes()
	}
	seen := make(map[EntityType]struct{}, 4)
	out := make([]EntityType, 0, 4)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(strings.ToLower(part))
		var t EntityType
		switch part {
		case "cargo":
			t = TypeCargo
		case "company", "companies":
			t = TypeCompany
		case "terminal", "terminals":
			t = TypeTerminal
		case "vessel", "vessels":
			t = TypeVessel
		default:
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	if len(out) == 0 {
		return DefaultTypes()
	}
	return out
}

// fieldsForType returns the text fields scanned by multi_match for each entity
// type. They mirror the per-index text mappings declared in indices.go.
func fieldsForType(t EntityType) []string {
	switch t {
	case TypeCargo:
		return []string{
			"shipper_name^2",
			"consignee_name^2",
			"vessel_name^2",
			"commodity_description",
			"commodity_family",
			"discharge_hint",
		}
	case TypeCompany:
		return []string{"name^3", "normalized_name^2"}
	case TypeTerminal:
		return []string{"name^3", "operator_name"}
	case TypeVessel:
		return []string{"name^3"}
	}
	return nil
}

// BuildQuery returns the multi_match body sent to ES for a given user query
// and entity type. Kept as a free function (no Client receiver) so the
// builder is trivially unit-testable against a golden JSON shape.
//
// The result is always a fresh map[string]any — callers may mutate it (e.g.
// add `from`/`size`).
func BuildQuery(q string, t EntityType, limit, offset int) map[string]any {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	fields := fieldsForType(t)
	if len(fields) == 0 {
		fields = []string{"name"}
	}
	return map[string]any{
		"from": offset,
		"size": limit,
		"query": map[string]any{
			"multi_match": map[string]any{
				"query":     q,
				"fields":    fields,
				"type":      "best_fields",
				"fuzziness": "AUTO",
				"operator":  "or",
			},
		},
	}
}
