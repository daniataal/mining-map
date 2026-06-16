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

func TestOnViewportSubBootstrapsOnce(t *testing.T) {
	h := NewHub(zerolog.Nop())
	c := &client{send: make(chan wsFrame, 4), useMsgpack: false}

	h.onViewportSub(c, ViewportSub{BBox: [4]float64{0, 0, 1, 1}})
	if !c.snapshotReady {
		t.Fatal("expected snapshot bootstrapped on first sub")
	}

	h.onViewportSub(c, ViewportSub{BBox: [4]float64{1, 1, 2, 2}})
	c.mu.Lock()
	hasTimer := c.viewportSnapTimer != nil
	c.mu.Unlock()
	if !hasTimer {
		t.Fatal("expected debounced viewport snapshot timer on subsequent sub")
	}
	c.stopViewportSnapTimer()
}
