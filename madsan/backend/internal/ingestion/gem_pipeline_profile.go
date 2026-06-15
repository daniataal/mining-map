package ingestion

import (
	"fmt"
	"strings"
)

// BuildGEMPipelineProfile flattens GEM GOIT pipeline attributes for dossier summary.
func BuildGEMPipelineProfile(raw map[string]any, tags map[string]any) map[string]string {
	if raw == nil && tags == nil {
		return nil
	}
	out := map[string]string{}

	set := func(dst, val string) {
		val = strings.TrimSpace(val)
		if val == "" || val == "--" || val == "<nil>" {
			return
		}
		if dst == "parent_company" && isGEMUnknownCommercialName(val) {
			return
		}
		out[dst] = val
	}

	commercial := parseGEMPipelineCommercial(raw, tags)
	if commercial.OwnerName != "" {
		set("owner", commercial.OwnerName)
	}
	if commercial.ParentName != "" {
		set("parent_company", commercial.ParentName)
	}
	set("status", commercial.Status)
	if commercial.Status == "" {
		set("status", gemFieldString(raw, tags, "Status", "status"))
	}
	set("fuel", commercial.Fuel)
	set("fuel_source", gemFieldString(raw, tags, "FuelSource", "fuel_source"))
	if commercial.CapacityText != "" {
		set("capacity_text", commercial.CapacityText)
	}
	if commercial.LengthKm != nil {
		set("length_km", fmt.Sprintf("%g", *commercial.LengthKm))
	} else {
		for _, key := range []string{"LengthMergedKm", "LengthKnownKm", "LengthEstimateKm"} {
			if v := gemFieldString(raw, tags, key); v != "" {
				set("length_km", v)
				break
			}
		}
	}
	if commercial.Diameter != "" {
		d := commercial.Diameter
		if commercial.DiameterUnits != "" {
			d += " " + commercial.DiameterUnits
		}
		set("diameter", d)
	}
	set("wiki_url", commercial.WikiURL)
	set("gem_owner_entity_ids", commercial.OwnerEntityIDs)
	set("project_id", commercial.ProjectID)
	set("segment_key", commercial.SegmentKey)
	set("countries", commercial.Countries)

	set("proposal_year", gemFieldString(raw, tags, "ProposalYear", "proposal_year"))
	set("construction_year", gemFieldString(raw, tags, "ConstructionYear", "construction_year"))
	set("start_years", gemJoinStartYears(raw, tags))
	set("cancelled_year", gemFieldString(raw, tags, "CancelledYear", "cancelled_year"))
	set("stop_year", gemFieldString(raw, tags, "StopYear", "stop_year"))
	set("shelved_year", gemFieldString(raw, tags, "ShelvedYear", "shelved_year"))
	set("gem_last_updated", gemFieldString(raw, tags, "LastUpdated", "last_updated"))

	delayType := gemFieldString(raw, tags, "DelayType", "delay_type")
	if delayType != "" {
		set("delay_type", delayType)
		if note := gemDelayNote(out["status"], delayType); note != "" {
			set("delay_note", note)
		}
	}

	set("start_location", gemFieldString(raw, tags, "StartLocation", "start_location"))
	set("start_country", gemFieldString(raw, tags, "StartCountry", "start_country"))
	set("start_sub_region", gemFieldString(raw, tags, "StartSubRegion", "start_sub_region"))
	set("start_region", gemFieldString(raw, tags, "StartRegion", "start_region"))
	set("end_location", gemFieldString(raw, tags, "EndLocation", "end_location"))
	set("end_country", gemFieldString(raw, tags, "EndCountry", "end_country"))
	set("end_sub_region", gemFieldString(raw, tags, "EndSubRegion", "end_sub_region"))
	set("end_region", gemFieldString(raw, tags, "EndRegion", "end_region"))

	set("cost", gemFormatCost(raw, tags))
	set("language", gemFieldString(raw, tags, "OtherLanguagePrimaryPipelineName", "other_language_name"))
	set("data_source", gemFieldString(raw, tags, "source_name"))
	set("source_url", gemFieldString(raw, tags, "source_url"))

	applyGEMPipelineCuratedCorrections(out, commercial.SegmentKey, commercial.ProjectID)

	return out
}

func gemJoinStartYears(raw map[string]any, tags map[string]any) string {
	seen := map[string]bool{}
	var years []string
	for _, key := range []string{"StartYear1", "StartYear2", "StartYear3"} {
		y := strings.TrimSpace(gemFieldString(raw, tags, key))
		if y == "" || y == "--" || seen[y] {
			continue
		}
		seen[y] = true
		years = append(years, y)
	}
	return strings.Join(years, ", ")
}

func gemDelayNote(status, delayType string) string {
	delayType = strings.TrimSpace(delayType)
	if delayType == "" || delayType == "--" {
		return ""
	}
	st := strings.ToLower(strings.TrimSpace(status))
	if st == "operating" || st == "operational" {
		return fmt.Sprintf("Operating pipeline; GEM records a %s construction/start delay (classification only — cause not specified in GOIT)", delayType)
	}
	return fmt.Sprintf("GEM delay classification: %s", delayType)
}

func gemFormatCost(raw map[string]any, tags map[string]any) string {
	cost := gemFieldString(raw, tags, "Cost")
	units := gemFieldString(raw, tags, "CostUnits")
	if cost != "" && cost != "--" {
		if units != "" && units != "--" {
			return cost + " " + units
		}
		return cost
	}
	usd := gemFieldString(raw, tags, "CostUSD")
	euro := gemFieldString(raw, tags, "CostEuro")
	if usd == "--" {
		usd = ""
	}
	if euro == "--" {
		euro = ""
	}
	switch {
	case usd != "" && euro != "":
		return usd + " USD; " + euro + " EUR"
	case usd != "":
		return usd + " USD"
	case euro != "":
		return euro + " EUR"
	}
	return ""
}
