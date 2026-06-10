package shipvault

import "strings"

// VesselDetail extends registry summary with ShipVault /api/vessels/{id} fields when available.
type VesselDetail struct {
	VesselProfile
	LengthM       float64          `json:"length_m,omitempty"`
	BeamM         float64          `json:"beam_m,omitempty"`
	DepthM        float64          `json:"depth_m,omitempty"`
	DraftM        float64          `json:"draft_m,omitempty"`
	NetTonnage    float64          `json:"net_tonnage,omitempty"`
	Propulsion    string           `json:"propulsion,omitempty"`
	EnginePowerKW float64          `json:"engine_power_kw,omitempty"`
	EnginePowerHP float64          `json:"engine_power_hp,omitempty"`
	CapacityGrain float64          `json:"capacity_grain,omitempty"`
	CapacityBale  float64          `json:"capacity_bale,omitempty"`
	CapacityTEU   float64          `json:"capacity_teu,omitempty"`
	Disponent     string           `json:"disponent,omitempty"`
	Status        string           `json:"status,omitempty"`
	YardID        string           `json:"yard_id,omitempty"`
	YardName      string           `json:"yard_name,omitempty"`
	YardNumber    string           `json:"yard_number,omitempty"`
	Events        []map[string]any `json:"events,omitempty"`
	DetailRaw     map[string]any   `json:"detail_raw,omitempty"`
}

// TechnicalSpecs is the dossier-facing projection of VesselDetail + profile tonnages.
type TechnicalSpecs struct {
	BuildYear         int     `json:"build_year,omitempty"`
	VesselClass       string  `json:"vessel_class,omitempty"`
	Flag              string  `json:"flag,omitempty"`
	GrossTonnage      float64 `json:"gross_tonnage,omitempty"`
	DeadweightTons    float64 `json:"deadweight_tons,omitempty"`
	NetTonnage        float64 `json:"net_tonnage,omitempty"`
	EstimatedValueUSD float64 `json:"estimated_value_usd,omitempty"`
	LengthM           float64 `json:"length_m,omitempty"`
	BeamM             float64 `json:"beam_m,omitempty"`
	DepthM            float64 `json:"depth_m,omitempty"`
	DraftM            float64 `json:"draft_m,omitempty"`
	Propulsion        string  `json:"propulsion,omitempty"`
	EnginePowerKW     float64 `json:"engine_power_kw,omitempty"`
	EnginePowerHP     float64 `json:"engine_power_hp,omitempty"`
	CapacityGrain     float64 `json:"capacity_grain,omitempty"`
	CapacityBale      float64 `json:"capacity_bale,omitempty"`
	CapacityTEU       float64 `json:"capacity_teu,omitempty"`
	Status            string  `json:"status,omitempty"`
	Builder           string  `json:"builder,omitempty"`
	YardID            string  `json:"yard_id,omitempty"`
	YardName          string  `json:"yard_name,omitempty"`
	YardNumber        string  `json:"yard_number,omitempty"`
	Disponent         string  `json:"disponent,omitempty"`
}

func (d *VesselDetail) TechnicalSpecs() TechnicalSpecs {
	if d == nil {
		return TechnicalSpecs{}
	}
	spec := TechnicalSpecs{
		BuildYear:         d.BuildYear,
		VesselClass:       d.VesselClass,
		Flag:              d.Flag,
		GrossTonnage:      d.GrossTonnage,
		DeadweightTons:    d.DeadweightTons,
		NetTonnage:        d.NetTonnage,
		EstimatedValueUSD: d.EstimatedValueUSD,
		LengthM:           d.LengthM,
		BeamM:             d.BeamM,
		DepthM:            d.DepthM,
		DraftM:            d.DraftM,
		Propulsion:        d.Propulsion,
		EnginePowerKW:     d.EnginePowerKW,
		EnginePowerHP:     d.EnginePowerHP,
		CapacityGrain:     d.CapacityGrain,
		CapacityBale:      d.CapacityBale,
		CapacityTEU:       d.CapacityTEU,
		Status:            d.Status,
		Builder:           firstNonEmptyStr(d.YardName, d.Builder),
		YardID:            d.YardID,
		YardName:          d.YardName,
		YardNumber:        d.YardNumber,
		Disponent:         d.Disponent,
	}
	return spec
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func parseVesselDetail(raw map[string]any, imo string) *VesselDetail {
	if raw == nil {
		return nil
	}
	base := parseVesselProfile(raw, imo)
	d := &VesselDetail{VesselProfile: *base, DetailRaw: raw}
	d.LengthM = floatField(raw, "length", "length_m", "lengthM", "loa", "length_overall", "lengthOverall")
	d.BeamM = floatField(raw, "beam", "beam_m", "beamM", "breadth", "width_m", "widthM", "breadth_m", "breadthM")
	d.DepthM = floatField(raw, "depth", "depth_m", "depthM", "moulded_depth", "mouldedDepth")
	d.DraftM = floatField(raw, "draft", "draft_m", "draftM", "summer_draft", "summerDraft", "draught")
	d.NetTonnage = floatField(raw, "net_tonnage", "netTonnage", "nt", "nrt")
	d.Propulsion = strField(raw, "propulsion", "main_engine", "mainEngine", "engine_type", "engineType", "propulsion_type", "propulsionType")
	d.EnginePowerKW = floatField(raw, "engine_power", "enginePower", "power_kw", "powerKw", "engine_power_kw", "enginePowerKw", "main_engine_power_kw", "mainEnginePowerKw")
	d.EnginePowerHP = floatField(raw, "engine_power_hp", "enginePowerHp", "power_hp", "powerHp", "horsepower", "hp", "main_engine_power_hp", "mainEnginePowerHp")
	if d.EnginePowerKW == 0 && d.EnginePowerHP > 0 {
		d.EnginePowerKW = d.EnginePowerHP * 0.7457
	} else if d.EnginePowerHP == 0 && d.EnginePowerKW > 0 {
		d.EnginePowerHP = d.EnginePowerKW / 0.7457
	}
	d.CapacityGrain = floatField(raw, "grain", "grain_capacity", "grainCapacity", "capacity_grain", "capacityGrain")
	d.CapacityBale = floatField(raw, "bale", "bale_capacity", "baleCapacity", "capacity_bale", "capacityBale")
	d.CapacityTEU = floatField(raw, "teu", "teu_capacity", "teuCapacity", "capacity_teu", "capacityTeu", "container_teu", "containerTeu")
	d.Disponent = strField(raw, "disponent", "disponent_name", "disponentName", "commercial_operator", "commercialOperator")
	if d.Disponent == "" {
		d.Disponent = strings.TrimSpace(d.OperatorName)
	}
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
