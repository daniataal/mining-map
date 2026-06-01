package portcall

import "testing"

func TestClassifyEvent(t *testing.T) {
	tests := []struct {
		in, out float64
		has     bool
		want    string
	}{
		{8, 15, true, EventPossibleLoading},
		{15, 8, true, EventPossibleUnloading},
		{10, 10.5, true, EventTerminalUnknown},
		{0, 0, false, EventTerminalUnknown},
	}
	for _, tc := range tests {
		if got := ClassifyEvent(tc.in, tc.out, tc.has); got != tc.want {
			t.Fatalf("ClassifyEvent(%v,%v,%v)=%q want %q", tc.in, tc.out, tc.has, got, tc.want)
		}
	}
}
