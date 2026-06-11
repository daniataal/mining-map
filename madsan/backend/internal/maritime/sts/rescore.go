package sts

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
)

// RescoreResult reports a stored-signal probability backfill pass.
type RescoreResult struct {
	Scanned     int `json:"scanned"`
	Updated     int `json:"updated"`
	WithContext int `json:"with_context"`
	NoCoords    int `json:"no_coords"`
}

type storedSignal struct {
	ID         uuid.UUID
	Payload    map[string]any
	ClassA     string
	ClassB     string
	ObservedAt time.Time
}

// rescoreAnomalies holds dataset-wide AIS integrity signals computed once per
// run: cells (~111 m grid, 6 h time buckets) where 4+ distinct vessels reported
// near-identical positions at the same time (GPS spoofing signature — an
// anchorage slot can only hold one vessel pair at a time), and per-vessel STS
// partner degree.
type rescoreAnomalies struct {
	spoofCells    map[string]int
	partnerDegree map[string]int
}

const spoofBucketSeconds = 21600 // 6 hours

func spoofCellKey(lat, lon float64, observed time.Time) string {
	return fmt.Sprintf("%.3f:%.3f:%d", lat, lon, observed.Unix()/spoofBucketSeconds)
}

func loadRescoreAnomalies(ctx context.Context, pool *pgxpool.Pool) (rescoreAnomalies, error) {
	out := rescoreAnomalies{spoofCells: map[string]int{}, partnerDegree: map[string]int{}}
	rows, err := pool.Query(ctx, `
		WITH ev AS (
			SELECT
				round(COALESCE(NULLIF(NULLIF(payload->>'event_lat',''),'0'),
					NULLIF(NULLIF(payload->>'centroid_lat',''),'0'))::numeric, 3) AS rlat,
				round(COALESCE(NULLIF(NULLIF(payload->>'event_lon',''),'0'),
					NULLIF(NULLIF(payload->>'centroid_lon',''),'0'))::numeric, 3) AS rlon,
				floor(extract(epoch FROM observed_at) / $1)::bigint AS bucket,
				NULLIF(payload->>'mmsi_a','') AS mmsi_a,
				NULLIF(payload->>'mmsi_b','') AS mmsi_b
			FROM core_signals
			WHERE signal_type = 'sts' AND observed_at >= now() - interval '30 days'
		)
		SELECT rlat::text, rlon::text, bucket, COUNT(DISTINCT v.m)::int
		FROM ev, LATERAL (VALUES (ev.mmsi_a), (ev.mmsi_b)) v(m)
		WHERE ev.rlat IS NOT NULL AND ev.rlon IS NOT NULL AND v.m IS NOT NULL
		GROUP BY 1, 2, 3
		HAVING COUNT(DISTINCT v.m) >= 4
	`, spoofBucketSeconds)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var rlat, rlon string
		var bucket int64
		var n int
		if err := rows.Scan(&rlat, &rlon, &bucket, &n); err != nil {
			rows.Close()
			return out, err
		}
		out.spoofCells[fmt.Sprintf("%s:%s:%d", rlat, rlon, bucket)] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	degRows, err := pool.Query(ctx, `
		SELECT m, COUNT(DISTINCT partner)::int
		FROM (
			SELECT NULLIF(payload->>'mmsi_a','') AS m, NULLIF(payload->>'mmsi_b','') AS partner
			FROM core_signals WHERE signal_type = 'sts' AND observed_at >= now() - interval '14 days'
			UNION ALL
			SELECT NULLIF(payload->>'mmsi_b',''), NULLIF(payload->>'mmsi_a','')
			FROM core_signals WHERE signal_type = 'sts' AND observed_at >= now() - interval '14 days'
		) t
		WHERE m IS NOT NULL AND partner IS NOT NULL
		GROUP BY m
		HAVING COUNT(DISTINCT partner) >= 4
	`)
	if err != nil {
		return out, err
	}
	defer degRows.Close()
	for degRows.Next() {
		var m string
		var n int
		if err := degRows.Scan(&m, &n); err != nil {
			return out, err
		}
		out.partnerDegree[m] = n
	}
	return out, degRows.Err()
}

