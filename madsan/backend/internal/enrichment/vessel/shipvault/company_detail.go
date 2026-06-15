package shipvault

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// CompanyDetail is a structured ShipVault company page (profile + fleet aggregates).
type CompanyDetail struct {
	ShipVaultCompanyID string         `json:"shipvault_company_id"`
	Name               string         `json:"name"`
	Country            string         `json:"country,omitempty"`
	City               string         `json:"city,omitempty"`
	ParentName         string         `json:"parent_name,omitempty"`
	ParentID           string         `json:"parent_company_id,omitempty"`
	FleetSize          int            `json:"fleet_size"`
	TotalDWT           float64        `json:"total_dwt,omitempty"`
	TotalGT            float64        `json:"total_gt,omitempty"`
	AvgAgeYears        float64        `json:"avg_age_years,omitempty"`
	Fleet              []FleetVessel  `json:"fleet,omitempty"`
	Raw                map[string]any `json:"raw,omitempty"`
}

// FleetVessel is one row in a company or yard fleet table.
type FleetVessel struct {
	IMO         string  `json:"imo"`
	MMSI        string  `json:"mmsi,omitempty"`
	Name        string  `json:"name"`
	Type        string  `json:"type,omitempty"`
	DWT         float64 `json:"dwt,omitempty"`
	GT          float64 `json:"gt,omitempty"`
	Built       int     `json:"built,omitempty"`
	Yard        string  `json:"yard,omitempty"`
	YardNumber  string  `json:"yard_number,omitempty"`
	ShipVaultID string  `json:"shipvault_vessel_id,omitempty"`
}

// LoadCompanyDetail fetches company profile and fleet from ShipVault.
func (s *Service) LoadCompanyDetail(ctx context.Context, companyID string) (*CompanyDetail, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, fmt.Errorf("empty company id")
	}
	companyRaw, err := s.GetCompany(ctx, companyID)
	if err != nil {
		return nil, err
	}
	fleet, _ := s.GetFleet(ctx, companyID)
	return parseCompanyDetail(companyRaw, companyID, fleet), nil
}

// SearchCompanyByName resolves a ShipVault company id from an owner/display name.
func (s *Service) SearchCompanyByName(ctx context.Context, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("empty company name")
	}
	path := fmt.Sprintf("/api/companies/search/%s?page=1&pageSize=50", url.PathEscape(name))
	var raw json.RawMessage
	if err := s.doRequest(ctx, path, &raw); err != nil {
		return "", fmt.Errorf("shipvault 404: company not found for name %q", name)
	}
	resp := parseShipSearchPayload(raw)
	if id := pickCompanySearchResult(resp.vesselRows(), name); id != "" {
		return id, nil
	}
	return "", fmt.Errorf("shipvault 404: company not found for name %q", name)
}

func normalizeCompanyName(name string) string {
	name = strings.ToUpper(strings.TrimSpace(name))
	replacer := strings.NewReplacer(".", " ", ",", " ", "-", " ", "&", " AND ", "(", " ", ")", " ")
	name = replacer.Replace(name)
	name = strings.Join(strings.Fields(name), " ")
	legalSuffixes := []string{
		" PRIVATE LIMITED", " PVT LTD", " PTE LTD", " LIMITED", " LTD",
		" INCORPORATED", " INC", " PLC", " LLC", " GMBH", " BV", " SA",
	}
	for {
		trimmed := false
		for _, suf := range legalSuffixes {
			if strings.HasSuffix(name, suf) {
				name = strings.TrimSpace(strings.TrimSuffix(name, suf))
				trimmed = true
				break
			}
		}
		if !trimmed {
			break
		}
	}
	return name
}

func companyNameMatchScore(queryNorm, rowNorm string) int {
	if queryNorm == "" || rowNorm == "" {
		return 0
	}
	switch {
	case queryNorm == rowNorm:
		return 100
	case strings.HasPrefix(rowNorm, queryNorm) || strings.HasPrefix(queryNorm, rowNorm):
		return 80
	case strings.Contains(rowNorm, queryNorm) || strings.Contains(queryNorm, rowNorm):
		return 60
	default:
		return 0
	}
}

