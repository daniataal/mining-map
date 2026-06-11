package predictive

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	STSPairPredictionSignalType = "sts_pair_prediction"
	defaultPairLimit            = 250
	defaultMinPairProbability   = 65
)

type STSPairPredictionInput struct {
	DistanceM                float64
	AvgSOG                   float64
	BothTankers              bool
	InKnownSTSZone           bool
	ZoneName                 string
	MaritimeContextType      string
	MaritimeContextDistanceM float64
	NearestTerminalDistanceM float64
	TimeSkewSeconds          float64
}

type STSPairPredictionScore struct {
	FuturePairProbability float64               `json:"future_pair_probability"`
	ContextLabel          string                `json:"context_label"`
	ReviewTier            string                `json:"review_tier"`
	Factors               []STSPredictionFactor `json:"factors"`
	Penalties             []string              `json:"penalties,omitempty"`
	Limitations           []string              `json:"limitations"`
	Disclaimer            string                `json:"disclaimer"`
}

type STSPredictionFactor struct {
	Name   string  `json:"name"`
	Score  float64 `json:"score"`
	Detail string  `json:"detail"`
}

type pairPredictionCandidate struct {
	PairKey                  string
	MMSIA                    string
	MMSIB                    string
	NameA                    string
	NameB                    string
	ClassA                   string
	ClassB                   string
	Lat                      float64
	Lon                      float64
	DistanceM                float64
	AvgSOG                   float64
	TimeSkewSeconds          float64
	LatestA                  time.Time
	LatestB                  time.Time
	LatA                     float64
	LonA                     float64
	LatB                     float64
	LonB                     float64
	InKnownSTSZone           bool
	ZoneName                 string
	MaritimeContextName      string
	MaritimeContextType      string
	MaritimeContextDistanceM float64
	NearestTerminalName      string
	NearestTerminalKind      string
	NearestTerminalDistanceM float64
}

type scoredPairPrediction struct {
	pairPredictionCandidate
	Score STSPairPredictionScore
}

func ScoreSTSPairPrediction(in STSPairPredictionInput) STSPairPredictionScore {
	score := 20.0
	factors := []STSPredictionFactor{}
	penalties := []string{}
	add := func(name string, pts float64, detail string) {
		factors = append(factors, STSPredictionFactor{Name: name, Score: math.Round(pts), Detail: detail})
		score += pts
	}

	switch {
	case in.DistanceM <= 300:
		add("current_pair_distance", 36, fmt.Sprintf("vessels %.0f m apart", in.DistanceM))
	case in.DistanceM <= 750:
		add("current_pair_distance", 26, fmt.Sprintf("vessels %.0f m apart", in.DistanceM))
	case in.DistanceM <= 1500:
		add("current_pair_distance", 14, fmt.Sprintf("vessels %.0f m apart", in.DistanceM))
	default:
		add("current_pair_distance", 0, fmt.Sprintf("vessels %.0f m apart", in.DistanceM))
	}
	switch {
	case in.AvgSOG <= 1.5:
		add("slow_behavior", 18, fmt.Sprintf("average speed %.1f kn", in.AvgSOG))
	case in.AvgSOG <= 3:
		add("slow_behavior", 10, fmt.Sprintf("average speed %.1f kn", in.AvgSOG))
	default:
		add("slow_behavior", -8, fmt.Sprintf("average speed %.1f kn", in.AvgSOG))
		penalties = append(penalties, "pair is not slow enough for high-confidence STS")
	}
	if in.BothTankers {
		add("vessel_classes", 18, "both vessels are tanker-class")
	} else {
		add("vessel_classes", -10, "one or both vessels are not tanker-class")
		penalties = append(penalties, "vessel class support is weak")
	}
	contextLabel := "open water"
	if in.InKnownSTSZone {
		contextLabel = "offshore STS zone"
		add("known_sts_zone", 14, zoneDetail(true, in.ZoneName))
	}
	ctxType := strings.ToLower(strings.TrimSpace(in.MaritimeContextType))
	if isAnchorageOrPort(ctxType) && !in.InKnownSTSZone {
		score -= 35
		contextLabel = maritimeContextLabel(ctxType)
		penalties = append(penalties, "port/anchorage context makes this a review candidate")
	} else if ctxType != "" {
		contextLabel = maritimeContextLabel(ctxType)
	}
	if in.NearestTerminalDistanceM > 0 && !in.InKnownSTSZone {
		switch {
		case in.NearestTerminalDistanceM <= 1500:
			score -= 35
			contextLabel = "terminal edge"
			penalties = append(penalties, "very near terminal/facility; possible port co-presence")
		case in.NearestTerminalDistanceM <= 5000:
			score -= 25
			if contextLabel == "open water" {
				contextLabel = "terminal edge"
			}
			penalties = append(penalties, "near petroleum terminal/facility")
		case in.NearestTerminalDistanceM <= 15000:
			score -= 10
		}
	}
	if in.TimeSkewSeconds > 900 {
		score -= 10
		penalties = append(penalties, "latest AIS fixes are not tightly simultaneous")
	}

	score = clamp100(math.Round(score))
	return STSPairPredictionScore{
		FuturePairProbability: score,
		ContextLabel:          contextLabel,
		ReviewTier:            pairPredictionTier(score, penalties),
		Factors:               factors,
		Penalties:             penalties,
		Limitations: []string{
			"Prediction is vessel-pair likelihood from recent AIS, not a confirmed future transfer",
			"Plotted point is the current/recent AIS pair midpoint, not a land/grid centroid",
			"AIS does not confirm cargo transfer, cargo grade, or title change",
		},
		Disclaimer: "STS pair prediction is based on recent vessel proximity, speed, class, and maritime context; it is not a confirmed transfer.",
	}
}

