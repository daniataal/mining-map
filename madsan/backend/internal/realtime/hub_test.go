package realtime

import (
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/maritime"
)

func TestDeltasStalled(t *testing.T) {
	h := NewHub(zerolog.Nop())

	if !h.deltasStalled() {
		t.Fatal("expected stalled before any delta")
	}

	h.PublishVesselDelta(maritime.VesselDelta{MMSI: "123456789", Lat: 25, Lon: 55})
	if h.deltasStalled() {
		t.Fatal("expected flowing immediately after delta")
	}

	h.deltaMu.Lock()
	h.lastDeltaAt = time.Now().Add(-snapshotFallbackAfter - time.Second)
	h.deltaMu.Unlock()
	if !h.deltasStalled() {
		t.Fatal("expected stalled after fallback window")
	}
}
