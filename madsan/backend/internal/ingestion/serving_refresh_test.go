package ingestion

import (
	"reflect"
	"sort"
	"testing"
)

func sortedViews(views []string) []string {
	if len(views) == 0 {
		return nil
	}
	out := append([]string(nil), views...)
	sort.Strings(out)
	return out
}

func TestMatviewsForJobType(t *testing.T) {
	tests := []struct {
		jobType string
		want    []string
	}{
		{"ais", []string{matviewVessel}},
		{"bunker_seed", nil},
		{"legacy_import", allServingMatviews()},
		{"watch_folder", nil},
	}
	for _, tc := range tests {
		got := matviewsForJobType(tc.jobType)
		if !reflect.DeepEqual(sortedViews(got), sortedViews(tc.want)) {
			t.Fatalf("jobType %q: got %v want %v", tc.jobType, got, tc.want)
		}
	}
}

func TestMatviewsForLegacyTableNames(t *testing.T) {
	tests := []struct {
		tables []string
		want   []string
	}{
		{nil, allServingMatviews()},
		{[]string{"petroleum_osm_features"}, []string{matviewEnergy}},
		{[]string{"oil_vessels"}, []string{matviewVessel}},
		{[]string{"licenses"}, []string{matviewMetals}},
		{[]string{"oil_companies"}, nil},
		{[]string{"petroleum_osm_features", "oil_vessels", "licenses"}, allServingMatviews()},
	}
	for _, tc := range tests {
		got := matviewsForLegacyTableNames(tc.tables)
		if !reflect.DeepEqual(sortedViews(got), sortedViews(tc.want)) {
			t.Fatalf("tables %v: got %v want %v", tc.tables, got, tc.want)
		}
	}
}

func TestMatviewsForRecords(t *testing.T) {
	lat, lng := 1.0, 2.0
	tests := []struct {
		name    string
		records []NormalizedRecord
		want    []string
	}{
		{
			name: "vessel only",
			records: []NormalizedRecord{
				{EntityType: "vessel", Latitude: &lat, Longitude: &lng},
			},
			want: []string{matviewVessel},
		},
		{
			name: "mine asset",
			records: []NormalizedRecord{
				{EntityType: "asset", AssetType: "mine", Latitude: &lat, Longitude: &lng},
			},
			want: []string{matviewMetals},
		},
		{
			name: "pipeline asset",
			records: []NormalizedRecord{
				{EntityType: "asset", AssetType: "pipeline", Latitude: &lat, Longitude: &lng},
			},
			want: []string{matviewEnergy},
		},
		{
			name: "company only",
			records: []NormalizedRecord{
				{EntityType: "company", Name: "Acme"},
			},
			want: nil,
		},
		{
			name: "shared port type",
			records: []NormalizedRecord{
				{EntityType: "asset", AssetType: "port", Latitude: &lat, Longitude: &lng},
			},
			want: []string{matviewEnergy, matviewMetals},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := matviewsForRecords(tc.records)
			if !reflect.DeepEqual(sortedViews(got), sortedViews(tc.want)) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestServingMatviewsForJob(t *testing.T) {
	lat, lng := 1.0, 2.0
	records := []NormalizedRecord{
		{EntityType: "company", Name: "Supplier"},
	}
	if got := servingMatviewsForJob("bunker_seed", records); len(got) != 0 {
		t.Fatalf("bunker_seed companies should skip matviews, got %v", got)
	}
	vesselRecords := []NormalizedRecord{
		{EntityType: "vessel", Latitude: &lat, Longitude: &lng},
	}
	if got := servingMatviewsForJob("watch_folder", vesselRecords); !reflect.DeepEqual(got, []string{matviewVessel}) {
		t.Fatalf("watch_folder vessel: got %v", got)
	}
}
