package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
)

func stsEventKind(payload map[string]any) string {
	if src, _ := payload["source"].(string); src == "legacy_import" {
		return "historic"
	}
	if payload["legacy_sts_id"] != nil && fmtStr(payload["legacy_sts_id"]) != "" {
		return "historic"
	}
	if det, _ := payload["detector"].(string); det == "ais_proximity_v1" || det == "ais_proximity_v2" {
		return "inferred"
	}
	if st, _ := payload["status"].(string); st == "verified" {
		return "verified"
	}
	return "inferred"
}

func stsProductHint(classA, classB string) string {
	a := strings.ToLower(strings.TrimSpace(classA))
	b := strings.ToLower(strings.TrimSpace(classB))
	classes := []string{a, b}
	hasCrude, hasProduct, hasChem, hasLNG, hasLPG := false, false, false, false, false
	for _, c := range classes {
		if c == "" {
			continue
		}
		switch {
		case c == "crude":
			hasCrude = true
		case c == "product":
			hasProduct = true
		case c == "chemical":
			hasChem = true
		case c == "lng":
			hasLNG = true
		case c == "lpg":
			hasLPG = true
		}
	}
	switch {
	case hasLNG:
		return "LNG (tanker class inference — not verified cargo)"
	case hasLPG:
		return "LPG (tanker class inference — not verified cargo)"
	case hasCrude && !hasProduct && !hasChem:
		return "Crude oil (tanker class inference — not verified cargo)"
	case (hasProduct || hasChem) && !hasCrude:
		return "Refined / clean petroleum (tanker class inference — not verified cargo)"
	case hasCrude && (hasProduct || hasChem):
		return "Mixed tanker classes — product type unconfirmed"
	default:
		return ""
	}
}

func stsVesselLabel(name, mmsi string) string {
	name = strings.TrimSpace(name)
	mmsi = strings.TrimSpace(mmsi)
	if name != "" && mmsi != "" {
		return name + " · MMSI " + mmsi
	}
	if name != "" {
		return name
	}
	if mmsi != "" {
		return "MMSI " + mmsi
	}
	return "Unknown vessel"
}

func stsTitle(nameA, nameB, mmsiA, mmsiB string) string {
	a := strings.TrimSpace(nameA)
	b := strings.TrimSpace(nameB)
	if a != "" && b != "" {
		return a + " ↔ " + b
	}
	if a != "" || b != "" {
		if a == "" {
			a = "MMSI " + mmsiA
		}
		if b == "" {
			b = "MMSI " + mmsiB
		}
		return a + " ↔ " + b
	}
	if mmsiA != "" && mmsiB != "" {
		return "MMSI " + mmsiA + " ↔ MMSI " + mmsiB
	}
	return "STS event"
}

func stsTimeFromPayload(payload map[string]any, observed time.Time) (start, end string) {
	if s := fmtStr(payload["start_ts"]); s != "" {
		start = s
	}
	if e := fmtStr(payload["end_ts"]); e != "" {
		end = e
	}
	if start == "" && !observed.IsZero() {
		start = observed.UTC().Format(time.RFC3339)
	}
	return start, end
}

func stsConfidenceTier(payload map[string]any, rowTier string, score float64) string {
	if review := fmtStr(payload["review_tier"]); review != "" {
		if (review == "high" || review == "medium") && hasDowngradeReasons(payload["downgrade_reasons"]) {
			return "review"
		}
		return review
	}
	if sc, ok := payload["probability"].(map[string]any); ok {
		if rt, ok := sc["review_tier"].(string); ok && rt != "" {
			if (rt == "high" || rt == "medium") && hasDowngradeReasons(sc["downgrade_reasons"]) {
				return "review"
			}
			return rt
		}
	}
	if sc, ok := payload["score"].(map[string]any); ok {
		if ct, ok := sc["confidence_tier"].(string); ok && ct != "" {
			return ct
		}
	}
	if rowTier != "" {
		return rowTier
	}
	if score >= 75 {
		return "high"
	}
	if score >= 50 {
		return "medium"
	}
	return "low"
}

func fmtStr(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	default:
		return strings.TrimSpace(strings.Trim(fmt.Sprintf("%v", t), "[]"))
	}
}

func hasDowngradeReasons(v any) bool {
	switch t := v.(type) {
	case []string:
		return len(t) > 0
	case []any:
		return len(t) > 0
	case string:
		s := strings.TrimSpace(t)
		return s != "" && s != "[]" && s != "null"
	default:
		return false
	}
}

