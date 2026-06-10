package gleif

import "testing"

func makeRecord(id, legalName, country string) gleifRecord {
	var rec gleifRecord
	rec.ID = id
	rec.Attributes.Entity.LegalName.Name = legalName
	rec.Attributes.Entity.LegalAddress.Country = country
	return rec
}

func TestPickBestMatch(t *testing.T) {
	rows := []gleifRecord{
		makeRecord("LEI1", "Other Energy Ltd", "GB"),
		makeRecord("LEI2", "Vitol Holding BV", "NL"),
	}
	match := pickBestMatch(rows, "Vitol Holding")
	if match == nil || match.ID != "LEI2" {
		t.Fatalf("expected LEI2, got %+v", match)
	}
}

func TestPickBestMatchEmpty(t *testing.T) {
	if pickBestMatch(nil, "Acme") != nil {
		t.Fatal("expected nil for empty rows")
	}
}
