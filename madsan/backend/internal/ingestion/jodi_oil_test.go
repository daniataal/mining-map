package ingestion

import (
	"encoding/csv"
	"strings"
	"testing"
)

func TestParseJODIRowNumeric(t *testing.T) {
	header := headerIndex([]string{"REF_AREA", "TIME_PERIOD", "ENERGY_PRODUCT", "FLOW_BREAKDOWN", "UNIT_MEASURE", "OBS_VALUE", "ASSESSMENT_CODE"})
	row, ok := parseJODIRow([]string{"AE", "2026-01", "CRUDEOIL", "TOTIMPSB", "KBD", "123.4500", "3"}, header, "primaryyear2026.csv")
	if !ok {
		t.Fatal("expected numeric row")
	}
	if row[0] != "AE" || row[2] != "CRUDEOIL" || row[3] != "TOTIMPSB" || row[4] != "KBD" {
		t.Fatalf("unexpected row: %#v", row)
	}
	if got := row[5].(float64); got != 123.45 {
		t.Fatalf("value=%v", got)
	}
}

func TestParseJODIRowSkipsUnavailableValues(t *testing.T) {
	header := headerIndex([]string{"REF_AREA", "TIME_PERIOD", "ENERGY_PRODUCT", "FLOW_BREAKDOWN", "UNIT_MEASURE", "OBS_VALUE"})
	if _, ok := parseJODIRow([]string{"AE", "2026-01", "CRUDEOIL", "CLOSTLV", "KBD", "x"}, header, "file.csv"); ok {
		t.Fatal("expected x value to be skipped")
	}
	if _, ok := parseJODIRow([]string{"AE", "2026-01", "CRUDEOIL", "CLOSTLV", "KBBL", "-"}, header, "file.csv"); ok {
		t.Fatal("expected dash value to be skipped")
	}
}

func TestJODICopySourceStats(t *testing.T) {
	r := csv.NewReader(strings.NewReader(`REF_AREA,TIME_PERIOD,ENERGY_PRODUCT,FLOW_BREAKDOWN,UNIT_MEASURE,OBS_VALUE,ASSESSMENT_CODE
AE,2026-01,CRUDEOIL,TOTIMPSB,KBD,100,3
AE,2026-01,CRUDEOIL,TOTIMPSB,KBBL,x,3
AE,2026-02,GASDIES,TOTDEMO,KBD,200,2
`))
	header, err := r.Read()
	if err != nil {
		t.Fatal(err)
	}
	stats := &jodiFileStats{Products: map[string]bool{}, Flows: map[string]bool{}, Units: map[string]bool{}}
	src := &jodiCopySource{reader: r, columns: headerIndex(header), file: "fixture.csv", stats: stats}
	count := 0
	for src.Next() {
		count++
		if _, err := src.Values(); err != nil {
			t.Fatal(err)
		}
	}
	if err := src.Err(); err != nil {
		t.Fatal(err)
	}
	if count != 2 || stats.RowsRead != 3 || stats.NumericRows != 2 || stats.RowsSkipped != 1 {
		t.Fatalf("count=%d stats=%+v", count, stats)
	}
	if !stats.Products["CRUDEOIL"] || !stats.Products["GASDIES"] || !stats.Flows["TOTIMPSB"] || !stats.Units["KBD"] {
		t.Fatalf("missing stats maps: %+v", stats)
	}
}
