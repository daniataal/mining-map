package ingestion

import (
	"strings"
	"testing"
)

func TestBrokerAlphaThesisIncludesDisclaimer(t *testing.T) {
	text := BrokerAlphaThesis("CRUDEOIL", "SA", "US", 70, 40, 1, false)
	lower := strings.ToLower(text)
	if !strings.Contains(lower, "scenario intelligence") {
		t.Fatalf("missing disclaimer: %s", text)
	}
	if !strings.Contains(lower, "not stock") {
		t.Fatalf("missing stock disclaimer: %s", text)
	}
}
