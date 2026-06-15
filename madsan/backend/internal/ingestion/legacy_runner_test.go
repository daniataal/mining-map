package ingestion

import (
	"encoding/json"
	"testing"
)

func TestParseLegacyImportOpts(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"tables":   []string{"oil_vessels", "licenses"},
		"max_rows": 1000,
		"dry_run":  true,
	})
	opts := parseLegacyImportOpts(payload)
	if len(opts.Tables) != 2 || opts.MaxRows != 1000 || !opts.DryRun {
		t.Fatalf("unexpected opts: %+v", opts)
	}
}

func TestParseLegacyStatsLine(t *testing.T) {
	out := "oil_vessels: 100 enqueued\n{\"oil_vessels\": 9595, \"licenses\": 42}\n"
	stats := parseLegacyStatsLine(out)
	if stats == nil || stats["oil_vessels"] == nil {
		t.Fatal("expected stats json")
	}
}
