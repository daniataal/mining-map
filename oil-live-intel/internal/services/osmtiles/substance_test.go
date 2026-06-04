package osmtiles

import "testing"

func TestClassifyPipelineSubstance(t *testing.T) {
	tests := []struct {
		tags map[string]string
		want string
	}{
		{map[string]string{"substance": "oil"}, "oil"},
		{map[string]string{"substance": "natural gas"}, "gas"},
		{map[string]string{"type": "water"}, "water"},
		{map[string]string{"usage": "irrigation"}, "water"},
		{map[string]string{"pipeline_substance": "gas"}, "gas"},
		{map[string]string{}, "unknown"},
	}
	for _, tc := range tests {
		got := ClassifyPipelineSubstance(tc.tags)
		if got != tc.want {
			t.Fatalf("tags=%v got %q want %q", tc.tags, got, tc.want)
		}
	}
}
