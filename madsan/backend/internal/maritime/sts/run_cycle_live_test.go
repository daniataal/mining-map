//go:build integration

package sts

import (
	"context"
	"os"
	"testing"

	"github.com/madsan/intelligence/internal/database"
)

func TestRunCycleStepsLive(t *testing.T) {
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
	if len(candidates) == 0 {
		t.Skip("no candidates in 6h window")
	}
	c := candidates[0]
	t.Logf("candidate %s/%s", c.MMSIA, c.MMSIB)

	if _, err := loadVesselMeta(ctx, pool, c.MMSIA); err != nil {
		t.Fatalf("loadVesselMeta A: %v", err)
	}
	if _, err := loadVesselMeta(ctx, pool, c.MMSIB); err != nil {
		t.Fatalf("loadVesselMeta B: %v", err)
	}
	if _, _, _, err := matchSTSZone(ctx, pool, c.CentroidLat, c.CentroidLon); err != nil {
		t.Fatalf("matchSTSZone: %v", err)
	}

	metaA, err := loadVesselMeta(ctx, pool, c.MMSIA)
	if err != nil {
		t.Fatalf("reload metaA: %v", err)
	}
	metaB, err := loadVesselMeta(ctx, pool, c.MMSIB)
	if err != nil {
		t.Fatalf("reload metaB: %v", err)
	}
	zoneID, zoneName, inZone, err := matchSTSZone(ctx, pool, c.CentroidLat, c.CentroidLon)
	if err != nil {
		t.Fatalf("matchSTSZone reload: %v", err)
	}
	bothTankers := isTanker(metaA.TankerClass) && isTanker(metaB.TankerClass)
	if err := persistSTSSignal(ctx, pool, c, metaA, metaB, zoneID, zoneName, inZone, bothTankers); err != nil {
		t.Fatalf("persistSTSSignal: %v", err)
	}
}
