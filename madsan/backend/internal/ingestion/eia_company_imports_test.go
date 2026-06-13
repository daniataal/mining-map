package ingestion

import (
	"bytes"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func TestParseEIACompanyImportWorkbook(t *testing.T) {
	buf := &bytes.Buffer{}
	f := excelize.NewFile()
	idx, err := f.NewSheet("IMPORTS")
	if err != nil {
		t.Fatal(err)
	}
	f.SetActiveSheet(idx)
	rows := [][]any{
		{"RPT_PERIOD", "R_S_NAME", "LINE_NUM", "PROD_CODE", "PROD_NAME", "PORT_CODE", "PORT_CITY", "PORT_STATE", "PORT_PADD", "GCTRY_CODE", "CNTRY_NAME", "QUANTITY", "SULFUR", "APIGRAVITY", "PCOMP_RNAM", "PCOMP_SITEID", "PCOMP_SNAM", "PCOMP_STAT", "STATE_NAME", "PCOMP_PADD"},
		{"Mar-26", "Example Refining LLC", "1", "025", "Crude Oil", "5301", "Houston, TX", "TEXAS", "3", "260", "CANADA", "123", "1.42", "32.6", "Example Refining LLC", "42", "Example Refinery", "TX", "TEXAS", "3"},
		{"Mar-26", "Propane Buyer Inc", "2", "251", "Propane/Ngl", "3004", "BLAINE, WA", "WASHINGTON", "5", "910", "UNITED ARAB EMIRATES", "7", "0", "0"},
	}
	for r, row := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, r+1)
		if err := f.SetSheetRow("IMPORTS", cell, &row); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.WriteTo(buf); err != nil {
		t.Fatal(err)
	}

	records, err := parseEIACompanyImportWorkbook(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 {
		t.Fatalf("records = %d, want 2", len(records))
	}
	crude := records[0]
	if !crude.Month.Equal(time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("month = %s", crude.Month)
	}
	if crude.ImporterName != "Example Refining LLC" || crude.ProductFamily != "CRUDEOIL" || crude.OriginISO != "CA" {
		t.Fatalf("crude record = %+v", crude)
	}
	if crude.Quantity != 123 || crude.Sulfur == nil || *crude.Sulfur != 1.42 || crude.APIGravity == nil || *crude.APIGravity != 32.6 {
		t.Fatalf("quantity/quality = %+v", crude)
	}
	lpg := records[1]
	if lpg.ProductFamily != "LPG" || lpg.OriginISO != "AE" || lpg.Sulfur != nil || lpg.APIGravity != nil {
		t.Fatalf("lpg record = %+v", lpg)
	}
}

func TestParseEIACompanyImportLinks(t *testing.T) {
	html := `
		<a href="/petroleum/imports/companylevel/archive/2026/2026_03/data/import.xlsx">March</a>
		<a href="/petroleum/imports/companylevel/archive/2026/2026_02/data/import.xlsx">February</a>
		<a href="/petroleum/imports/companylevel/archive/2015/data/impa15d.xls">2015</a>`
	links, err := parseEIACompanyImportLinks(eiaCompanyImportsIndexURL, html, 2)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"https://www.eia.gov/petroleum/imports/companylevel/archive/2026/2026_03/data/import.xlsx",
		"https://www.eia.gov/petroleum/imports/companylevel/archive/2026/2026_02/data/import.xlsx",
	}
	if len(links) != len(want) {
		t.Fatalf("links = %#v, want %#v", links, want)
	}
	for i := range want {
		if links[i] != want[i] {
			t.Fatalf("link[%d] = %q, want %q", i, links[i], want[i])
		}
	}
}
