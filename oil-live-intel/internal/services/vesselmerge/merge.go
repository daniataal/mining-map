// Package vesselmerge reads multi-source vessel position observations and merges
// them for map display without cross-source UPDATE overwrite.
//
// Ingest writers upsert only on (data_source, source_record_id). Unified reads
// pick the latest row per MMSI per data_source, then apply display precedence:
//
//	live_ais > aisstream / aisstream_snapshot > maritime_redis > inferred_port_call
//
// Demo seed port calls (seed_port_calls) are not stored here; hide them in the UI
// when OIL_LIVE_DISABLE_DEMO_SEED=1 (handled outside this package).
package vesselmerge

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mining-map/oil-live-intel/internal/services/ais"
)

const (
	tableName          = "oil_vessel_position_observations"
	defaultVesselLimit = 200
	maxVesselLimit     = 5000
)

// ClampLimit normalizes a vessel list limit to [defaultVesselLimit, maxVesselLimit].
func ClampLimit(limit int) int {
	if limit <= 0 {
		return defaultVesselLimit
	}
	if limit > maxVesselLimit {
		return maxVesselLimit
	}
	return limit
}

// ClampLimitWithMax applies ClampLimit then caps at max when max > 0.
func ClampLimitWithMax(limit, max int) int {
	c := ClampLimit(limit)
	if max > 0 && c > max {
		return max
	}
	return c
}

// VesselIdentityKey returns the dedupe key: IMO when present, else MMSI.
func VesselIdentityKey(mmsi int64, imo *string) string {
	if imo != nil {
		if trimmed := strings.TrimSpace(*imo); trimmed != "" {
			return "imo:" + trimmed
		}
	}
	return fmt.Sprintf("mmsi:%d", mmsi)
}

// SourceRank returns display precedence (lower = higher priority).
func SourceRank(dataSource string) int {
	switch strings.TrimSpace(strings.ToLower(dataSource)) {
	case "live_ais":
		return 0
	case "aisstream", "aisstream_snapshot":
		return 1
	case "aishub":
		return 1
	case "barentswatch", "denmark_ais":
		return 2
	case "maritime_redis":
		return 3
	case "inferred_port_call":
		return 4
	case "sentinel1_sar":
		return 5
	default:
		return 6
	}
}

// MergedVesselPosition is one map-facing position per MMSI after precedence merge.
type MergedVesselPosition struct {
	MMSI       int64
	DataSource string
	SourceType string
	Lat        float64
	Lng        float64
	SOG        *float64
	COG        *float64
	VesselName *string
	ObservedAt time.Time
}

// QueryOptions controls the map-facing merged read.
type QueryOptions struct {
	FreshnessMinutes    int
	Sources             []string
	PrioritizePetroleum bool // bbox queries: rank tankers/cargo before applying limit
}

// ListResult is the map-facing vessel list with cap diagnostics.
type ListResult struct {
	Vessels        []map[string]any
	TotalAvailable int
	ReturnedCount  int
	CapApplied     bool
	ShipTypeCounts map[string]int
	Limit          int
	SourceMode     string
}

// TableReady reports whether the observations table exists.
func TableReady(ctx context.Context, pool *pgxpool.Pool) bool {
	if pool == nil {
		return false
	}
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM information_schema.tables
		  WHERE table_schema = 'public' AND table_name = $1
		)`, tableName).Scan(&exists)
	return err == nil && exists
}

// HasRows reports whether any observations have been ingested.
func HasRows(ctx context.Context, pool *pgxpool.Pool) bool {
	if pool == nil || !TableReady(ctx, pool) {
		return false
	}
	var n int
	err := pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_vessel_position_observations LIMIT 1`).Scan(&n)
	return err == nil && n > 0
}

// MergedPositionsEnabled is true unless explicitly disabled. The observation
// table is now the preferred open-only AIS merge layer; oil_ais_positions is
// kept as a fallback for legacy deployments.
func MergedPositionsEnabled() bool {
	v := os.Getenv("OIL_LIVE_MERGED_VESSEL_POSITIONS")
	if v == "" {
		return true
	}
	b, err := strconv.ParseBool(v)
	return err == nil && b
}

// ListMergedVesselsInBbox returns one position per MMSI inside bbox using per-source
// latest observation and display precedence. bbox is [minLon, minLat, maxLon, maxLat].
func ListMergedVesselsInBbox(ctx context.Context, pool *pgxpool.Pool, bbox [4]float64, bboxOK bool, limit int) ([]map[string]any, error) {
	result, err := ListMergedVesselsWithMeta(ctx, pool, bbox, bboxOK, limit, QueryOptions{
		FreshnessMinutes:    1440,
		PrioritizePetroleum: bboxOK,
	})
	if err != nil {
		return nil, err
	}
	return result.Vessels, nil
}