// RescoreStored backfills transfer_probability (and spatial context, when the
// event has coordinates) into stored STS signals that were persisted before the
// probability model existed — primarily legacy imports. Idempotent: rows that
// already carry transfer_probability are skipped (unless force is set, e.g.
// after a scoring-model change), so the serving API never has to compute
// scores or run spatial queries per request.
func RescoreStored(ctx context.Context, pool *pgxpool.Pool, limit int, force bool) (RescoreResult, error) {
	var res RescoreResult
	if limit <= 0 {
		limit = 50000
	}
	anomalies, err := loadRescoreAnomalies(ctx, pool)
	if err != nil {
		return res, err
	}
	rows, err := pool.Query(ctx, `
		SELECT cs.id, cs.payload, cs.observed_at,
			COALESCE(NULLIF(cs.payload->>'vessel_a_class',''), va.vessel_type, '') AS class_a,
			COALESCE(NULLIF(cs.payload->>'vessel_b_class',''), vb.vessel_type, '') AS class_b
		FROM core_signals cs
		LEFT JOIN vessels va ON va.mmsi = NULLIF(cs.payload->>'mmsi_a','')
		LEFT JOIN vessels vb ON vb.mmsi = NULLIF(cs.payload->>'mmsi_b','')
		WHERE cs.signal_type = 'sts'
		  AND ($2 OR cs.payload->>'transfer_probability' IS NULL)
		ORDER BY cs.observed_at DESC
		LIMIT $1
	`, limit, force)
	if err != nil {
		return res, err
	}
	signals := []storedSignal{}
	for rows.Next() {
		var s storedSignal
		var payload []byte
		if err := rows.Scan(&s.ID, &payload, &s.ObservedAt, &s.ClassA, &s.ClassB); err != nil {
			rows.Close()
			return res, err
		}
		if json.Unmarshal(payload, &s.Payload) != nil || s.Payload == nil {
			continue
		}
		signals = append(signals, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return res, err
	}

	for _, s := range signals {
		res.Scanned++
		patch, hadContext, hadCoords, err := rescorePatch(ctx, pool, s, anomalies)
		if err != nil {
			return res, err
		}
		if hadContext {
			res.WithContext++
		}
		if !hadCoords {
			res.NoCoords++
		}
		patchJSON, _ := json.Marshal(patch)
		transfer, _ := patch["transfer_probability"].(float64)
		if _, err := pool.Exec(ctx, `
			UPDATE core_signals
			SET payload = payload || $2::jsonb, confidence_score = $3::numeric
			WHERE id = $1
		`, s.ID, patchJSON, transfer); err != nil {
			return res, err
		}
		res.Updated++
	}
	return res, nil
}

func rescorePatch(ctx context.Context, pool *pgxpool.Pool, s storedSignal, anomalies rescoreAnomalies) (map[string]any, bool, bool, error) {
	p := s.Payload
	zoneName := payloadStr(p["zone_name"])
	in := intelligence.STSProbabilityInput{
		MinDistanceM:       payloadFloat(p["min_distance_m"]),
		DurationHours:      storedDurationHours(p),
		AvgSOG:             payloadFloat(p["avg_sog"]),
		DistanceVarianceM:  payloadFloat(p["distance_variance_m"]),
		BothTankers:        isTankerLoose(s.ClassA) && isTankerLoose(s.ClassB),
		MixedTankerClasses: mixedTankerClasses(s.ClassA, s.ClassB),
		InSTSZone:          zoneName != "",
		ZoneName:           zoneName,
	}
	mmsiA := payloadStr(p["mmsi_a"])
	mmsiB := payloadStr(p["mmsi_b"])
	if d := anomalies.partnerDegree[mmsiA]; d > in.PartnerDegree {
		in.PartnerDegree = d
	}
	if d := anomalies.partnerDegree[mmsiB]; d > in.PartnerDegree {
		in.PartnerDegree = d
	}

	lat, okLat := storedEventCoord(p, "lat")
	lon, okLon := storedEventCoord(p, "lon")
	hadCoords := okLat && okLon
	hadContext := false
	patch := map[string]any{}
	if hadCoords {
		n := anomalies.spoofCells[spoofCellKey(lat, lon, s.ObservedAt)]
		in.SpoofClusterVessels = n
		patch["spoof_cluster_vessels"] = n
		onLand, nearWater, err := landContext(ctx, pool, lat, lon)
		if err != nil {
			return nil, false, hadCoords, err
		}
		in.PositionOnLand = onLand && !nearWater
		patch["position_on_land"] = in.PositionOnLand
		patch["gps_spoofing_suspected"] = in.PositionOnLand || n >= 4
	}

	if hadCoords {
		if mc, err := nearestMaritimeContext(ctx, pool, lat, lon); err != nil {
			return nil, false, hadCoords, err
		} else if mc != nil {
			in.MaritimeContextType = mc.Kind
			in.MaritimeContextName = mc.Name
			in.MaritimeContextDistanceM = mc.DistanceM
			patch["maritime_context"] = map[string]any{"name": mc.Name, "kind": mc.Kind, "distance_m": mc.DistanceM}
			hadContext = true
		}
		if term, err := nearestOilTerminal(ctx, pool, lat, lon); err != nil {
			return nil, false, hadCoords, err
		} else if term != nil {
			in.NearestTerminalName = term.Name
			in.NearestTerminalDistanceM = term.DistanceM
			patch["nearest_oil_terminal"] = map[string]any{"name": term.Name, "kind": term.Kind, "distance_m": term.DistanceM}
			hadContext = true
		}
	}

	prob := intelligence.ScoreSTSProbability(in)
	patch["probability"] = prob
	patch["proximity_score"] = prob.ProximityScore
	patch["transfer_probability"] = prob.TransferProbability
	patch["cargo_confidence"] = prob.CargoConfidence
	patch["context_label"] = prob.ContextLabel
	patch["review_tier"] = prob.ReviewTier
	patch["downgrade_reasons"] = prob.DowngradeReasons
	patch["rescored_at"] = time.Now().UTC().Format(time.RFC3339)
	if s.ClassA != "" && payloadStr(p["vessel_a_class"]) == "" {
		patch["vessel_a_class"] = s.ClassA
	}
	if s.ClassB != "" && payloadStr(p["vessel_b_class"]) == "" {
		patch["vessel_b_class"] = s.ClassB
	}
	return patch, hadContext, hadCoords, nil
}

func storedDurationHours(p map[string]any) float64 {
	if d := payloadFloat(p["duration_hours"]); d > 0 {
		return d
	}
	start, errA := time.Parse(time.RFC3339, payloadStr(p["start_ts"]))
	end, errB := time.Parse(time.RFC3339, payloadStr(p["end_ts"]))
	if errA == nil && errB == nil && end.After(start) {
		return end.Sub(start).Hours()
	}
	return 0
}

func storedEventCoord(p map[string]any, axis string) (float64, bool) {
	var keys []string
	if axis == "lat" {
		keys = []string{"event_lat", "closest_approach_lat", "centroid_lat"}
	} else {
		keys = []string{"event_lon", "closest_approach_lon", "centroid_lon"}
	}
	for _, k := range keys {
		v := payloadFloat(p[k])
		if v != 0 {
			return v, true
		}
	}
	return 0, false
}

func mixedTankerClasses(classA, classB string) bool {
	a := tankerCargoFamily(classA)
	b := tankerCargoFamily(classB)
	return a != "" && b != "" && a != b
}

func tankerCargoFamily(class string) string {
	c := strings.ToLower(strings.TrimSpace(class))
	switch {
	case c == "crude" || strings.Contains(c, "crude"):
		return "crude"
	case c == "product" || strings.Contains(c, "product"):
		return "product"
	case c == "chemical" || strings.Contains(c, "chemical"):
		return "chemical"
	case c == "lng" || c == "lpg" || strings.Contains(c, "gas"):
		return "gas"
	default:
		return ""
	}
}

func isTankerLoose(class string) bool {
	c := strings.ToLower(strings.TrimSpace(class))
	switch c {
	case "crude", "product", "chemical", "lng", "lpg", "tanker":
		return true
	}
	return strings.Contains(c, "tanker")
}

func payloadFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case json.Number:
		f, _ := t.Float64()
		return f
	default:
		return 0
	}
}

func payloadStr(v any) string {
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if s == "<nil>" {
		return ""
	}
	return s
}
