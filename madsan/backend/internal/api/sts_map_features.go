package api

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

func stsEventKind(payload map[string]any) string {
	if src, _ := payload["source"].(string); src == "legacy_import" {
		return "historic"
	}
	if payload["legacy_sts_id"] != nil && fmtStr(payload["legacy_sts_id"]) != "" {
		return "historic"
	}
	if det, _ := payload["detector"].(string); det == "ais_proximity_v1" {
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

func stsFeatureID(signalID uuid.UUID, payload map[string]any) string {
	if key := fmtStr(payload["sts_pair_key"]); key != "" {
		return key
	}
	if legacy := fmtStr(payload["legacy_sts_id"]); legacy != "" && legacy != "<nil>" {
		return "legacy:" + legacy
	}
	return signalID.String()
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

	disclaimer := fmtStr(payload["disclaimer"])
	if disclaimer == "" {
		if kind == "historic" {
			disclaimer = "Historic STS record from legacy AIS proximity pipeline — not verified cargo transfer or product grade."
		} else {
			disclaimer = "AIS proximity inference — not verified cargo transfer or product grade."
		}
	}

	return map[string]any{
		"signal_id":        signalID.String(),
		"name":             title,
		"event_kind":       kind,
		"event_title":      title,
		"mmsi_a":           mmsiA,
		"mmsi_b":           mmsiB,
		"vessel_a_name":    nameA,
		"vessel_b_name":    nameB,
		"vessel_a_class":   classA,
		"vessel_b_class":   classB,
		"product_hint":     product,
		"zone_name":        payload["zone_name"],
		"min_distance_m":   payload["min_distance_m"],
		"avg_sog":          payload["avg_sog"],
		"confidence_score": score,
		"tier":             tier,
		"observed_at":      observed.UTC().Format(time.RFC3339),
		"start_ts":         startTS,
		"end_ts":           endTS,
		"disclaimer":       disclaimer,
	}
}
