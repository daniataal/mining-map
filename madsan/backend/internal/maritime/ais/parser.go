package ais

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

const StreamURL = "wss://stream.aisstream.io/v0/stream"

// Update is a normalized AIS observation from AISStream.
type Update struct {
	MMSI          int64
	IMO           string
	Name          string
	Callsign      string
	ShipTypeCode  int
	ShipTypeLabel string
	Lat           float64
	Lon           float64
	Speed         float64
	Course        float64
	Heading       float64
	NavStatus     string
	DraftM        float64
	Destination   string
	ETA           string
	HasDraft      bool
	Raw           map[string]any
	Timestamp     time.Time
	MessageType   string
	HasKinematics bool
}

func ParseMessage(raw []byte) (*Update, bool) {
	var msg map[string]any
	if err := json.Unmarshal(raw, &msg); err != nil {
		return nil, false
	}
	meta, _ := msg["MetaData"].(map[string]any)
	if meta == nil {
		meta, _ = msg["Metadata"].(map[string]any)
	}
	bodyHolder, _ := msg["Message"].(map[string]any)
	if bodyHolder == nil {
		return nil, false
	}
	msgType, _ := msg["MessageType"].(string)
	body, _ := bodyHolder[msgType].(map[string]any)
	if body == nil {
		for _, v := range bodyHolder {
			body, _ = v.(map[string]any)
			break
		}
	}
	if body == nil {
		body = map[string]any{}
	}

	mmsi := intFromAny(first(meta, "MMSI"), first(body, "UserID", "MMSI"))
	if mmsi <= 0 {
		return nil, false
	}

	lat := floatFromAny(first(body, "Latitude", "Lat"))
	lon := floatFromAny(first(body, "Longitude", "Lon", "Lng"))
	// MetaData lat/lon on ShipStaticData is often a stale coastal-receiver cache (e.g. last
	// Mediterranean fix while the vessel is elsewhere). Only trust MetaData for kinematics types.
	if lat == 0 && lon == 0 && HasPositionKinematics(msgType) {
		lat = floatFromAny(first(meta, "latitude", "lat"))
		lon = floatFromAny(first(meta, "longitude", "lon"))
	}
	hasPosition := lat != 0 || lon != 0
	if !hasPosition && !isVoyageOnlyMessage(msgType) {
		return nil, false
	}

	shipType := int(intFromAny(first(body, "Type", "TypeAndCargo", "ShipType")))
	draft, hasDraft := floatFromAnyOptional(first(body, "MaximumStaticDraught", "Draught", "Draft"))

	hasKinematics := HasPositionKinematics(msgType)

	return &Update{
		MMSI:          mmsi,
		IMO:           strFromAny(first(body, "ImoNumber", "IMO")),
		Name:          strFromAny(first(meta, "ShipName", "VesselName"), first(body, "Name")),
		Callsign:      strFromAny(first(body, "CallSign")),
		ShipTypeCode:  shipType,
		ShipTypeLabel: strFromAny(first(body, "TypeName", "ShipType")),
		Lat:           lat,
		Lon:           lon,
		Speed:         floatFromAny(first(body, "Sog", "SpeedOverGround")),
		Course:        floatFromAny(first(body, "Cog", "CourseOverGround")),
		Heading:       floatFromAny(first(body, "Heading", "TrueHeading")),
		NavStatus:     strFromAny(first(body, "NavigationalStatus", "Status")),
		DraftM:        draft,
		HasDraft:      hasDraft,
		Destination:   strFromAny(first(body, "Destination")),
		ETA:           strFromAny(first(body, "Eta", "ETA")),
		Raw:           msg,
		Timestamp:     time.Now().UTC(),
		MessageType:   msgType,
		HasKinematics: hasKinematics,
	}, true
}

func first(m map[string]any, keys ...string) any {
	if m == nil {
		return nil
	}
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

func intFromAny(v any, extra ...any) int64 {
	for _, item := range append([]any{v}, extra...) {
		switch t := item.(type) {
		case float64:
			return int64(t)
		case int:
			return int64(t)
		case int64:
			return t
		case string:
			n, _ := strconv.ParseInt(strings.TrimSpace(t), 10, 64)
			if n > 0 {
				return n
			}
		}
	}
	return 0
}

func floatFromAny(v any, extra ...any) float64 {
	for _, item := range append([]any{v}, extra...) {
		switch t := item.(type) {
		case float64:
			return t
		case int:
			return float64(t)
		case string:
			f, _ := strconv.ParseFloat(strings.TrimSpace(t), 64)
			return f
		}
	}
	return 0
}

func floatFromAnyOptional(v any) (float64, bool) {
	if v == nil {
		return 0, false
	}
	f := floatFromAny(v)
	return f, f > 0
}

func isVoyageOnlyMessage(msgType string) bool {
	return msgType == "ShipStaticData"
}

func strFromAny(values ...any) string {
	for _, v := range values {
		switch t := v.(type) {
		case string:
			if strings.TrimSpace(t) != "" {
				return strings.TrimSpace(t)
			}
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
	}
	return ""
}