func eventPointFromPayload(payload map[string]any, axis string) (float64, bool) {
	keys := []string{}
	switch axis {
	case "lat":
		keys = []string{"event_lat", "closest_approach_lat", "centroid_lat"}
	case "lon":
		keys = []string{"event_lon", "closest_approach_lon", "centroid_lon"}
	default:
		return 0, false
	}
	for _, key := range keys {
		if v, ok := toFloat64(payload[key]); ok {
			return v, true
		}
	}
	return 0, false
}

func stsFeatureID(signalID uuid.UUID, payload map[string]any) string {
	if key := fmtStr(payload["sts_pair_key"]); key != "" {
		return key
	}
	if legacy := fmtStr(payload["legacy_sts_id"]); legacy != "" && legacy != "<nil>" {
		return "legacy:" + legacy
	}
	return signalID.String()
}

func ensureSTSProbability(ctx context.Context, pool *pgxpool.Pool, payload map[string]any, rowScore float64) {
	if _, ok := toFloat64(payload["transfer_probability"]); ok {
		if hasDowngradeReasons(payload["downgrade_reasons"]) {
			payload["review_tier"] = "review"
		}
		return
	}
	if prob, ok := payload["probability"].(map[string]any); ok {
		if transfer, ok := toFloat64(prob["transfer_probability"]); ok {
			payload["transfer_probability"] = transfer
			payload["proximity_score"] = prob["proximity_score"]
			payload["cargo_confidence"] = prob["cargo_confidence"]
			payload["context_label"] = prob["context_label"]
			payload["review_tier"] = prob["review_tier"]
			payload["downgrade_reasons"] = prob["downgrade_reasons"]
			return
		}
	}

	lat, okLat := eventPointFromPayload(payload, "lat")
	lon, okLon := eventPointFromPayload(payload, "lon")
	if !okLat || !okLon {
		payload["transfer_probability"] = rowScore
		payload["proximity_score"] = rowScore
		return
	}

	durationH, _ := toFloat64(payload["duration_hours"])
	if durationH <= 0 {
		start, end := stsTimeFromPayload(payload, time.Time{})
		if st, err := time.Parse(time.RFC3339, start); err == nil {
			if et, err := time.Parse(time.RFC3339, end); err == nil {
				durationH = et.Sub(st).Hours()
			}
		}
	}
	minDist, _ := toFloat64(payload["min_distance_m"])
	avgSOG, _ := toFloat64(payload["avg_sog"])
	distVar, _ := toFloat64(payload["distance_variance_m"])
	classA := strings.ToLower(fmtStr(payload["vessel_a_class"]))
	classB := strings.ToLower(fmtStr(payload["vessel_b_class"]))
	zoneName := fmtStr(payload["zone_name"])
	in := intelligence.STSProbabilityInput{
		MinDistanceM:      minDist,
		DurationHours:     durationH,
		AvgSOG:            avgSOG,
		DistanceVarianceM: distVar,
		BothTankers:       isSTSTankerClass(classA) && isSTSTankerClass(classB),
		InSTSZone:         zoneName != "" && zoneName != "<nil>",
		ZoneName:          zoneName,
	}
	if pool != nil {
		if mc := nearestReadContext(ctx, pool, lat, lon); mc != nil {
			in.MaritimeContextType = mc.Kind
			in.MaritimeContextName = mc.Name
			in.MaritimeContextDistanceM = mc.DistanceM
			payload["maritime_context"] = map[string]any{"name": mc.Name, "kind": mc.Kind, "distance_m": mc.DistanceM}
		}
		if term := nearestReadTerminal(ctx, pool, lat, lon); term != nil {
			in.NearestTerminalName = term.Name
			in.NearestTerminalDistanceM = term.DistanceM
			payload["nearest_oil_terminal"] = map[string]any{"name": term.Name, "kind": term.Kind, "distance_m": term.DistanceM}
		}
	}
	prob := intelligence.ScoreSTSProbability(in)
	payload["probability"] = prob
	payload["transfer_probability"] = prob.TransferProbability
	payload["proximity_score"] = prob.ProximityScore
	payload["cargo_confidence"] = prob.CargoConfidence
	payload["context_label"] = prob.ContextLabel
	payload["review_tier"] = prob.ReviewTier
	payload["downgrade_reasons"] = prob.DowngradeReasons
	payload["disclaimer"] = prob.Disclaimer
	payload["limitations"] = prob.Limitations
}

type readContextMatch struct {
	Name      string
	Kind      string
	DistanceM float64
}

