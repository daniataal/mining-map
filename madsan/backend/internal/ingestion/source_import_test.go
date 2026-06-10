package ingestion

import "testing"

func TestSourceImportSlugs(t *testing.T) {
	for _, slug := range []string{"gleif", "sec_edgar", "legacy_procurement"} {
		if !SourceImportSlugs[slug] {
			t.Fatalf("missing slug %s", slug)
		}
	}
	if isSourceImportJob("gleif") != true {
		t.Fatal("gleif should be source import job")
	}
	if isSourceImportJob("watch_folder") {
		t.Fatal("watch_folder is not source import")
	}
}

func TestRegistrationFromRecord(t *testing.T) {
	rec := NormalizedRecord{RawPayload: map[string]any{"lei": "549300ABC"}}
	if got := registrationFromRecord(rec); got != "549300ABC" {
		t.Fatalf("lei = %q", got)
	}
	rec.RawPayload = map[string]any{"cik": "0000123456"}
	if got := registrationFromRecord(rec); got != "0000123456" {
		t.Fatalf("cik = %q", got)
	}
}

func TestSourceImportConfidence(t *testing.T) {
	rec := NormalizedRecord{RawPayload: map[string]any{"confidence_score": 78.0}}
	if got := sourceImportConfidence(rec); got != 78.0 {
		t.Fatalf("score = %v", got)
	}
}
