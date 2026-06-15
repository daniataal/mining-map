package maritime

import (
	"testing"
	"time"
)

func TestInitialAISSinceDefaultLookback(t *testing.T) {
	now := time.Date(2026, 6, 9, 12, 0, 0, 0, time.UTC)
	got := initialAISSince(now, 0)
	want := now.Add(-168 * time.Hour)
	if !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestInitialAISSinceCustomLookback(t *testing.T) {
	now := time.Date(2026, 6, 9, 12, 0, 0, 0, time.UTC)
	got := initialAISSince(now, 48*time.Hour)
	want := now.Add(-48 * time.Hour)
	if !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestInBBox(t *testing.T) {
	bbox := [4]float64{50, 20, 60, 30}
	if !InBBox(25, 55, bbox) {
		t.Fatal("expected inside")
	}
	if InBBox(10, 55, bbox) {
		t.Fatal("expected outside south")
	}
	if InBBox(25, 70, bbox) {
		t.Fatal("expected outside east")
	}
}
