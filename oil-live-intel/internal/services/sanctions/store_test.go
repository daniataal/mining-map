package sanctions

import (
	"testing"

	"github.com/mining-map/oil-live-intel/internal/services/countrymatch"
)

func TestCountryFilterUsesAliasMatching(t *testing.T) {
	rows := []CountrySummary{
		{CountryName: "Russia", Coverage: CoverageScreened, FlagLevel: FlagFlagged},
		{CountryName: "Brazil", Coverage: CoverageScreened, FlagLevel: FlagClear},
	}
	var matched []CountrySummary
	for _, row := range rows {
		if countrymatch.KeysMatch(row.CountryName, "Russian Federation") {
			matched = append(matched, row)
		}
	}
	if len(matched) != 1 || matched[0].CountryName != "Russia" {
		t.Fatalf("expected Russia row, got %v", matched)
	}
}

func TestNoDataCoverageShape(t *testing.T) {
	row := CountrySummary{
		CountryName: "Narnia",
		Coverage:    CoverageNoData,
		SourceTier:  SourceTier,
	}
	if row.FlagLevel != "" {
		t.Fatalf("no_data row should omit flag_level, got %q", row.FlagLevel)
	}
	if row.Coverage != CoverageNoData {
		t.Fatalf("coverage=%q", row.Coverage)
	}
}
