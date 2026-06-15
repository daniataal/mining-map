//go:build integration

package sts

import (
	"context"
	"os"
	"testing"

	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/maritime/geofence"
)

func TestDetectQueryLive(t *testing.T) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	cfg := DefaultDetectConfig(24)
	candidates, err := Detect(ctx, pool, cfg)
	if err != nil {
		t.Fatalf("Detect: %v", err)
	}
	t.Logf("candidates: %d", len(candidates))

	index, err := geofence.Load(ctx, pool, 1200)
	if err != nil {
		t.Fatalf("geofence.Load: %v", err)
	}
	written, err := RunCycle(ctx, pool, index, 24)
	if err != nil {
		t.Fatalf("RunCycle: %v", err)
	}
	t.Logf("events_written: %d", written)
}
