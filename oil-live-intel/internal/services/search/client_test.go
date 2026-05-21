package search

import (
	"encoding/json"
	"reflect"
	"testing"
)

// TestBuildQuery_GoldenShape verifies the multi_match body we send to ES has
// the exact shape we expect for each entity type. Golden JSON keeps the
// contract honest and gives a single, obvious place to update when fields
// are added.
func TestBuildQuery_GoldenShape(t *testing.T) {
	cases := []struct {
		name   string
		entity EntityType
		want   string
	}{
		{
			name:   "cargo defaults",
			entity: TypeCargo,
			want: `{
				"from": 0,
				"size": 20,
				"query": {
					"multi_match": {
						"query": "ras tanura",
						"fields": [
							"shipper_name^2",
							"consignee_name^2",
							"vessel_name^2",
							"commodity_description",
							"commodity_family",
							"discharge_hint"
						],
						"type": "best_fields",
						"fuzziness": "AUTO",
						"operator": "or"
					}
				}
			}`,
		},
		{
			name:   "company defaults",
			entity: TypeCompany,
			want: `{
				"from": 0,
				"size": 20,
				"query": {
					"multi_match": {
						"query": "ras tanura",
						"fields": ["name^3", "normalized_name^2"],
						"type": "best_fields",
						"fuzziness": "AUTO",
						"operator": "or"
					}
				}
			}`,
		},
		{
			name:   "terminal defaults",
			entity: TypeTerminal,
			want: `{
				"from": 0,
				"size": 20,
				"query": {
					"multi_match": {
						"query": "ras tanura",
						"fields": ["name^3", "operator_name"],
						"type": "best_fields",
						"fuzziness": "AUTO",
						"operator": "or"
					}
				}
			}`,
		},
		{
			name:   "vessel defaults",
			entity: TypeVessel,
			want: `{
				"from": 0,
				"size": 20,
				"query": {
					"multi_match": {
						"query": "ras tanura",
						"fields": ["name^3"],
						"type": "best_fields",
						"fuzziness": "AUTO",
						"operator": "or"
					}
				}
			}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := BuildQuery("ras tanura", tc.entity, 20, 0)
			gotJSON, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("marshal got: %v", err)
			}
			var gotMap, wantMap map[string]any
			if err := json.Unmarshal(gotJSON, &gotMap); err != nil {
				t.Fatalf("unmarshal got: %v", err)
			}
			if err := json.Unmarshal([]byte(tc.want), &wantMap); err != nil {
				t.Fatalf("unmarshal want: %v", err)
			}
			if !reflect.DeepEqual(gotMap, wantMap) {
				t.Fatalf("query mismatch.\nwant: %s\ngot:  %s", tc.want, string(gotJSON))
			}
		})
	}
}

func TestBuildQuery_RespectsLimitAndOffset(t *testing.T) {
	body := BuildQuery("acme", TypeCompany, 50, 100)
	if body["size"].(int) != 50 || body["from"].(int) != 100 {
		t.Fatalf("limit/offset not applied: %v", body)
	}
}

func TestBuildQuery_ClampsZeroLimit(t *testing.T) {
	body := BuildQuery("acme", TypeCompany, 0, -5)
	if body["size"].(int) != 20 || body["from"].(int) != 0 {
		t.Fatalf("zero/negative inputs not clamped: %v", body)
	}
}

func TestParseTypesParam(t *testing.T) {
	cases := []struct {
		in   string
		want []EntityType
	}{
		{"", DefaultTypes()},
		{"cargo", []EntityType{TypeCargo}},
		{"cargo,company,terminal,vessel", []EntityType{TypeCargo, TypeCompany, TypeTerminal, TypeVessel}},
		{"  Cargo ,  COMPANY  ", []EntityType{TypeCargo, TypeCompany}},
		// duplicates collapsed and unknowns dropped
		{"cargo,cargo,foo", []EntityType{TypeCargo}},
		// unknown-only string defaults to all (so a bad ?types= doesn't return empty)
		{"foo,bar", DefaultTypes()},
		// plural aliases
		{"companies,terminals,vessels", []EntityType{TypeCompany, TypeTerminal, TypeVessel}},
	}
	for _, tc := range cases {
		got := ParseTypesParam(tc.in)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("ParseTypesParam(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestIndexFor(t *testing.T) {
	pairs := map[EntityType]string{
		TypeCargo:    IndexCargo,
		TypeCompany:  IndexCompanies,
		TypeTerminal: IndexTerminals,
		TypeVessel:   IndexVessels,
	}
	for et, idx := range pairs {
		if IndexFor(et) != idx {
			t.Errorf("IndexFor(%s) != %s", et, idx)
		}
		if TypeFromIndex(idx) != et {
			t.Errorf("TypeFromIndex(%s) != %s", idx, et)
		}
	}
	if IndexFor(EntityType("nope")) != "" {
		t.Errorf("unknown type should map to empty string")
	}
}

func TestIndexDefinitionsCoverAllIndices(t *testing.T) {
	defs := IndexDefinitions()
	for _, idx := range AllIndices() {
		if _, ok := defs[idx]; !ok {
			t.Fatalf("index %s missing from IndexDefinitions()", idx)
		}
	}
	// Spot check the cargo mapping for the geo_point + sanctions chips.
	cargo := defs[IndexCargo]
	props, _ := cargo["mappings"].(map[string]any)["properties"].(map[string]any)
	for _, want := range []string{"corridor_load", "corridor_discharge", "shipper_sanctions_status", "consignee_sanctions_status"} {
		if _, ok := props[want]; !ok {
			t.Errorf("cargo mapping missing %s", want)
		}
	}
}
