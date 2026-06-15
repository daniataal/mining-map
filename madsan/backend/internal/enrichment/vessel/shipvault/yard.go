package shipvault

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// YardDetail is structured data for a ShipVault shipyard page.
type YardDetail struct {
	ShipVaultYardID string         `json:"shipvault_yard_id"`
	Name            string         `json:"name"`
	Country         string         `json:"country,omitempty"`
	Location        string         `json:"location,omitempty"`
	VesselsBuilt    []FleetVessel  `json:"vessels_built,omitempty"`
	Raw             map[string]any `json:"raw,omitempty"`
}

// GetYard fetches yard detail by ShipVault internal yard ID.
func (s *Service) GetYard(ctx context.Context, yardID string) (map[string]any, error) {
	yardID = strings.TrimSpace(yardID)
	if yardID == "" {
		return nil, fmt.Errorf("empty yard id")
	}
	var raw map[string]any
	paths := []string{
		"/api/yards/" + yardID,
		"/api/shipyards/" + yardID,
	}
	var lastErr error
	for _, path := range paths {
		err := s.doRequest(ctx, path, &raw)
		if err == nil && raw != nil {
			return raw, nil
		}
		lastErr = err
		if err != nil && strings.Contains(err.Error(), "404") {
			continue
		}
		if err != nil {
			return nil, err
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("shipvault 404: yard not found")
}

// GetYardFleet loads vessels built at a yard when a separate fleet endpoint exists.
func (s *Service) GetYardFleet(ctx context.Context, yardID string) ([]map[string]any, error) {
	var raw struct {
		Data  []map[string]any `json:"data"`
		Items []map[string]any `json:"items"`
	}
	paths := []string{
		"/api/yards/" + yardID + "/vessels?page=1&pageSize=200",
		"/api/yards/" + yardID + "/fleet?page=1&pageSize=200",
	}
	for _, path := range paths {
		if err := s.doRequest(ctx, path, &raw); err != nil {
			if strings.Contains(err.Error(), "404") {
				continue
			}
			return nil, err
		}
		if len(raw.Data) > 0 {
			return raw.Data, nil
		}
		if len(raw.Items) > 0 {
			return raw.Items, nil
		}
	}
	return nil, nil
}

// SearchYardByName tries ShipVault yard search; returns first match id + raw row.
func (s *Service) SearchYardByName(ctx context.Context, name string) (string, map[string]any, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil, fmt.Errorf("empty yard name")
	}
	q := url.Values{}
	q.Set("page", "1")
	q.Set("pageSize", "10")
	q.Set("search", name)
	q.Set("q", name)
	paths := []string{
		"/api/yards/search?" + q.Encode(),
		"/api/units/yardsearch/" + url.PathEscape(name) + "?page=1&pageSize=10",
	}
	for _, path := range paths {
		var resp shipSearchResponse
		if err := s.doRequest(ctx, path, &resp); err != nil {
			continue
		}
		rows := resp.vesselRows()
		if len(rows) == 0 {
			continue
		}
		row := rows[0]
		id := strField(row, "id", "yard_id", "yardId", "_id")
		if id == "" {
			id = strField(row, "parentid", "parentId")
		}
		return id, row, nil
	}
	return "", nil, fmt.Errorf("shipvault 404: yard not found for name %q", name)
}

func parseYardDetail(raw map[string]any, yardID string, fleetRaw []map[string]any) *YardDetail {
	if raw == nil && len(fleetRaw) == 0 {
		return nil
	}
	y := &YardDetail{ShipVaultYardID: yardID, Raw: raw}
	if raw != nil {
		y.Name = strField(raw, "name", "yard_name", "yardName", "shipyard", "builder")
		y.Country = strField(raw, "country", "country_code", "countryCode")
		y.Location = strField(raw, "location", "city", "address")
	}
	for _, f := range fleetRaw {
		if f == nil {
			continue
		}
		row := parseFleetVessel(f)
		if row.IMO != "" || row.Name != "" {
			y.VesselsBuilt = append(y.VesselsBuilt, row)
		}
	}
	return y
}

// LoadYardDetail resolves yard by id or name.
func (s *Service) LoadYardDetail(ctx context.Context, yardID, yardName string) (*YardDetail, error) {
	yardID = strings.TrimSpace(yardID)
	if yardID == "_" {
		yardID = ""
	}
	if yardID == "" && strings.TrimSpace(yardName) == "" {
		return nil, fmt.Errorf("yard id or name required")
	}
	if yardID == "" {
		var err error
		yardID, _, err = s.SearchYardByName(ctx, yardName)
		if err != nil {
			return nil, err
		}
	}
	raw, err := s.GetYard(ctx, yardID)
	if err != nil && strings.TrimSpace(yardName) != "" {
		if id, row, serr := s.SearchYardByName(ctx, yardName); serr == nil {
			if id != "" {
				yardID = id
			}
			fleet, _ := s.GetYardFleet(ctx, yardID)
			return parseYardDetail(row, yardID, fleet), nil
		}
		return nil, err
	}
	fleet, _ := s.GetYardFleet(ctx, yardID)
	return parseYardDetail(raw, yardID, fleet), nil
}