// ListMergedVesselsWithMeta returns merged vessels plus cap / ship-type diagnostics.
func ListMergedVesselsWithMeta(ctx context.Context, pool *pgxpool.Pool, bbox [4]float64, bboxOK bool, limit int, opts QueryOptions) (ListResult, error) {
	vessels, err := listMergedVessels(ctx, pool, bbox, bboxOK, limit, opts)
	if err != nil {
		return ListResult{}, err
	}
	limit = ClampLimit(limit)
	if opts.PrioritizePetroleum && bboxOK {
		return applyPetroleumCap(vessels, limit, "multi_source_observations"), nil
	}
	total := len(vessels)
	return ListResult{
		Vessels:        vessels,
		TotalAvailable: total,
		ReturnedCount:  total,
		CapApplied:     false,
		ShipTypeCounts: countShipTypes(vessels),
		Limit:          limit,
		SourceMode:     "multi_source_observations",
	}, nil
}

// ListMergedVessels returns one position per MMSI inside bbox using per-source
// latest observation and display precedence. bbox is [minLon, minLat, maxLon, maxLat].
func ListMergedVessels(ctx context.Context, pool *pgxpool.Pool, bbox [4]float64, bboxOK bool, limit int, opts QueryOptions) ([]map[string]any, error) {
	return listMergedVessels(ctx, pool, bbox, bboxOK, limit, opts)
}

func listMergedVessels(ctx context.Context, pool *pgxpool.Pool, bbox [4]float64, bboxOK bool, limit int, opts QueryOptions) ([]map[string]any, error) {
	if pool == nil {
		return nil, fmt.Errorf("nil pool")
	}
	limit = ClampLimit(limit)
	freshnessMinutes := opts.FreshnessMinutes
	if freshnessMinutes <= 0 {
		freshnessMinutes = 1440
	}
	sqlLimit := limit
	if opts.PrioritizePetroleum && bboxOK {
		sqlLimit = maxVesselLimit
	}

	q := `
		WITH latest AS (
		  SELECT DISTINCT ON (o.mmsi, o.data_source)
		    o.mmsi,
		    COALESCE(NULLIF(o.source, ''), o.data_source) AS source,
		    o.data_source,
		    COALESCE(NULLIF(o.source_type, ''), o.data_source) AS source_type,
		    o.imo,
		    o.lat,
		    o.lng,
		    o.sog,
		    o.cog,
		    o.vessel_name,
		    COALESCE(o.position_time, o.observed_at) AS position_time,
		    COALESCE(o.received_at, o.ingested_at) AS received_at,
		    o.confidence,
		    o.source_url,
		    o.raw
		  FROM oil_vessel_position_observations o
		  WHERE COALESCE(o.position_time, o.observed_at) > now() - ($1 || ' minutes')::interval`
	args := []any{freshnessMinutes}
	n := 1
	n++
	if bboxOK {
		q += fmt.Sprintf(` AND o.lat >= $%d AND o.lat <= $%d AND o.lng >= $%d AND o.lng <= $%d`, n, n+1, n+2, n+3)
		args = append(args, bbox[1], bbox[3], bbox[0], bbox[2])
		n += 4
	}
	cleanSources := normalizeSources(opts.Sources)
	if len(cleanSources) > 0 {
		q += fmt.Sprintf(` AND LOWER(COALESCE(NULLIF(o.source, ''), o.data_source)) = ANY($%d::text[])`, n)
		args = append(args, cleanSources)
		n++
	}
	q += `
		  ORDER BY o.mmsi, o.data_source, COALESCE(o.position_time, o.observed_at) DESC
		),
		ranked AS (
		  SELECT *,
		    CASE LOWER(source)
		      WHEN 'live_ais' THEN 0
		      WHEN 'aisstream' THEN 1
		      WHEN 'aisstream_snapshot' THEN 1
		      WHEN 'aishub' THEN 1
		      WHEN 'barentswatch' THEN 2
		      WHEN 'denmark_ais' THEN 2
		      WHEN 'maritime_redis' THEN 3
		      WHEN 'inferred_port_call' THEN 4
		      WHEN 'sentinel1_sar' THEN 5
		      ELSE 6
		    END AS src_rank,
		    CASE
		      WHEN NULLIF(TRIM(COALESCE(imo, '')), '') IS NOT NULL
		        THEN 'imo:' || NULLIF(TRIM(imo), '')
		      ELSE 'mmsi:' || mmsi::text
		    END AS vessel_key
		  FROM latest
		)
		SELECT DISTINCT ON (r.vessel_key)
		  r.mmsi, r.source, r.data_source, r.source_type, r.imo, r.lat, r.lng, r.sog, r.cog,
		  r.vessel_name, r.position_time, r.received_at, r.confidence, r.source_url, r.raw,
		  v.name, v.imo AS registry_imo, v.callsign, v.metadata AS vessel_metadata,
		  v.vessel_type, v.tanker_class, v.crude_capable, v.product_tanker
		FROM ranked r
		LEFT JOIN oil_vessels v ON v.mmsi = r.mmsi
		ORDER BY r.vessel_key, r.src_rank ASC, r.position_time DESC`
	q += fmt.Sprintf(` LIMIT %d`, sqlLimit)

	rows, err := pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []map[string]any
	for rows.Next() {
		var mmsi int64
		var source, dataSource, sourceType string
		var imo, registryImo, callsign *string
		var lat, lng float64
		var sog, cog, confidence *float64
		var vesselName, name, vtype, tclass *string
		var sourceURL *string
		var raw, vesselMeta []byte
		var observed time.Time
		var received *time.Time
		var crude, product *bool
		if err := rows.Scan(&mmsi, &source, &dataSource, &sourceType, &imo, &lat, &lng, &sog, &cog,
			&vesselName, &observed, &received, &confidence, &sourceURL, &raw,
			&name, &registryImo, &callsign, &vesselMeta, &vtype, &tclass, &crude, &product); err != nil {
			return nil, err
		}
		displayName := name
		if displayName == nil && vesselName != nil {
			displayName = vesselName
		}
		shipTypeCode, shipTypeLabel := shipTypeFromRaw(raw)
		item := map[string]any{
			"mmsi": mmsi, "ts": observed, "position_time": observed, "lat": lat, "lng": lng,
			"source": source, "data_source": dataSource, "source_type": sourceType,
			"imo": imo, "name": displayName, "vessel_name": displayName,
			"vessel_type": vtype, "tanker_class": tclass, "crude_capable": crude, "product_tanker": product,
			"ship_type_code": shipTypeCode, "ship_type_label": shipTypeLabel,
			"confidence": confidence, "source_url": sourceURL,
			"freshness_seconds": int(time.Since(observed).Seconds()),
		}
		if received != nil {
			item["received_at"] = *received
		}
		if sog != nil {
			item["speed"] = *sog
		}
		if cog != nil {
			item["course"] = *cog
		}
		registryIMO := registryImo
		if registryIMO == nil {
			registryIMO = imo
		}
		ais.EnrichLiveVesselMap(item, registryIMO, callsign, vesselMeta, raw)
		out = append(out, item)
	}
	return out, rows.Err()
}

