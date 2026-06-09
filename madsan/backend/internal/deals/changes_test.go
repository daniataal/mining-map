package deals

import (
	"context"
	"testing"
	"time"

	"github.com/madsan/intelligence/internal/compliance"
	"github.com/madsan/intelligence/internal/markets"
)

func TestChangesScaffold(t *testing.T) {
	out := ChangesScaffold("abc-123")
	if out["tier"] != ChangeTierNotImplemented {
		t.Fatalf("tier = %v, want %q", out["tier"], ChangeTierNotImplemented)
	}
	changes, ok := out["changes"].([]any)
	if !ok || len(changes) != 0 {
		t.Fatalf("changes = %v, want empty slice", out["changes"])
	}
	if out["deal_id"] != "abc-123" {
		t.Fatalf("deal_id = %v", out["deal_id"])
	}
}

func TestAggregateChangesTier(t *testing.T) {
	if aggregateChangesTier([]ChangeItem{{Tier: ChangeTierNotImplemented}}) != ChangeTierNotImplemented {
		t.Fatal("expected not_implemented")
	}
	if aggregateChangesTier([]ChangeItem{
		{Tier: ChangeTierNotImplemented},
		{Tier: ChangeTierObserved},
	}) != ChangeTierObserved {
		t.Fatal("expected observed when any item observed")
	}
}

func TestDetectBenchmarkPriceDeltaComparable(t *testing.T) {
	now := time.Date(2026, 6, 9, 12, 0, 0, 0, time.UTC)
	snap := watchSnapshot{
		CapturedAt:   now.Format(time.RFC3339),
		Commodity:    "Brent crude",
		QuantityUnit: "bbl",
		Price:        80,
		Currency:     "USD",
		Benchmark:    &snapshotBenchmark{Symbol: "BRENT", Price: 80, Tier: "reference_stub"},
	}
	ticker := markets.NewHandler("")
	item := detectBenchmarkPriceDelta(snap, ticker, now)
	if item.Tier != ChangeTierObserved {
		t.Fatalf("tier = %q, want observed", item.Tier)
	}
	if item.DeltaPct == nil {
		t.Fatal("expected delta_pct")
	}
}

func TestDetectBenchmarkPriceDeltaIncompatibleUnit(t *testing.T) {
	now := time.Date(2026, 6, 9, 12, 0, 0, 0, time.UTC)
	snap := watchSnapshot{
		Commodity:    "VLSFO",
		QuantityUnit: "MT",
		Price:        612,
		Benchmark:    &snapshotBenchmark{Symbol: "BRENT", Price: 82, Tier: "reference_stub"},
	}
	ticker := markets.NewHandler("")
	item := detectBenchmarkPriceDelta(snap, ticker, now)
	if item.Tier != ChangeTierObserved {
		t.Fatalf("tier = %q, want observed drift", item.Tier)
	}
	if item.Message == "" || item.DeltaPct == nil {
		t.Fatalf("expected drift message and delta: %+v", item)
	}
}

func TestDetectSanctionsRescreenStub(t *testing.T) {
	now := time.Now().UTC()
	item := detectSanctionsRescreen(context.Background(), compliance.NewScreener(""), watchSnapshot{
		Sanctions: map[string]string{"seller": "clear"},
	}, now)
	if item.Tier != ChangeTierNotImplemented {
		t.Fatalf("tier = %q, want not_implemented stub", item.Tier)
	}
	if item.Type != changeTypeSanctions {
		t.Fatalf("type = %q", item.Type)
	}
}

func TestHashBytesStable(t *testing.T) {
	a := hashBytes([]byte(`{"deal_id":"x"}`))
	b := hashBytes([]byte(`{"deal_id":"x"}`))
	if a != b || len(a) != 64 {
		t.Fatalf("hash = %q", a)
	}
}

func TestPctDelta(t *testing.T) {
	d := pctDelta(100, 105)
	if d < 4.99 || d > 5.01 {
		t.Fatalf("delta = %v, want ~5", d)
	}
}
