package ingestion

import (
	"context"
	"time"
)

const (
	matviewEnergy = "map_energy_assets"
	matviewMetals = "map_metals_assets"
	matviewVessel = "map_vessels"

	// Throttle targeted refresh during long legacy imports (avoid per-batch full refresh).
	legacyMatviewRefreshRows        = 5000
	legacyMatviewRefreshMinInterval = 90 * time.Second
)

// matviewRefreshThrottle gates incremental matview refresh during bulk imports.
type matviewRefreshThrottle struct {
	lastAt    time.Time
	rowsSince int
}

func (t *matviewRefreshThrottle) addRows(n int) {
	if n > 0 {
		t.rowsSince += n
	}
}

func shouldRefreshServingMatview(rowsSince int, lastAt time.Time, now time.Time) bool {
	if rowsSince == 0 {
		return false
	}
	if rowsSince >= legacyMatviewRefreshRows {
		return true
	}
	if !lastAt.IsZero() && now.Sub(lastAt) >= legacyMatviewRefreshMinInterval {
		return true
	}
	return false
}

func (t *matviewRefreshThrottle) shouldRefresh(now time.Time) bool {
	return shouldRefreshServingMatview(t.rowsSince, t.lastAt, now)
}

func (t *matviewRefreshThrottle) markRefreshed(now time.Time) {
	t.lastAt = now
	t.rowsSince = 0
}

// matviewsForJobType returns serving matviews for ingestion job types that do not
// carry row-level entity hints (e.g. scheduled AIS refresh).
func matviewsForJobType(jobType string) []string {
	switch jobType {
	case "ais":
		return []string{matviewVessel}
	case "bunker_seed":
		return nil
	case "legacy_import":
		return allServingMatviews()
	default:
		return nil
	}
}

func allServingMatviews() []string {
	return []string{matviewEnergy, matviewMetals, matviewVessel}
}

func matviewsForLegacyTableNames(names []string) []string {
	if len(names) == 0 {
		return allServingMatviews()
	}
	return uniqueMatviews(collectMatviews(names, legacyTableMatview))
}

func legacyTableMatview(table string) string {
	switch table {
	case "oil_vessels":
		return matviewVessel
	case "licenses":
		return matviewMetals
	case "petroleum_osm_features":
		return matviewEnergy
	default:
		return ""
	}
}

func matviewsForRecords(records []NormalizedRecord) []string {
	var names []string
	for _, rec := range records {
		switch rec.EntityType {
		case "vessel":
			names = append(names, matviewVessel)
		case "asset":
			names = append(names, matviewsForAssetType(rec.AssetType)...)
		}
	}
	return uniqueMatviews(names)
}

func matviewsForAssetType(assetType string) []string {
	switch assetType {
	case "mine", "smelter", "processing_plant":
		return []string{matviewMetals}
	case "refinery", "port":
		return []string{matviewEnergy, matviewMetals}
	default:
		return []string{matviewEnergy}
	}
}

func servingMatviewsForJob(jobType string, records []NormalizedRecord) []string {
	if fromRecords := matviewsForRecords(records); len(fromRecords) > 0 {
		return fromRecords
	}
	return matviewsForJobType(jobType)
}

func collectMatviews(items []string, mapFn func(string) string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if v := mapFn(item); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func uniqueMatviews(views []string) []string {
	if len(views) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(views))
	out := make([]string, 0, len(views))
	for _, v := range views {
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func (s *Service) refreshServingMatviews(ctx context.Context, views []string) error {
	if len(views) == 0 {
		return nil
	}
	var firstErr error
	for _, view := range views {
		if err := s.refreshOneMatview(ctx, view); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (s *Service) refreshOneMatview(ctx context.Context, view string) error {
	// All serving matviews have a unique index on id (required for CONCURRENTLY).
	_, err := s.pool.Exec(ctx, `REFRESH MATERIALIZED VIEW CONCURRENTLY `+view)
	if err != nil {
		_, err = s.pool.Exec(ctx, `REFRESH MATERIALIZED VIEW `+view)
	}
	return err
}
