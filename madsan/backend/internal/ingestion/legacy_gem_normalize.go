package ingestion

import (
	"fmt"
	"regexp"
	"strings"
)

var gemWhitespaceRE = regexp.MustCompile(`\s+`)

func gemCleanText(v any) string {
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "" || s == "<nil>" || strings.EqualFold(s, "nan") {
		return ""
	}
	return gemWhitespaceRE.ReplaceAllString(s, " ")
}

func gemParseCoord(v any) (float64, bool) {
	s := gemCleanText(v)
	if s == "" {
		return 0, false
	}
	s = strings.ReplaceAll(s, ",", "")
	var f float64
	if _, err := fmt.Sscanf(s, "%f", &f); err != nil {
		return 0, false
	}
	return f, true
}

func gemParseLatLng(latRaw, lngRaw any) (*float64, *float64) {
	lat, okLat := gemParseCoord(latRaw)
	lng, okLng := gemParseCoord(lngRaw)
	if !okLat || !okLng {
		return nil, nil
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return nil, nil
	}
	if lat == 0 && lng == 0 {
		return nil, nil
	}
	return &lat, &lng
}

func gemExtractionDedupKey(unitID, country string) string {
	return strings.ToLower(strings.TrimSpace(unitID)) + "|" + strings.ToUpper(strings.TrimSpace(country))
}

func gemPlantDedupKey(gemUnitID string) string {
	return strings.ToLower(strings.TrimSpace(gemUnitID))
}

func gemPipelineDedupKey(projectID string, rowIndex int, segmentName string) string {
	projectID = strings.TrimSpace(projectID)
	segmentName = strings.ToLower(gemWhitespaceRE.ReplaceAllString(strings.TrimSpace(segmentName), "_"))
	if segmentName != "" {
		return fmt.Sprintf("%s:%d:%s", projectID, rowIndex, segmentName)
	}
	return fmt.Sprintf("%s:%d", projectID, rowIndex)
}

func gemExtractionCompany(row map[string]string) string {
	for _, key := range []string{"Operator", "Owner(s)", "Parent(s)", "Unit Name"} {
		if v := gemCleanText(row[key]); v != "" {
			return normalizeName(v)
		}
	}
	if id := gemCleanText(row["Unit ID"]); id != "" {
		return normalizeName(id)
	}
	return ""
}

func gemPlantDisplayName(row map[string]string) string {
	if v := gemCleanText(row["Unit name"]); v != "" {
		return normalizeName(v)
	}
	if v := gemCleanText(row["Plant name"]); v != "" {
		return normalizeName(v)
	}
	if id := gemCleanText(row["GEM unit ID"]); id != "" {
		return normalizeName(id)
	}
	return ""
}

func gemPipelineDisplayName(row map[string]string) string {
	segment := gemCleanText(row["SegmentName"])
	pipeline := gemCleanText(row["PipelineName"])
	switch {
	case segment != "" && pipeline != "":
		return normalizeName(pipeline + " — " + segment)
	case pipeline != "":
		return normalizeName(pipeline)
	case segment != "":
		return normalizeName(segment)
	default:
		return normalizeName(gemCleanText(row["ProjectID"]))
	}
}

func gemAssetTypeFromFuel(fuel string) string {
	f := strings.ToLower(fuel)
	switch {
	case strings.Contains(f, "pipeline"), strings.Contains(f, "ngl"):
		return "pipeline"
	case strings.Contains(f, "lng"):
		return "terminal"
	case strings.Contains(f, "refin"):
		return "refinery"
	default:
		return "processing_plant"
	}
}

func gemCountryCode(country string) string {
	return strings.ToUpper(strings.TrimSpace(country))
}
