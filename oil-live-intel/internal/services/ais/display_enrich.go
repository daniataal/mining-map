package ais

import (
	"encoding/json"
	"strconv"
	"strings"
)

// EnrichLiveVesselMap merges oil_vessels registry columns and stored position raw
// AIS JSON into map-facing fields expected by the frontend vessel drawer.
func EnrichLiveVesselMap(item map[string]any, registryImo, callsign *string, registryMeta, positionRaw []byte) {
	setIfEmpty := func(key string, val any) {
		if val == nil {
			return
		}
		switch existing := item[key].(type) {
		case nil:
			item[key] = val
		case string:
			if strings.TrimSpace(existing) == "" {
				item[key] = val
			}
		case float64:
			if existing == 0 {
				item[key] = val
			}
		case int:
			if existing == 0 {
				item[key] = val
			}
		case int64:
			if existing == 0 {
				item[key] = val
			}
		case bool:
			if !existing {
				item[key] = val
			}
		default:
			item[key] = val
		}
	}

	if registryImo != nil {
		if imo := strings.TrimSpace(*registryImo); imo != "" {
			setIfEmpty("imo", imo)
		}
	}
	if callsign != nil {
		if cs := strings.TrimSpace(*callsign); cs != "" {
			setIfEmpty("call_sign", cs)
		}
	}
	if len(registryMeta) > 0 {
		var meta map[string]any
		if json.Unmarshal(registryMeta, &meta) == nil {
			setIfEmpty("ship_type_code", meta["ship_type_code"])
			setIfEmpty("ship_type_label", meta["ship_type_label"])
		}
	}

	if len(positionRaw) == 0 {
		return
	}
	var msg map[string]any
	if json.Unmarshal(positionRaw, &msg) != nil {
		return
	}
	body := aisMessageBody(msg)
	if body == nil {
		return
	}

	setIfEmpty("imo", formatIMO(first(body, "ImoNumber", "IMO")))
	setIfEmpty("call_sign", strFromAny(first(body, "CallSign")))
	setIfEmpty("raw_type", first(body, "Type", "TypeAndCargo", "ShipType"))
	setIfEmpty("ship_type_code", intFromAny(first(body, "Type", "TypeAndCargo", "ShipType")))
	setIfEmpty("ship_type_label", strFromAny(first(body, "TypeName", "ShipType")))
	setIfEmpty("destination", strFromAny(first(body, "Destination")))
	if draft, ok := floatFromAnyOptional(first(body, "MaximumStaticDraught", "Draught", "Draft")); ok {
		setIfEmpty("maximum_static_draught", draft)
		setIfEmpty("draft_m", draft)
	}
	setIfEmpty("ais_valid", body["Valid"])
	setIfEmpty("dte", body["Dte"])
	setIfEmpty("fix_type", body["FixType"])
	setIfEmpty("ais_version", body["AisVersion"])
	setIfEmpty("repeat_indicator", body["RepeatIndicator"])
	setIfEmpty("message_id", body["MessageID"])
	setIfEmpty("special_manoeuvre_indicator", body["SpecialManoeuvreIndicator"])
	setIfEmpty("assigned_mode", body["AssignedMode"])
	setIfEmpty("true_heading", intFromAny(first(body, "TrueHeading", "Heading")))
	setIfEmpty("navigational_status", intFromAny(first(body, "NavigationalStatus", "Status")))
	setIfEmpty("rate_of_turn", first(body, "RateOfTurn"))
	setIfEmpty("position_accuracy", body["PositionAccuracy"])
	setIfEmpty("raim", body["Raim"])
	setIfEmpty("communication_state", body["CommunicationState"])
	setIfEmpty("communication_state_is_itdma", body["CommunicationStateIsItdma"])
	setIfEmpty("class_b_unit", body["ClassBUnit"])
	setIfEmpty("class_b_display", body["ClassBDisplay"])
	setIfEmpty("class_b_dsc", body["ClassBDsc"])
	setIfEmpty("class_b_band", body["ClassBBand"])
	setIfEmpty("class_b_msg22", body["ClassBMsg22"])
	setIfEmpty("part_number", body["PartNumber"])

	if dim, ok := body["Dimension"].(map[string]any); ok {
		a := floatFromAny(dim["A"])
		b := floatFromAny(dim["B"])
		c := floatFromAny(dim["C"])
		d := floatFromAny(dim["D"])
		if a > 0 || b > 0 || c > 0 || d > 0 {
			dims := map[string]any{
				"to_bow":       a,
				"to_stern":     b,
				"to_port":      c,
				"to_starboard": d,
			}
			if a > 0 && b > 0 {
				dims["length_m"] = a + b
			}
			if c > 0 && d > 0 {
				dims["width_m"] = c + d
			}
			if _, exists := item["dimensions"]; !exists || item["dimensions"] == nil {
				item["dimensions"] = dims
			}
		}
	}

	if etaRaw, ok := body["Eta"].(map[string]any); ok {
		eta := map[string]any{
			"month":  etaRaw["Month"],
			"day":    etaRaw["Day"],
			"hour":   etaRaw["Hour"],
			"minute": etaRaw["Minute"],
		}
		if _, exists := item["eta"]; !exists || item["eta"] == nil {
			item["eta"] = eta
		}
	}

	if msgType, ok := msg["MessageType"].(string); ok && strings.TrimSpace(msgType) != "" {
		setIfEmpty("last_message_type", msgType)
	}
}

func aisMessageBody(msg map[string]any) map[string]any {
	bodyHolder, _ := msg["Message"].(map[string]any)
	if bodyHolder == nil {
		return nil
	}
	if msgType, ok := msg["MessageType"].(string); ok && msgType != "" {
		if body, ok := bodyHolder[msgType].(map[string]any); ok {
			return body
		}
	}
	for _, v := range bodyHolder {
		if body, ok := v.(map[string]any); ok {
			return body
		}
	}
	return nil
}

func formatIMO(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case float64:
		if t > 0 {
			return strconv.FormatInt(int64(t), 10)
		}
	case int:
		if t > 0 {
			return strconv.Itoa(t)
		}
	case int64:
		if t > 0 {
			return strconv.FormatInt(t, 10)
		}
	}
	return ""
}