func pickCompanySearchResult(rows []map[string]any, query string) string {
	query = strings.TrimSpace(query)
	if query == "" || len(rows) == 0 {
		return ""
	}
	queryNorm := normalizeCompanyName(query)
	bestID := ""
	bestScore := 0
	bestNameLen := 0
	for _, row := range rows {
		if row == nil {
			continue
		}
		id := strField(row, "companyid", "companyId", "id", "company_id", "_id")
		if id == "" {
			continue
		}
		score := 0
		nameLen := 0
		for _, n := range []string{
			strField(row, "company1", "company_name", "companyName", "name"),
			strField(row, "callname", "parent", "parentname", "parentName"),
		} {
			if n == "" {
				continue
			}
			norm := normalizeCompanyName(n)
			if sc := companyNameMatchScore(queryNorm, norm); sc > score || (sc == score && sc > 0 && len(norm) > nameLen) {
				score = sc
				nameLen = len(norm)
			}
		}
		if score > bestScore || (score == bestScore && score > 0 && nameLen > bestNameLen) {
			bestScore = score
			bestNameLen = nameLen
			bestID = id
		}
	}
	if bestID != "" {
		return bestID
	}
	for _, row := range rows {
		if row == nil {
			continue
		}
		if id := strField(row, "companyid", "companyId", "id", "company_id", "_id"); id != "" {
			return id
		}
	}
	return ""
}

// ResolveCompanyID returns an explicit id or searches by owner name.
func (s *Service) ResolveCompanyID(ctx context.Context, companyID, ownerName string) (string, error) {
	if strings.TrimSpace(companyID) != "" {
		return strings.TrimSpace(companyID), nil
	}
	if strings.TrimSpace(ownerName) == "" {
		return "", fmt.Errorf("company id or owner name required")
	}
	return s.SearchCompanyByName(ctx, ownerName)
}

func parseCompanyDetail(raw map[string]any, companyID string, fleetRaw []map[string]any) *CompanyDetail {
	if raw == nil && len(fleetRaw) == 0 {
		return nil
	}
	c := &CompanyDetail{ShipVaultCompanyID: companyID, Raw: raw}
	if raw != nil {
		c.Name = strField(raw, "company1", "name", "company_name", "companyName", "callname")
		c.Country = strField(raw, "country", "country_code", "countryCode", "flag")
		c.City = strField(raw, "city", "location", "address")
		c.ParentID = strField(raw, "parent_id", "parentId", "parent_company_id", "parentCompanyId")
		c.ParentName = strField(raw, "parent_name", "parentName", "parent", "parent_company", "parentCompany")
		if parentObj, ok := raw["parent"].(map[string]any); ok {
			if c.ParentID == "" {
				c.ParentID = strField(parentObj, "id", "company_id", "companyId")
			}
			if c.ParentName == "" {
				c.ParentName = strField(parentObj, "name", "company_name", "companyName")
			}
		}
		c.FleetSize = intField(raw, "fleet_size", "fleet_count", "total_vessels", "vesselCount", "vessels")
		c.TotalDWT = floatField(raw, "total_dwt", "totalDwt", "dwt", "fleet_dwt", "fleetDwt")
		c.TotalGT = floatField(raw, "total_gt", "totalGt", "gt", "fleet_gt", "fleetGt")
		c.AvgAgeYears = floatField(raw, "avg_age", "avgAge", "average_age", "averageAge")
	}
	for _, f := range fleetRaw {
		if f == nil {
			continue
		}
		row := parseFleetVessel(f)
		if row.IMO != "" || row.Name != "" {
			c.Fleet = append(c.Fleet, row)
		}
	}
	if c.FleetSize == 0 && len(c.Fleet) > 0 {
		c.FleetSize = len(c.Fleet)
	}
	aggregateFleetTotals(c)
	return c
}

func aggregateFleetTotals(c *CompanyDetail) {
	if c == nil {
		return
	}
	var sumDWT, sumGT float64
	var ageSum float64
	var ageN int
	yearNow := currentYear()
	for _, v := range c.Fleet {
		sumDWT += v.DWT
		sumGT += v.GT
		if v.Built > 1900 && v.Built <= yearNow {
			ageSum += float64(yearNow - v.Built)
			ageN++
		}
	}
	if c.TotalDWT == 0 && sumDWT > 0 {
		c.TotalDWT = sumDWT
	}
	if c.TotalGT == 0 && sumGT > 0 {
		c.TotalGT = sumGT
	}
	if c.AvgAgeYears == 0 && ageN > 0 {
		c.AvgAgeYears = ageSum / float64(ageN)
	}
}

func parseFleetVessel(f map[string]any) FleetVessel {
	name := strField(f, "name", "vessel_name", "vesselName", "parentname", "parentName")
	if unit := strField(f, "unit1", "unit"); unit != "" && name != "" &&
		!strings.HasPrefix(strings.ToUpper(name), strings.ToUpper(unit+" ")) {
		name = strings.TrimSpace(unit + " " + name)
	}
	v := FleetVessel{
		IMO:         imoString(f, "imo", "IMO"),
		MMSI:        strField(f, "mmsi", "MMSI"),
		Name:        name,
		Type:        strField(f, "typename", "typeName", "type", "vessel_type", "vesselType", "groupname", "groupName", "ship_type", "shipType"),
		DWT:         floatField(f, "dwt", "deadweight", "deadweight_tons", "deadweightTons", "tdw"),
		GT:          floatField(f, "gt", "gross_tonnage", "grossTonnage"),
		Built:       intField(f, "built", "year_built", "build_year", "yearBuilt"),
		Yard:        strField(f, "yard", "shipyard", "builder", "shipbuilder", "shipBuilder"),
		YardNumber:  strField(f, "yard_no", "yardNo", "yard_number", "yardNumber", "hull_no", "hullNo"),
		ShipVaultID: strField(f, "unitid", "unitId", "id", "vessel_id", "unit_id", "parentid", "parentId"),
	}
	if v.Name == "" {
		v.Name = strField(f, "parentname", "parentName")
	}
	return v
}

