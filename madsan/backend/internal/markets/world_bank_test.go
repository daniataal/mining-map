package markets

import (
	"bytes"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func TestParseWorldBankMonthlyPrices(t *testing.T) {
	buf := &bytes.Buffer{}
	f := excelize.NewFile()
	idx, err := f.NewSheet("Monthly Prices")
	if err != nil {
		t.Fatal(err)
	}
	f.SetActiveSheet(idx)
	rows := [][]any{
		{"World Bank Commodity Price Data (The Pink Sheet)"},
		{"monthly prices in nominal US dollars, 1960 to present"},
		{"(monthly series are available only in nominal US dollars)"},
		{"Updated on June 02, 2026"},
		{"", "Crude oil, average", "Crude oil, Brent", "Crude oil, WTI", "Natural gas, US", "Natural gas, Europe", "Liquefied natural gas, Japan", "Gold"},
		{"", "($/bbl)", "($/bbl)", "($/bbl)", "($/mmbtu)", "($/mmbtu)", "($/mmbtu)", "($/troy oz)"},
		{"2026M04", "98.1", "104.2", "96.9", "2.75", "14.10", "15.33", "3200"},
		{"2026M05", "100.43", "107.54", "99.09", "2.93", "16.17", "15.77", "3482.30"},
	}
	for r, row := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, r+1)
		if err := f.SetSheetRow("Monthly Prices", cell, &row); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.WriteTo(buf); err != nil {
		t.Fatal(err)
	}

	obs, meta, err := ParseWorldBankMonthlyPrices(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if meta.UpdatedLabel != "Updated on June 02, 2026" {
		t.Fatalf("updated label = %q", meta.UpdatedLabel)
	}
	if !meta.ReleaseDate.Equal(time.Date(2026, 6, 2, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("release date = %s", meta.ReleaseDate)
	}
	if len(obs) != 12 {
		t.Fatalf("observations = %d, want 12", len(obs))
	}
	var brent WorldBankPriceObservation
	for _, o := range obs {
		if o.BenchmarkKey == "BRENT" && o.ObservedAt.Equal(time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)) {
			brent = o
			break
		}
	}
	if brent.Price != 107.54 || brent.Unit != "/bbl" || brent.ProductCode != "CRUDEOIL" {
		t.Fatalf("brent observation = %+v", brent)
	}
}

func TestWorldBankMonthAndMissingValues(t *testing.T) {
	month, err := parseWorldBankMonth("2026M05")
	if err != nil {
		t.Fatal(err)
	}
	if month.Format("2006-01-02") != "2026-05-01" {
		t.Fatalf("month = %s", month)
	}
	for _, raw := range []string{"", "…", "...", "na"} {
		if _, ok := parseWorldBankPrice(raw); ok {
			t.Fatalf("missing value %q parsed as price", raw)
		}
	}
	if got := normalizeWorldBankUnit("($/mmbtu)"); got != "/mmbtu" {
		t.Fatalf("unit = %q", got)
	}
}
