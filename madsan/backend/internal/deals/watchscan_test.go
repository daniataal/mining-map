package deals

import (
	"context"
	"testing"
	"time"
)

func TestComputeChangeItemsCount(t *testing.T) {
	now := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	snap := watchSnapshot{
		Commodity:    "Brent crude",
		QuantityUnit: "bbl",
		Price:        80,
		Benchmark:    &snapshotBenchmark{Symbol: "BRENT", Price: 80, Tier: "reference_stub"},
	}
	svc := &Service{eiaKey: ""}
	items := svc.computeChangeItems(context.Background(), snap, now)
	if len(items) != 3 {
		t.Fatalf("expected 3 change detectors, got %d", len(items))
	}
}

func TestScanReportString(t *testing.T) {
	s := scanReportString(ScanReport{Subscriptions: 2, EventsInserted: 5})
	if s == "" {
		t.Fatal("expected non-empty report string")
	}
}