func RunSTSPairPredictions(ctx context.Context, pool *pgxpool.Pool) (RunResult, error) {
	started := time.Now()
	candidates, err := loadPairPredictionCandidates(ctx, pool)
	if err != nil {
		return RunResult{}, err
	}
	scored := make([]scoredPairPrediction, 0, len(candidates))
	for _, c := range candidates {
		score := ScoreSTSPairPrediction(STSPairPredictionInput{
			DistanceM:                c.DistanceM,
			AvgSOG:                   c.AvgSOG,
			BothTankers:              true,
			InKnownSTSZone:           c.InKnownSTSZone,
			ZoneName:                 c.ZoneName,
			MaritimeContextType:      c.MaritimeContextType,
			MaritimeContextDistanceM: c.MaritimeContextDistanceM,
			NearestTerminalDistanceM: c.NearestTerminalDistanceM,
			TimeSkewSeconds:          c.TimeSkewSeconds,
		})
		if score.FuturePairProbability >= defaultMinPairProbability {
			scored = append(scored, scoredPairPrediction{pairPredictionCandidate: c, Score: score})
		}
	}
	written, err := upsertPairPredictions(ctx, pool, scored, time.Now().UTC())
	if err != nil {
		return RunResult{}, err
	}
	return RunResult{
		Horizons:    []int{24},
		RowsScored:  len(candidates),
		RowsWritten: written,
		DurationMS:  time.Since(started).Milliseconds(),
	}, nil
}

