package trade

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

const eiaAPIBase = "https://api.eia.gov/v2"

// FetchEIA returns volume-based supplementary rows when EIA_API_KEY is set.
func FetchEIA(iso2, hs string, year int, apiKey string) ([]FlowRow, error) {
	if apiKey == "" {
		return nil, nil
	}
	iso3 := EIAISO3[iso2]
	product := EIAProductByHS[hs]
	if iso3 == "" || product == "" {
		return nil, nil
	}
	var out []FlowRow
	name := countryName(iso2)
	for activityID, flowLabel := range map[int]string{2: "Export", 3: "Import"} {
		url := fmt.Sprintf(
			"%s/international/data/?api_key=%s&frequency=annual&data[0]=value"+
				"&facets[productId][]=%s&facets[activityId][]=%d&facets[countryRegionId][]=%s"+
				"&start=%d&end=%d&sort[0][column]=period&sort[0][direction]=desc&length=2",
			eiaAPIBase, apiKey, product, activityID, iso3, year-1, year,
		)
		client := &http.Client{Timeout: 12 * time.Second}
		resp, err := client.Get(url)
		if err != nil || resp.StatusCode != http.StatusOK {
			if resp != nil {
				resp.Body.Close()
			}
			continue
		}
		var payload struct {
			Response struct {
				Data []map[string]any `json:"data"`
			} `json:"response"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			resp.Body.Close()
			continue
		}
		resp.Body.Close()
		if len(payload.Response.Data) == 0 {
			continue
		}
		latest := payload.Response.Data[0]
		qty := numField(latest, "value")
		period := strField(latest, "period")
		if period == "" {
			period = fmt.Sprintf("%d", year)
		}
		unit := strField(latest, "unit")
		if unit == "" {
			unit = "Mb/d"
		}
		ft := "M"
		if flowLabel == "Export" {
			ft = "X"
		}
		yr, _ := strconv.Atoi(period)
		if yr == 0 {
			yr = year
		}
		out = append(out, FlowRow{
			Reporter:      name,
			ReporterISO2:  iso2,
			Partner:       "World",
			PartnerM49:    "0",
			HSCode:        hs,
			FlowType:      ft,
			Year:          yr,
			TradeValueUSD: nil,
			NetWeightKg:   nil,
			DataSource:    "eia_international",
		})
		_ = unit
		_ = qty
	}
	return out, nil
}

func countryName(iso2 string) string {
	for _, e := range Exporters {
		if e.ISO2 == iso2 {
			return e.Name
		}
	}
	return iso2
}
