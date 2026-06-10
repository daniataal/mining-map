package shipvault

import "strings"

// VesselDetail extends registry summary with ShipVault /api/vessels/{id} fields when available.
type VesselDetail struct {
	VesselProfile
	LengthM       float64          `json:"length_m,omitempty"`
	BeamM         float64          `json:"beam_m,omitempty"`
	DepthM        float64          `json:"depth_m,omitempty"`
	NetTonnage    float64          `json:"net_tonnage,omitempty"`
	Propulsion    string           `json:"propulsion,omitempty"`
	EnginePowerKW float64          `json:"engine_power_kw,omitempty"`
	Status        string           `json:"status,omitempty"`
	YardID        string           `json:"yard_id,omitempty"`
	YardName      string           `json:"yard_name,omitempty"`
	YardNumber    string           `json:"yard_number,omitempty"`
	Events        []map[string]any `json:"events,omitempty"`
	DetailRaw     map[string]any   `json:"detail_raw,omitempty"`
}

func parseVesselDetail(raw map[string]any, imo string) *VesselDetail {
	if raw == nil {
		return nil
	}
	base := parseVesselProfile(raw, imo)
	d := &VesselDetail{VesselProfile: *base, DetailRaw: raw}
	d.LengthM = floatField(raw, "length", "length_m", "lengthM", "loa", "length_overall")
	d.BeamM = floatField(raw, "beam", "beam_m", "beamM", "breadth", "width_m", "widthM")
	d.DepthM = floatField(raw, "depth", "depth_m", "depthM")
	d.NetTonnage = floatField(raw, "net_tonnage", "netTonnage", "nt")
	d.Propulsion = strField(raw, "propulsion", "main_engine", "mainEngine", "engine_type", "engineType")
	d.EnginePowerKW = floatField(raw, "engine_power", "enginePower", "power_kw", "powerKw")
	d.Status = strField(raw, "status", "vessel_status", "vesselStatus")
	d.YardID = strField(raw, "yard_id", "yardId", "shipyard_id", "shipyardId", "builder_id", "builderId")
	d.YardName = strField(raw, "yard", "shipyard", "builder", "shipbuilder", "shipBuilder")
	d.YardNumber = strField(raw, "yard_no", "yardNo", "yard_number", "yardNumber", "hull_no", "hullNo")
	if d.YardName == "" {
		d.YardName = d.Builder
	}
	if hist := sliceField(raw, "events", "history", "vessel_events", "vesselEvents"); hist != nil {
		for _, item := range hist {
			if m, ok := item.(map[string]any); ok {
				d.Events = append(d.Events, m)
			}
		}
	}
	mergeNameHistoryFromEvents(&d.VesselProfile, d.Events)
	return d
}

func mergeNameHistoryFromEvents(v *VesselProfile, events []map[string]any) {
	if v == nil || len(events) == 0 {
		return
	}
	seen := make(map[string]struct{}, len(v.NameHistory))
	for _, e := range v.NameHistory {
		seen[e.Name] = struct{}{}
	}
	for _, ev := range events {
		kind := stringsLower(strField(ev, "type", "event_type", "eventType", "category"))
		if kind != "" && kind != "name" && kind != "rename" && !stringsContains(kind, "name") {
			continue
		}
		name := strField(ev, "name", "vessel_name", "vesselName", "new_name", "newName", "value")
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		v.NameHistory = append(v.NameHistory, NameHistoryEntry{
			Name:      name,
			FromDate:  strField(ev, "from", "from_date", "start_date", "date", "effective_date"),
			ToDate:    strField(ev, "to", "to_date", "end_date"),
			Disponent: strField(ev, "disponent", "disponent_name", "disponentName", "operator", "company"),
		})
	}
}

func stringsLower(s string) string {
	return strings.TrimSpace(strings.ToLower(s))
}

func stringsContains(hay, needle string) bool {
	return strings.Contains(hay, needle)
}
