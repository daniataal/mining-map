package vessel

import (
	"strings"
	"testing"
	"time"
)

func TestNeedsEnrichment(t *testing.T) {
	now := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	if !NeedsEnrichment(false, nil, now) {
		t.Fatal("missing row should need enrichment")
	}
	if NeedsEnrichment(true, &future, now) {
		t.Fatal("fresh row should be skipped")
	}
	if !NeedsEnrichment(true, &past, now) {
		t.Fatal("stale row should need enrichment")
	}
	if !NeedsEnrichment(true, nil, now) {
		t.Fatal("row without stale_after should need enrichment")
	}
}

func TestSelectVesselsSQLPrioritizesRecentActivity(t *testing.T) {
	q := SelectVesselsSQL(false)
	for _, frag := range []string{
		"LEFT JOIN vessel_enrichment",
		"e.mmsi IS NULL OR e.stale_after < now()",
		"ORDER BY v.last_seen_at DESC NULLS LAST",
		"LIMIT $1",
	} {
		if !strings.Contains(q, frag) {
			t.Fatalf("query missing %q:\n%s", frag, q)
		}
	}
}

func TestNotImplementedHonestTier(t *testing.T) {
	res := NotImplemented("123456789", "9876543")
	if res.Tier != "not_implemented" {
		t.Fatalf("tier = %q", res.Tier)
	}
	if res.Implemented() {
		t.Fatal("not_implemented should not report implemented")
	}
	if len(res.Limitations) == 0 {
		t.Fatal("expected limitations")
	}
}
