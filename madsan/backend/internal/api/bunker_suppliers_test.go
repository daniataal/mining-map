package api

import "testing"

func TestBunkerProductsDedupeAndFallback(t *testing.T) {
	got := bunkerProducts([]string{"VLSFO", "vlsfo"}, "Marine gas oil; Compliant marine fuels")
	want := []string{"VLSFO", "Marine gas oil", "Compliant marine fuels"}
	if len(got) != len(want) {
		t.Fatalf("products=%v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("products=%v want %v", got, want)
		}
	}
}

func TestJSONBlockFallback(t *testing.T) {
	if string(jsonBlock(`{"ok":true}`, "{}")) != `{"ok":true}` {
		t.Fatal("expected valid json to pass through")
	}
	if string(jsonBlock(`not json`, "{}")) != `{}` {
		t.Fatal("expected invalid json to use fallback")
	}
}