func applyPetroleumCap(vessels []map[string]any, limit int, sourceMode string) ListResult {
	sort.SliceStable(vessels, func(i, j int) bool {
		pi := petroleumPriorityFromItem(vessels[i])
		pj := petroleumPriorityFromItem(vessels[j])
		if pi != pj {
			return pi > pj
		}
		ti, _ := vessels[i]["position_time"].(time.Time)
		tj, _ := vessels[j]["position_time"].(time.Time)
		return ti.After(tj)
	})
	total := len(vessels)
	allCounts := countShipTypes(vessels)
	if limit > 0 && total > limit {
		vessels = vessels[:limit]
	}
	return ListResult{
		Vessels:        vessels,
		TotalAvailable: total,
		ReturnedCount:  len(vessels),
		CapApplied:     total > limit,
		ShipTypeCounts: allCounts,
		Limit:          limit,
		SourceMode:     sourceMode,
	}
}

func countShipTypes(vessels []map[string]any) map[string]int {
	counts := map[string]int{}
	for _, item := range vessels {
		category := shipTypeCategoryFromItem(item)
		counts[category]++
	}
	return counts
}

func shipTypeFromRaw(raw []byte) (*int, string) {
	if len(raw) == 0 {
		return nil, ""
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, ""
	}
	code := intPtrFromAny(payload["ship_type_code"])
	label, _ := payload["ship_type_label"].(string)
	if label == "" {
		label, _ = payload["ShipType"].(string)
	}
	return code, label
}

// PickBest picks the highest-precedence observation for one MMSI (for tests).
func PickBest(obs []MergedVesselPosition) *MergedVesselPosition {
	if len(obs) == 0 {
		return nil
	}
	best := &obs[0]
	bestRank := SourceRank(best.DataSource)
	for i := 1; i < len(obs); i++ {
		c := &obs[i]
		r := SourceRank(c.DataSource)
		if r < bestRank || (r == bestRank && c.ObservedAt.After(best.ObservedAt)) {
			best = c
			bestRank = r
		}
	}
	return best
}

func normalizeSources(sources []string) []string {
	out := make([]string, 0, len(sources))
	seen := map[string]bool{}
	for _, source := range sources {
		clean := strings.TrimSpace(strings.ToLower(source))
		if clean == "" || seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
	}
	return out
}