// LoadVesselDetail loads shipsearch summary, always merges /api/vessels/{id} when an id is known,
// and falls back to MMSI then vessel name when IMO shipsearch returns 404.
func (s *Service) LoadVesselDetail(ctx context.Context, imo, vesselID, mmsi, name string) (*VesselDetail, error) {
	imo = strings.TrimSpace(imo)
	mmsi = strings.TrimSpace(mmsi)
	name = strings.TrimSpace(name)
	vesselID = strings.TrimSpace(vesselID)
	if imo == "" && vesselID == "" && mmsi == "" && name == "" {
		return nil, fmt.Errorf("imo, vessel id, mmsi, or name required")
	}

	inputIMO := imo
	var raw map[string]any
	var err error
	lookupSource := "imo"
	var explicitMMSI bool
	if imo != "" {
		raw, err = s.GetVesselByIMO(ctx, imo)
	}
	if err != nil && isShipvaultNotFound(err) && mmsi != "" {
		raw, explicitMMSI, err = s.GetVesselByMMSI(ctx, mmsi, inputIMO)
		lookupSource = "mmsi"
	}
	if err != nil && isShipvaultNotFound(err) && name != "" {
		var nameAmbiguous bool
		raw, nameAmbiguous, err = s.GetVesselByName(ctx, name, inputIMO)
		lookupSource = "name"
		if nameAmbiguous {
			s.log.Warn().Str("imo", inputIMO).Str("name", name).Msg("ambiguous shipsearch name match")
		}
	}
	if err != nil {
		return nil, err
	}
	if inputIMO != "" {
		gotIMO := imoString(raw, "imo", "IMO")
		if gotIMO != "" && !imosEqual(inputIMO, gotIMO) {
			if explicitMMSI {
				s.log.Warn().
					Str("input_imo", inputIMO).Str("registry_imo", gotIMO).Str("mmsi", mmsi).
					Msg("registry IMO differs from AIS IMO after explicit MMSI match")
			} else if lookupSource == "imo" && mmsi != "" {
				raw2, mmsiHit, err2 := s.GetVesselByMMSI(ctx, mmsi, inputIMO)
				if err2 == nil && raw2 != nil {
					raw = raw2
					lookupSource = "mmsi"
					explicitMMSI = mmsiHit
					gotIMO = imoString(raw, "imo", "IMO")
					if gotIMO != "" && !imosEqual(inputIMO, gotIMO) && !explicitMMSI {
						return nil, fmt.Errorf("shipvault imo mismatch: expected %s got %s", inputIMO, gotIMO)
					}
				} else {
					return nil, fmt.Errorf("shipvault imo mismatch: expected %s got %s", inputIMO, gotIMO)
				}
			} else {
				return nil, fmt.Errorf("shipvault imo mismatch: expected %s got %s", inputIMO, gotIMO)
			}
		}
	}
	if vesselID == "" && raw != nil {
		vesselID = strField(raw, "id", "vessel_id", "unit_id", "parentid", "parentId", "unitid", "unitId")
	}
	if vesselID != "" {
		detailRaw, derr := s.GetVesselByVesselID(ctx, vesselID)
		if derr == nil && detailRaw != nil {
			raw = mergeMaps(raw, detailRaw)
		}
	}
	if imoFromRaw := imoString(raw, "imo", "IMO"); imoFromRaw != "" {
		imo = imoFromRaw
	}
	detail := parseVesselDetail(raw, imo)
	if detail != nil && lookupSource != "imo" {
		if detail.DetailRaw == nil {
			detail.DetailRaw = map[string]any{}
		}
		detail.DetailRaw["lookup_fallback"] = lookupSource
	}
	return detail, nil
}

func mergeMaps(base, overlay map[string]any) map[string]any {
	if base == nil {
		return overlay
	}
	if overlay == nil {
		return base
	}
	out := make(map[string]any, len(base)+len(overlay))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range overlay {
		if v != nil && v != "" {
			out[k] = v
		}
	}
	return out
}

func currentYear() int {
	return time.Now().Year()
}
