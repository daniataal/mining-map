package mcr

import "testing"

func TestClampConf(t *testing.T) {
	tests := []struct{ in, want float64 }{{0.95, 0.95}, {1.0, 0.95}, {0.10, 0.35}, {0.62, 0.62}}
	for _, tc := range tests {
		if got := ClampConf(tc.in); got != tc.want {
			t.Fatalf("ClampConf(%v)=%v want %v", tc.in, got, tc.want)
		}
	}
}

func TestScaffoldStatusWired(t *testing.T) {
	st := ScaffoldStatus()
	if st.Status != "wired" || len(st.Recipes) < 8 {
		t.Fatalf("unexpected scaffold: %+v", st)
	}
}

func TestRecipeConfidencesPortedValues(t *testing.T) {
	byKey := map[string]float64{}
	for _, r := range RecipeConfidences() {
		key := r.Recipe
		if r.Variant != "" {
			key += ":" + r.Variant
		}
		byKey[key] = r.Confidence
	}
	if byKey[RecipePortManifestMatch] != 0.95 || byKey[RecipeRefineryDriven] != 0.70 {
		t.Fatalf("ported values mismatch: %+v", byKey)
	}
}
