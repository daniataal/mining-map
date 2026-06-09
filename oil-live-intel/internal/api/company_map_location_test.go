package api

import "testing"

func TestCompanyMapLocationSource(t *testing.T) {
	tests := []struct {
		termLat *float64
		mcrLat  *float64
		want    string
	}{
		{termLat: ptrFloat(25.1), mcrLat: ptrFloat(30.0), want: "terminal"},
		{termLat: nil, mcrLat: ptrFloat(30.0), want: "corridor"},
		{termLat: nil, mcrLat: nil, want: ""},
	}
	for _, tc := range tests {
		got := companyMapLocationSource(tc.termLat, tc.mcrLat)
		if got != tc.want {
			t.Fatalf("companyMapLocationSource(%v, %v) = %q, want %q", tc.termLat, tc.mcrLat, got, tc.want)
		}
	}
}

func ptrFloat(v float64) *float64 { return &v }
