package ais

import (
	"testing"
)

const parianTraderRaw = `{"Message": {"ShipStaticData": {"Dte": false, "Eta": {"Day": 31, "Hour": 6, "Month": 5, "Minute": 0}, "Name": "PARIAN TRADER       ", "Type": 80, "Spare": false, "Valid": true, "UserID": 636025453, "FixType": 1, "CallSign": "5LXN5  ", "Dimension": {"A": 149, "B": 34, "C": 21, "D": 11}, "ImoNumber": 1056006, "MessageID": 5, "AisVersion": 2, "Destination": "FR LRH              ", "RepeatIndicator": 0, "MaximumStaticDraught": 12.1}}, "MetaData": {"MMSI": 636025453, "ShipName": "PARIAN TRADER       ", "latitude": 46.15833, "time_utc": "2026-05-31 08:50:34.164359521 +0000 UTC", "longitude": -1.24203, "MMSI_String": 636025453}, "MessageType": "ShipStaticData"}`

func TestEnrichLiveVesselMapFromParianTraderRaw(t *testing.T) {
	item := map[string]any{
		"mmsi":        int64(636025453),
		"name":        "PARIAN TRADER",
		"destination": "FR LRH",
		"draft_m":     12.1,
	}
	callsign := "5LXN5"
	meta := []byte(`{"ship_type_code": 80, "ship_type_label": ""}`)

	EnrichLiveVesselMap(item, nil, &callsign, meta, []byte(parianTraderRaw))

	if got, _ := item["imo"].(string); got != "1056006" {
		t.Fatalf("imo = %q, want 1056006", got)
	}
	if got, _ := item["call_sign"].(string); got != "5LXN5" {
		t.Fatalf("call_sign = %q, want 5LXN5", got)
	}
	if got := intFromAny(item["ship_type_code"]); got != 80 {
		t.Fatalf("ship_type_code = %v, want 80", item["ship_type_code"])
	}
	if got, _ := item["ais_valid"].(bool); !got {
		t.Fatalf("ais_valid = %v, want true", item["ais_valid"])
	}
	if got, _ := item["dte"].(bool); got {
		t.Fatalf("dte = %v, want false", item["dte"])
	}
	dims, ok := item["dimensions"].(map[string]any)
	if !ok {
		t.Fatalf("dimensions missing: %#v", item["dimensions"])
	}
	if dims["length_m"].(float64) != 183 {
		t.Fatalf("length_m = %v, want 183", dims["length_m"])
	}
	if dims["width_m"].(float64) != 32 {
		t.Fatalf("width_m = %v, want 32", dims["width_m"])
	}
	eta, ok := item["eta"].(map[string]any)
	if !ok {
		t.Fatalf("eta missing")
	}
	if eta["day"].(float64) != 31 {
		t.Fatalf("eta day = %v", eta["day"])
	}
}

func TestStrFromAnyNumericIMO(t *testing.T) {
	if got := strFromAny(float64(1056006)); got != "1056006" {
		t.Fatalf("strFromAny(float64) = %q", got)
	}
}

func TestParseMessageNumericIMO(t *testing.T) {
	u, ok := ParseMessage([]byte(parianTraderRaw))
	if !ok {
		t.Fatal("ParseMessage failed")
	}
	if u.IMO != "1056006" {
		t.Fatalf("IMO = %q, want 1056006", u.IMO)
	}
}
