// ais-tanker-probe connects to AISStream, filters tankers, and prints a summary.
// Usage: AISSTREAM_API_KEY=... go run ./cmd/ais-tanker-probe [-duration 30s]
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/madsan/intelligence/internal/maritime/ais"
)

type vesselSnap struct {
	Name          string
	MMSI          int64
	ShipTypeCode  int
	ShipTypeLabel string
	TankerClass   string
	Lat           float64
	Lon           float64
	Speed         float64
	Destination   string
	LastSeen      time.Time
}

func main() {
	duration := flag.Duration("duration", 30*time.Second, "how long to listen before printing summary")
	flag.Parse()

	apiKey := strings.TrimSpace(os.Getenv("AISSTREAM_API_KEY"))
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "AISSTREAM_API_KEY is required (free key: https://aisstream.io/)")
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	ctx, timeout := context.WithTimeout(ctx, *duration)
	defer timeout()

	// Global envelope — same pattern as ingestor terminal envelope fallback.
	boxes := []ais.BoundingBox{{{-90, -180}, {90, 180}}}

	var (
		mu       sync.Mutex
		tankers  = map[int64]vesselSnap{}
		frames   int
		skipped  int
	)

	fmt.Fprintf(os.Stderr, "listening for tankers on AISStream (%s)…\n", *duration)

	handler := func(ctx context.Context, u *ais.Update) error {
		frames++
		if !ais.IsRelevantVessel(u.ShipTypeCode, u.ShipTypeLabel, u.Name, false) {
			skipped++
			return nil
		}
		tclass := ais.TankerClass(u.ShipTypeCode, u.ShipTypeLabel, u.Name)
		mu.Lock()
		tankers[u.MMSI] = vesselSnap{
			Name:          u.Name,
			MMSI:          u.MMSI,
			ShipTypeCode:  u.ShipTypeCode,
			ShipTypeLabel: u.ShipTypeLabel,
			TankerClass:   tclass,
			Lat:           u.Lat,
			Lon:           u.Lon,
			Speed:         u.Speed,
			Destination:   u.Destination,
			LastSeen:      u.Timestamp,
		}
		mu.Unlock()
		fmt.Printf("tanker mmsi=%d name=%q class=%s type=%d %s pos=%.4f,%.4f sog=%.1f dest=%q\n",
			u.MMSI, u.Name, tclass, u.ShipTypeCode, u.ShipTypeLabel, u.Lat, u.Lon, u.Speed, u.Destination)
		return nil
	}

	insecure := os.Getenv("MARITIME_SSL_AUTO_FALLBACK") == "1"
	autoFallback := os.Getenv("MARITIME_SSL_AUTO_FALLBACK") != "0"
	err := ais.RunStreamWithTLSFallback(ctx, ais.Subscription{
		APIKey:        apiKey,
		BoundingBoxes: boxes,
	}, handler, insecure, autoFallback)
	if err != nil && ctx.Err() == nil {
		fmt.Fprintf(os.Stderr, "stream error: %v\n", err)
		os.Exit(1)
	}

	mu.Lock()
	defer mu.Unlock()

	mmsis := make([]int64, 0, len(tankers))
	for m := range tankers {
		mmsis = append(mmsis, m)
	}
	sort.Slice(mmsis, func(i, j int) bool { return mmsis[i] < mmsis[j] })

	fmt.Fprintf(os.Stderr, "\n--- summary ---\n")
	fmt.Fprintf(os.Stderr, "frames=%d skipped_non_tanker=%d unique_tankers=%d\n", frames, skipped, len(tankers))
	for _, m := range mmsis {
		v := tankers[m]
		fmt.Printf("summary mmsi=%d name=%q class=%s type=%d %s pos=%.4f,%.4f\n",
			v.MMSI, v.Name, v.TankerClass, v.ShipTypeCode, v.ShipTypeLabel, v.Lat, v.Lon)
	}
}