func loadPairPredictionCandidates(ctx context.Context, pool *pgxpool.Pool) ([]pairPredictionCandidate, error) {
	rows, err := pool.Query(ctx, `
		WITH latest AS (
			SELECT DISTINCT ON (p.mmsi)
				p.mmsi, p.ts, p.lat, p.lon, p.geom, COALESCE(p.speed_knots, 0) AS speed_knots,
				COALESCE(v.name, '') AS name, COALESCE(v.vessel_type, '') AS vessel_type
			FROM ais_positions p
			JOIN vessels v ON v.mmsi = p.mmsi
			WHERE p.ts >= now() - interval '6 hours'
			  AND p.geom IS NOT NULL
			  AND (
			    lower(COALESCE(v.vessel_type,'')) LIKE '%tanker%'
			    OR lower(COALESCE(v.vessel_type,'')) IN ('crude','product','chemical','lng','lpg')
			  )
			ORDER BY p.mmsi, p.ts DESC
		),
		pairs AS (
			SELECT
				LEAST(a.mmsi, b.mmsi) || ':' || GREATEST(a.mmsi, b.mmsi) AS pair_key,
				a.mmsi AS mmsi_a, b.mmsi AS mmsi_b,
				a.name AS name_a, b.name AS name_b,
				a.vessel_type AS class_a, b.vessel_type AS class_b,
				((a.lat + b.lat) / 2.0) AS lat,
				((a.lon + b.lon) / 2.0) AS lon,
				ST_Distance(a.geom, b.geom) AS distance_m,
				((a.speed_knots + b.speed_knots) / 2.0) AS avg_sog,
				abs(extract(epoch FROM (a.ts - b.ts))) AS time_skew_seconds,
				a.ts AS latest_a, b.ts AS latest_b,
				a.lat AS lat_a, a.lon AS lon_a, b.lat AS lat_b, b.lon AS lon_b,
				ST_SetSRID(ST_MakePoint((a.lon + b.lon) / 2.0, (a.lat + b.lat) / 2.0), 4326)::geography AS midpoint
			FROM latest a
			JOIN latest b ON a.mmsi < b.mmsi
			WHERE abs(extract(epoch FROM (a.ts - b.ts))) <= 1800
			  AND ST_DWithin(a.geom, b.geom, 1500::double precision)
			  AND ((a.speed_knots + b.speed_knots) / 2.0) <= 4
		)
		SELECT
			p.pair_key, p.mmsi_a, p.mmsi_b, p.name_a, p.name_b, p.class_a, p.class_b,
			p.lat, p.lon, p.distance_m, p.avg_sog, p.time_skew_seconds,
			p.latest_a, p.latest_b, p.lat_a, p.lon_a, p.lat_b, p.lon_b,
			(z.name IS NOT NULL) AS in_known_sts_zone,
			COALESCE(z.name, '') AS zone_name,
			COALESCE(mc.name, '') AS maritime_context_name,
			COALESCE(mc.kind, '') AS maritime_context_type,
			COALESCE(mc.distance_m, 0)::double precision AS maritime_context_distance_m,
			COALESCE(term.name, '') AS nearest_terminal_name,
			COALESCE(term.kind, '') AS nearest_terminal_kind,
			COALESCE(term.distance_m, 0)::double precision AS nearest_terminal_distance_m
		FROM pairs p
		LEFT JOIN LATERAL (
			SELECT name
			FROM sts_zones z
			WHERE z.geom IS NOT NULL AND ST_DWithin(z.geom, p.midpoint, 25000::double precision)
			ORDER BY ST_Distance(z.geom, p.midpoint)
			LIMIT 1
		) z ON true
		LEFT JOIN LATERAL (
			SELECT COALESCE(NULLIF(port_name,''), NULLIF(name,''), context_type) AS name,
			       COALESCE(context_type,'') AS kind,
			       ST_Distance(geom, p.midpoint) AS distance_m
			FROM maritime_context_zones
			WHERE geom IS NOT NULL
			  AND ST_DWithin(geom, p.midpoint, GREATEST(15000::double precision, COALESCE(radius_m, 0)))
			ORDER BY ST_Distance(geom, p.midpoint)
			LIMIT 1
		) mc ON true
		LEFT JOIN LATERAL (
			SELECT COALESCE(name,'') AS name, COALESCE(asset_type,'') AS kind, ST_Distance(geom, p.midpoint) AS distance_m
			FROM assets
			WHERE geom IS NOT NULL
			  AND asset_type IN ('terminal','port','refinery','tank_farm','storage','berth','lng_terminal')
			  AND ST_DWithin(geom, p.midpoint, 15000::double precision)
			ORDER BY ST_Distance(geom, p.midpoint)
			LIMIT 1
		) term ON true
		ORDER BY p.distance_m ASC, p.avg_sog ASC
		LIMIT $1
	`, defaultPairLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pairPredictionCandidate{}
	for rows.Next() {
		var c pairPredictionCandidate
		if err := rows.Scan(
			&c.PairKey, &c.MMSIA, &c.MMSIB, &c.NameA, &c.NameB, &c.ClassA, &c.ClassB,
			&c.Lat, &c.Lon, &c.DistanceM, &c.AvgSOG, &c.TimeSkewSeconds,
			&c.LatestA, &c.LatestB, &c.LatA, &c.LonA, &c.LatB, &c.LonB,
			&c.InKnownSTSZone, &c.ZoneName, &c.MaritimeContextName, &c.MaritimeContextType,
			&c.MaritimeContextDistanceM, &c.NearestTerminalName, &c.NearestTerminalKind, &c.NearestTerminalDistanceM,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func upsertPairPredictions(ctx context.Context, pool *pgxpool.Pool, pairs []scoredPairPrediction, now time.Time) (int, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE predictive_signals
		SET expires_at = now()
		WHERE signal_type = $1
	`, STSPairPredictionSignalType); err != nil {
		return 0, err
	}
	written := 0
	for _, pair := range pairs {
		payload, _ := json.Marshal(pairPredictionPayload(pair, now))
		tag, err := tx.Exec(ctx, `
			UPDATE predictive_signals SET
				tier = 'prediction',
				confidence_score = $2::numeric,
				horizon_hours = 24,
				payload = $3::jsonb,
				predicted_at = now(),
				geom = ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
				expires_at = now() + interval '2 hours'
			WHERE signal_type = $1 AND payload->>'pair_key' = $6
		`, STSPairPredictionSignalType, pair.Score.FuturePairProbability, payload, pair.Lon, pair.Lat, pair.PairKey)
		if err != nil {
			return written, err
		}
		if tag.RowsAffected() > 0 {
			written += int(tag.RowsAffected())
			continue
		}
		tag, err = tx.Exec(ctx, `
			INSERT INTO predictive_signals (
				signal_type, entity_type, tier, confidence_score, horizon_hours,
				payload, predicted_at, geom, expires_at
			)
			VALUES (
				$1, 'vessel_pair', 'prediction', $2::numeric, 24,
				$3::jsonb, now(), ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
				now() + interval '2 hours'
			)
		`, STSPairPredictionSignalType, pair.Score.FuturePairProbability, payload, pair.Lon, pair.Lat)
		if err != nil {
			return written, err
		}
		written += int(tag.RowsAffected())
	}
	if err := tx.Commit(ctx); err != nil {
		return written, err
	}
	return written, nil
}

func pairPredictionPayload(pair scoredPairPrediction, now time.Time) map[string]any {
	title := stsPairTitle(pair.NameA, pair.NameB, pair.MMSIA, pair.MMSIB)
	payload := map[string]any{
		"pair_key":                pair.PairKey,
		"prediction_kind":         "vessel_pair",
		"name":                    title,
		"event_title":             title,
		"mmsi_a":                  pair.MMSIA,
		"mmsi_b":                  pair.MMSIB,
		"vessel_a_name":           pair.NameA,
		"vessel_b_name":           pair.NameB,
		"vessel_a_class":          pair.ClassA,
		"vessel_b_class":          pair.ClassB,
		"event_lat":               pair.Lat,
		"event_lon":               pair.Lon,
		"future_pair_probability": pair.Score.FuturePairProbability,
		"confidence_score":        pair.Score.FuturePairProbability,
		"horizon_hours":           24,
		"context_label":           pair.Score.ContextLabel,
		"review_tier":             pair.Score.ReviewTier,
		"distance_m":              pair.DistanceM,
		"avg_sog":                 pair.AvgSOG,
		"time_skew_seconds":       pair.TimeSkewSeconds,
		"latest_a":                pair.LatestA.UTC().Format(time.RFC3339),
		"latest_b":                pair.LatestB.UTC().Format(time.RFC3339),
		"vessel_a_position":       map[string]any{"lat": pair.LatA, "lon": pair.LonA, "ts": pair.LatestA.UTC().Format(time.RFC3339)},
		"vessel_b_position":       map[string]any{"lat": pair.LatB, "lon": pair.LonB, "ts": pair.LatestB.UTC().Format(time.RFC3339)},
		"known_sts_zone":          pair.InKnownSTSZone,
		"zone_name":               pair.ZoneName,
		"factors":                 pair.Score.Factors,
		"penalties":               pair.Score.Penalties,
		"limitations":             pair.Score.Limitations,
		"disclaimer":              pair.Score.Disclaimer,
		"predicted_at":            now.UTC().Format(time.RFC3339),
	}
	if pair.MaritimeContextName != "" || pair.MaritimeContextType != "" {
		payload["maritime_context"] = map[string]any{
			"name":       pair.MaritimeContextName,
			"kind":       pair.MaritimeContextType,
			"distance_m": pair.MaritimeContextDistanceM,
		}
	}
	if pair.NearestTerminalName != "" || pair.NearestTerminalKind != "" {
		payload["nearest_oil_terminal"] = map[string]any{
			"name":       pair.NearestTerminalName,
			"kind":       pair.NearestTerminalKind,
			"distance_m": pair.NearestTerminalDistanceM,
		}
	}
	return payload
}

func stsPairTitle(nameA, nameB, mmsiA, mmsiB string) string {
	a := strings.TrimSpace(nameA)
	b := strings.TrimSpace(nameB)
	if a == "" {
		a = "MMSI " + strings.TrimSpace(mmsiA)
	}
	if b == "" {
		b = "MMSI " + strings.TrimSpace(mmsiB)
	}
	return a + " ↔ " + b
}

func pairPredictionTier(score float64, penalties []string) string {
	switch {
	case score < 45:
		return "low"
	case len(penalties) > 0:
		return "review"
	case score >= 80:
		return "high"
	case score >= 65:
		return "medium"
	default:
		return "review"
	}
}

func Status(ctx context.Context, pool *pgxpool.Pool) StatusResponse {
	if pool == nil {
		return ScaffoldStatus()
	}
	var count int
	var latest sql.NullTime
	err := pool.QueryRow(ctx, `
		SELECT count(*)::int, max(predicted_at)
		FROM predictive_signals
		WHERE signal_type = $1
		  AND tier = 'prediction'
		  AND COALESCE(confidence_score, 0) >= 35
		  AND (expires_at IS NULL OR expires_at > now())
	`, STSPairPredictionSignalType).Scan(&count, &latest)
	if err != nil {
		if isMissingPredictiveTable(err) {
			return ScaffoldStatus()
		}
		st := ScaffoldStatus()
		st.Message = "Predictive status query failed"
		st.Limitations = append(st.Limitations, err.Error())
		return st
	}
	if count == 0 {
		return StatusResponse{
			Tier:    "prediction",
			Status:  "no_candidates",
			Message: "STS vessel-pair prediction job is active; no current vessel pairs are above threshold",
			SignalTypes: []string{
				STSPairPredictionSignalType,
			},
			Signals: []any{},
			Limitations: []string{
				"no map prediction is shown when no vessel pair clears the threshold",
				"pair predictions depend on fresh AIS positions and tanker classification",
				"AIS does not confirm cargo transfer, cargo grade, or title change",
			},
		}
	}
	latestAt := ""
	if latest.Valid {
		latestAt = latest.Time.UTC().Format(time.RFC3339)
	}
	return StatusResponse{
		Tier:    "prediction",
		Status:  "available",
		Message: "STS vessel-pair predictions are available",
		SignalTypes: []string{
			STSPairPredictionSignalType,
		},
		Signals: []any{
			map[string]any{"signal_type": STSPairPredictionSignalType, "active_rows": count, "latest_predicted_at": latestAt},
		},
		Limitations: []string{
			"pair predictions are likely vessel-pair candidates, not confirmed future transfers",
			"confidence depends on AIS freshness and port/anchorage context",
			"deterministic first version; no trained classifier is served",
		},
	}
}

func zoneDetail(inZone bool, name string) string {
	if !inZone {
		return "outside known STS zones"
	}
	if strings.TrimSpace(name) == "" {
		return "inside known STS zone"
	}
	return "inside known STS zone: " + strings.TrimSpace(name)
}

func maritimeContextLabel(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	switch {
	case strings.Contains(t, "anchorage"):
		return "port anchorage"
	case strings.Contains(t, "berth"):
		return "berth"
	case strings.Contains(t, "port"), strings.Contains(t, "harbour"), strings.Contains(t, "harbor"):
		return "port"
	default:
		return t
	}
}

func isAnchorageOrPort(t string) bool {
	t = strings.ToLower(strings.TrimSpace(t))
	return strings.Contains(t, "anchorage") || strings.Contains(t, "port") || strings.Contains(t, "harbour") || strings.Contains(t, "harbor") || strings.Contains(t, "berth")
}

func clamp100(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func isMissingPredictiveTable(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "42P01" || pgErr.Code == "42703"
	}
	return false
}
