package procurement

import (
	"testing"

	"github.com/madsan/intelligence/internal/sources"
)

func TestEUNoticeRecordShape(t *testing.T) {
	title := "Fuel supply contract"
	buyer := "Ministry of Energy"
	country := "DE"
	cpv := "09100000"
	noticeID := "12345-2024"
	rec := sources.Record{
		EntityType:  "company",
		Name:        buyer,
		CountryCode: country,
		SourceSlug:  slug,
		ExternalID:  noticeID,
		Commodities: []string{"procurement_lead"},
		RawPayload: map[string]any{
			"lead_type":     "eu_procurement_notice",
			"notice_id":     noticeID,
			"title":         title,
			"buyer":         buyer,
			"cpv":           cpv,
			"register_tier": "official_register",
		},
	}
	if rec.Name != buyer || rec.ExternalID != noticeID {
		t.Fatalf("unexpected record shape: %+v", rec)
	}
}

func TestStrPtr(t *testing.T) {
	s := " hello "
	if got := strPtr(&s); got != "hello" {
		t.Fatalf("strPtr = %q", got)
	}
	if got := strPtr(nil); got != "" {
		t.Fatalf("nil strPtr = %q", got)
	}
}
