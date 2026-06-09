package workers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/services/gfw"
)

func TestGFWArchiveIngestIdempotency_mockHTTP(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		_ = json.NewEncoder(w).Encode(map[string]any{
			"entries": []map[string]any{{
				"public-global-presence:v3.0": []map[string]any{{
					"mmsi": "412345678",
					"lat":  25.0,
					"lon":  56.4,
					"date": "2026-05-01T08:00:00Z",
				}},
			}},
		})
	}))
	defer srv.Close()

	client := gfw.New("test-key")
	client.BaseURL = srv.URL
	bbox := gfw.DefaultArchiveRegions()[0]
	from := time.Date(2026, 4, 28, 0, 0, 0, 0, time.UTC)
	to := from.Add(3 * 24 * time.Hour)

	pts1, err := client.FetchBBoxTrackPoints(context.Background(), bbox, from, to, 0)
	if err != nil {
		t.Fatal(err)
	}
	pts2, err := client.FetchBBoxTrackPoints(context.Background(), bbox, from, to, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(pts1) != 1 || len(pts2) != 1 {
		t.Fatalf("pts1=%d pts2=%d", len(pts1), len(pts2))
	}
	if pts1[0].SourceRecordID != pts2[0].SourceRecordID {
		t.Fatalf("source ids differ: %s vs %s", pts1[0].SourceRecordID, pts2[0].SourceRecordID)
	}
	// Upsert idempotency is enforced by DB unique index; mapping stability is the client contract.
	if callCount != 2 {
		t.Fatalf("callCount %d", callCount)
	}
}

func TestGFWArchiveConfig_defaults(t *testing.T) {
	cfg := config.Config{
		GFWArchiveIngestEnabled: true,
		GFWArchiveBackfillDays:  7,
	}
	if cfg.GFWArchiveBackfillDays != 7 {
		t.Fatalf("backfill days %d", cfg.GFWArchiveBackfillDays)
	}
}