func nearestReadContext(ctx context.Context, pool *pgxpool.Pool, lat, lon float64) *readContextMatch {
	var m readContextMatch
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(port_name,''), NULLIF(name,''), context_type),
		       COALESCE(context_type,''),
		       ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		FROM maritime_context_zones
		WHERE geom IS NOT NULL
		  AND ST_DWithin(
			geom,
			ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
			GREATEST(15000::double precision, COALESCE(radius_m, 0))
		  )
		ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		LIMIT 1
	`, lon, lat).Scan(&m.Name, &m.Kind, &m.DistanceM)
	if err != nil {
		return nil
	}
	return &m
}

func nearestReadTerminal(ctx context.Context, pool *pgxpool.Pool, lat, lon float64) *readContextMatch {
	var m readContextMatch
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(name,''), COALESCE(asset_type,''),
		       ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		FROM assets
		WHERE geom IS NOT NULL
		  AND asset_type IN ('terminal','port','refinery','tank_farm','storage','berth','lng_terminal')
		  AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 15000::double precision)
		ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		LIMIT 1
	`, lon, lat).Scan(&m.Name, &m.Kind, &m.DistanceM)
	if err != nil {
		return nil
	}
	return &m
}

func isSTSTankerClass(class string) bool {
	switch class {
	case "crude", "product", "chemical", "lng", "lpg", "tanker", "crude oil tanker", "oil/chemical tanker":
		return true
	default:
		return strings.Contains(class, "tanker")
	}
}

func stsFeatureProperties(
	signalID uuid.UUID,
	payload map[string]any,
	score float64,
	observed time.Time,
	rowTier string,
	nameA, nameB, classA, classB string,
) map[string]any {
	mmsiA := fmtStr(payload["mmsi_a"])
	mmsiB := fmtStr(payload["mmsi_b"])
	if nameA == "" {
		nameA = fmtStr(payload["name_a"])
	}
	if nameA == "" {
		nameA = fmtStr(payload["vessel_a_name"])
	}
	if nameB == "" {
		nameB = fmtStr(payload["name_b"])
	}
	if nameB == "" {
		nameB = fmtStr(payload["vessel_b_name"])
	}
	if classA == "" {
		classA = fmtStr(payload["vessel_a_class"])
	}
	if classB == "" {
		classB = fmtStr(payload["vessel_b_class"])
	}
	kind := stsEventKind(payload)
	startTS, endTS := stsTimeFromPayload(payload, observed)
	tier := stsConfidenceTier(payload, rowTier, score)
	product := stsProductHint(classA, classB)
	title := stsTitle(nameA, nameB, mmsiA, mmsiB)
	transferProbability, okTransfer := toFloat64(payload["transfer_probability"])
	if !okTransfer {
		transferProbability = score
	}
	proximityScore, okProx := toFloat64(payload["proximity_score"])
	if !okProx {
		proximityScore = score
	}

	disclaimer := fmtStr(payload["disclaimer"])
	if disclaimer == "" {
		if kind == "historic" {
			disclaimer = "Historic STS record from legacy AIS proximity pipeline — not verified cargo transfer or product grade."
		} else {
			disclaimer = "AIS proximity inference — not verified cargo transfer or product grade."
		}
	}

	return map[string]any{
		"signal_id":              signalID.String(),
		"name":                   title,
		"event_kind":             kind,
		"event_title":            title,
		"mmsi_a":                 mmsiA,
		"mmsi_b":                 mmsiB,
		"vessel_a_name":          nameA,
		"vessel_b_name":          nameB,
		"vessel_a_class":         classA,
		"vessel_b_class":         classB,
		"product_hint":           product,
		"zone_name":              payload["zone_name"],
		"min_distance_m":         payload["min_distance_m"],
		"event_lat":              payload["event_lat"],
		"event_lon":              payload["event_lon"],
		"closest_approach_lat":   payload["closest_approach_lat"],
		"closest_approach_lon":   payload["closest_approach_lon"],
		"closest_approach_ts":    payload["closest_approach_ts"],
		"avg_sog":                payload["avg_sog"],
		"confidence_score":       transferProbability,
		"proximity_score":        proximityScore,
		"transfer_probability":   transferProbability,
		"cargo_confidence":       payload["cargo_confidence"],
		"context_label":          payload["context_label"],
		"review_tier":            payload["review_tier"],
		"downgrade_reasons":      payload["downgrade_reasons"],
		"maritime_context":       payload["maritime_context"],
		"nearest_oil_terminal":   payload["nearest_oil_terminal"],
		"overlapping_port_calls": payload["overlapping_port_calls"],
		"crowding_vessels":       payload["crowding_vessels"],
		"tier":                   tier,
		"observed_at":            observed.UTC().Format(time.RFC3339),
		"start_ts":               startTS,
		"end_ts":                 endTS,
		"disclaimer":             disclaimer,
	}
}
