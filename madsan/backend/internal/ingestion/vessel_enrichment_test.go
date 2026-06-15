package ingestion

import (
	"strings"
	"testing"

	venrich "github.com/madsan/intelligence/internal/enrichment/vessel"
)

func TestVesselEnrichmentJobUsesSharedSelectionQuery(t *testing.T) {
	q := venrich.SelectVesselsSQL(false)
	if !strings.Contains(q, "vessel_enrichment") {
		t.Fatalf("expected vessel_enrichment join in job query")
	}
	if vesselEnrichmentJobType != "vessel_enrichment" {
		t.Fatalf("job type = %q", vesselEnrichmentJobType)
	}
}
