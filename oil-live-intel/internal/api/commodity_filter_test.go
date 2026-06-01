package api

import "testing"

func TestCommodityFilterValues_crude(t *testing.T) {
	got := commodityFilterValues("crude")
	if len(got) != 2 || got[0] != "crude" || got[1] != "crude_oil" {
		t.Fatalf("got %v", got)
	}
}

func TestCommodityFilterValues_empty(t *testing.T) {
	if commodityFilterValues("") != nil {
		t.Fatal("expected nil")
	}
}
