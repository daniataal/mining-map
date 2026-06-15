package sec

import "testing"

func TestNormalizeName(t *testing.T) {
	got := normalizeName("Exxon Mobil Corporation")
	want := "exxon mobil"
	if got != want {
		t.Fatalf("normalizeName = %q, want %q", got, want)
	}
}

func TestNameScore(t *testing.T) {
	a := normalizeName("Chevron Corporation")
	b := normalizeName("CHEVRON CORP")
	if score := nameScore(a, b); score < 0.72 {
		t.Fatalf("expected strong match, got %v", score)
	}
}

func TestBestTickerMatch(t *testing.T) {
	rows := []tickerRow{
		{CIK: 93410, Ticker: "CVX", Title: "CHEVRON CORP"},
		{CIK: 34088, Ticker: "XOM", Title: "EXXON MOBIL CORP"},
	}
	match := bestTickerMatch(rows, "Chevron Corp")
	if match == nil || match.Ticker != "CVX" {
		t.Fatalf("expected CVX match, got %+v", match)
	}
}

func TestEdgarBrowseURL(t *testing.T) {
	url := edgarBrowseURL("0000093410")
	if url == "" || url[len(url)-1] == ' ' {
		t.Fatalf("unexpected url %q", url)
	}
}
