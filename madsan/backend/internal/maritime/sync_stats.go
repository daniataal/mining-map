package maritime

import (
	"sync"
	"time"
)

// SyncStats tracks in-process AIS sync health for admin dashboards.
type SyncStats struct {
	mu sync.RWMutex

	Enabled          bool
	Mode             string // legacy | direct | disabled
	Interval         time.Duration
	LegacyConfigured bool
	StartedAt        time.Time
	LastSyncAt       time.Time
	LastBatchUpdated int
	LastError        string
}

func NewSyncStats(enabled bool, interval time.Duration, legacyConfigured bool) *SyncStats {
	mode := "disabled"
	if enabled {
		mode = "legacy"
	}
	return &SyncStats{
		Enabled:          enabled,
		Mode:             mode,
		Interval:         interval,
		LegacyConfigured: legacyConfigured,
		StartedAt:        time.Now().UTC(),
	}
}

func (s *SyncStats) SetMode(mode string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Mode = mode
	if mode == "direct" {
		s.Enabled = false
	}
}

func (s *SyncStats) RecordSuccess(updated int) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.LastSyncAt = time.Now().UTC()
	s.LastBatchUpdated = updated
	s.LastError = ""
}

func (s *SyncStats) RecordError(err error) {
	if s == nil || err == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.LastError = err.Error()
}

// Snapshot returns a JSON-friendly view of current sync stats.
func (s *SyncStats) Snapshot() map[string]any {
	if s == nil {
		return map[string]any{"enabled": false}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]any{
		"enabled":            s.Enabled,
		"mode":               s.Mode,
		"legacy_configured":  s.LegacyConfigured,
		"interval_sec":       int(s.Interval / time.Second),
		"started_at":         s.StartedAt,
		"last_sync_at":       nil,
		"last_batch_updated": s.LastBatchUpdated,
		"last_error":         nil,
	}
	if !s.LastSyncAt.IsZero() {
		out["last_sync_at"] = s.LastSyncAt
	}
	if s.LastError != "" {
		out["last_error"] = s.LastError
	}
	return out
}
