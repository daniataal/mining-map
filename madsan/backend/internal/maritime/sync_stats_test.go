package maritime

import (
	"errors"
	"testing"
	"time"
)

func TestSyncStatsRecordAndSnapshot(t *testing.T) {
	stats := NewSyncStats(true, 30*time.Second, true)
	stats.RecordSuccess(12)
	snap := stats.Snapshot()
	if snap["last_batch_updated"] != 12 {
		t.Fatalf("expected batch 12, got %v", snap["last_batch_updated"])
	}
	if snap["last_sync_at"] == nil {
		t.Fatal("expected last_sync_at after success")
	}

	stats.RecordError(errors.New("legacy timeout"))
	snap = stats.Snapshot()
	if snap["last_error"] != "legacy timeout" {
		t.Fatalf("expected error message, got %v", snap["last_error"])
	}
}
