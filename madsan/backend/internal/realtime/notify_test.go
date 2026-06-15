package realtime

import (
	"testing"
	"time"
)

func TestPositionIsLive(t *testing.T) {
	now := time.Now()
	if !PositionIsLive(now.Add(-6 * time.Hour)) {
		t.Fatal("expected 6h fix to be live")
	}
	if PositionIsLive(now.Add(-13 * time.Hour)) {
		t.Fatal("expected 13h fix to be stale")
	}
}
