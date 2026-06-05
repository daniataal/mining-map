package gfw

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMapPresenceRow(t *testing.T) {
	row := map[string]any{
		"mmsi":  "538010123",
		"lat":   25.05,
		"lon":   56.5,
		"date":  "2026-05-01T14:00:00Z",
		"speed": 0.8,
	}
	pt, ok := mapPresenceRow(row, "fujairah")
	if !ok {
		t.Fatal("expected row to map")
	}
	if pt.MMSI != 538010123 {
		t.Fatalf("mmsi %d", pt.MMSI)
	}
	if pt.DataSource != "gfw" {
		t.Fatalf("data_source %s", pt.DataSource)
	}
	if pt.SourceRecordID != "gfw:fujairah:538010123:2026-05-01T14" {
		t.Fatalf("source_record_id %s", pt.SourceRecordID)
	}
	if pt.SOG == nil || *pt.SOG != 0.8 {
		t.Fatalf("sog %#v", pt.SOG)
	}
}

func TestParsePresenceReport(t *testing.T) {
	body := []byte(`{
		"entries": [{
			"public-global-presence:v3.0": [
				{"mmsi":"123456789","lat":1.2,"lon":103.8,"date":"2026-05-02T10:00:00Z","hours":1}
			]
		}]
	}`)
	pts, err := parsePresenceReport(body, "singapore_strait")
	if err != nil {
		t.Fatal(err)
	}
	if len(pts) != 1 || pts[0].MMSI != 123456789 {
		t.Fatalf("pts %#v", pts)
	}
}

func TestFetchBBoxTrackPoints_mockHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("auth %q", r.Header.Get("Authorization"))
		}
		if !strings.Contains(r.URL.Path, "/v3/4wings/report") {
			t.Fatalf("path %s", r.URL.Path)
		}
		if r.URL.Query().Get("group-by") != "MMSI" {
			t.Fatalf("group-by %q", r.URL.Query().Get("group-by"))
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["geojson"] == nil {
			t.Fatal("expected geojson body")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"entries": []map[string]any{{
				"public-global-presence:v3.0": []map[string]any{{
					"mmsi": "999000111",
					"lat":  25.0,
					"lon":  56.4,
					"date": "2026-05-01T08:00:00Z",
				}},
			}},
		})
	}))
	defer srv.Close()

	c := New("test-key")
	c.BaseURL = srv.URL
	from := time.Date(2026, 4, 28, 0, 0, 0, 0, time.UTC)
	to := from.Add(3 * 24 * time.Hour)
	pts, err := c.FetchBBoxTrackPoints(context.Background(), DefaultArchiveRegions()[0], from, to, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(pts) != 1 || pts[0].MMSI != 999000111 {
		t.Fatalf("pts %#v", pts)
	}
}

func TestFetchBBoxTrackPoints_notConfigured(t *testing.T) {
	c := New("")
	_, err := c.FetchBBoxTrackPoints(context.Background(), DefaultArchiveRegions()[0], time.Now().Add(-24*time.Hour), time.Now(), 0)
	if err != ErrNotConfigured {
		t.Fatalf("err %v", err)
	}
}

func TestDefaultArchiveRegions_matchSTSZones(t *testing.T) {
	regions := DefaultArchiveRegions()
	if len(regions) != 3 {
		t.Fatalf("regions %d", len(regions))
	}
	if regions[0].Name != "fujairah" {
		t.Fatalf("first region %s", regions[0].Name)
	}
}
