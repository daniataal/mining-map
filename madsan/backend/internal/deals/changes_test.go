package deals

import "testing"

func TestChangesScaffold(t *testing.T) {
	out := ChangesScaffold("abc-123")
	if out["tier"] != ChangesTierNotImplemented {
		t.Fatalf("tier = %v, want %q", out["tier"], ChangesTierNotImplemented)
	}
	changes, ok := out["changes"].([]any)
	if !ok || len(changes) != 0 {
		t.Fatalf("changes = %v, want empty slice", out["changes"])
	}
	if out["deal_id"] != "abc-123" {
		t.Fatalf("deal_id = %v", out["deal_id"])
	}
}
