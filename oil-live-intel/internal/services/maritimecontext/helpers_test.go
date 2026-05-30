package maritimecontext

import (
	"strings"
	"testing"
)

func TestParseUNLOCODECoordinates(t *testing.T) {
	lat, lng, ok := parseUNLOCODECoordinates("4230N 00131E")
	if !ok {
		t.Fatal("expected parse ok")
	}
	if lat < 42.49 || lat > 42.51 {
		t.Fatalf("unexpected lat %v", lat)
	}
	if lng < 1.5 || lng > 1.53 {
		t.Fatalf("unexpected lng %v", lng)
	}
}

func TestClassifyEvidenceType(t *testing.T) {
	if classifyEvidenceType("Major buyer signs offtake deal") != "counterparty_signal" {
		t.Fatal("expected counterparty_signal")
	}
	if classifyEvidenceType("Tanker loading at Fujairah") != "shipment_signal" {
		t.Fatal("expected shipment_signal")
	}
}

func TestBuildGDELTQueryRequiresAnchor(t *testing.T) {
	if buildGDELTQuery("", "", "diesel", "") != "" {
		t.Fatal("expected empty query without anchor")
	}
	q := buildGDELTQuery("Acme Trading", "UAE", "diesel", "")
	if q == "" || !strings.Contains(q, "Acme") {
		t.Fatalf("unexpected query: %s", q)
	}
}

func TestHaversineKM(t *testing.T) {
	d := HaversineKM(51.5, -0.1, 48.8, 2.3)
	if d < 300 || d > 400 {
		t.Fatalf("unexpected distance %v", d)
	}
}
