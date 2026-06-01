package trade

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

const (
	comtradePublicURL = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
	comtradeKeyedURL  = "https://comtradeapi.un.org/data/v1/get/C/A/HS"
	httpTimeout       = 14 * time.Second
)

type comtradeResponse struct {
	Data []map[string]any `json:"data"`
}

// FetchComtrade returns flows from public preview, or keyed API when apiKey is set.
func FetchComtrade(m49, hs string, year int, apiKey string) ([]FlowRow, string, error) {
	if apiKey != "" {
		rows, err := fetchComtradeKeyed(m49, hs, year, apiKey)
		if err == nil && len(rows) > 0 {
			return rows, "UN Comtrade (keyed)", nil
		}
	}
	rows, err := fetchComtradePublic(m49, hs, year)
	if err != nil {
		return nil, "", err
	}
	if len(rows) == 0 && year > 2018 {
		rows, err = fetchComtradePublic(m49, hs, year-1)
		if err == nil && len(rows) > 0 {
			return rows, "UN Comtrade (public preview)", nil
		}
	}
	return rows, "UN Comtrade (public preview)", err
}

func fetchComtradePublic(m49, hs string, year int) ([]FlowRow, error) {
	url := fmt.Sprintf(
		"%s?reporterCode=%s&cmdCode=%s&period=%d&flowCode=X,M&partnerCode=0&maxRecords=100",
		comtradePublicURL, m49, hs, year,
	)
	return fetchComtradeURL(url, m49, hs, year, "comtrade_public")
}

func fetchComtradeKeyed(m49, hs string, year int, apiKey string) ([]FlowRow, error) {
	url := fmt.Sprintf(
		"%s?reporterCode=%s&cmdCode=%s&period=%d&flowCode=X,M&partnerCode=0&subscription-key=%s&limit=100",
		comtradeKeyedURL, m49, hs, year, apiKey,
	)
	return fetchComtradeURL(url, m49, hs, year, "comtrade_keyed")
}

func fetchComtradeURL(url, m49, hs string, year int, sourceKey string) ([]FlowRow, error) {
	client := &http.Client{Timeout: httpTimeout}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "mining-map/oil-live-intel")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("comtrade HTTP %d: %s", resp.StatusCode, string(body))
	}
	var payload comtradeResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	var out []FlowRow
	for _, row := range payload.Data {
		fr := parseComtradeRow(row, m49, hs, year, sourceKey)
		if fr != nil {
			out = append(out, *fr)
		}
	}
	return out, nil
}

func parseComtradeRow(row map[string]any, m49, hs string, year int, sourceKey string) *FlowRow {
	reporter := strField(row, "reporterDesc", "reporter")
	partner := strField(row, "partnerDesc", "partner")
	if partner == "" {
		partner = "World"
	}
	flowCode := strField(row, "flowCode")
	flow := "Import"
	if flowCode == "X" {
		flow = "Export"
	}
	period := strField(row, "period")
	if period == "" {
		period = strconv.Itoa(year)
	}
	var val, wgt *float64
	if v := numField(row, "primaryValue"); v != nil {
		val = v
	}
	if w := numField(row, "netWgt"); w != nil {
		wgt = w
	}
	if reporter == "" {
		for _, e := range Exporters {
			if e.M49 == m49 {
				reporter = e.Name
				break
			}
		}
	}
	ft := "M"
	if flow == "Export" {
		ft = "X"
	}
	yr, _ := strconv.Atoi(period)
	if yr == 0 {
		yr = year
	}
	desc := ""
	switch hs {
	case "2709":
		desc = "Petroleum oils, crude"
	case "2710":
		desc = "Petroleum oils, not crude"
	case "2711":
		desc = "Petroleum gases"
	}
	return &FlowRow{
		Reporter:      reporter,
		ReporterM49:   m49,
		Partner:       partner,
		PartnerM49:    "0",
		HSCode:        hs,
		HSDescription: desc,
		FlowType:      ft,
		Year:          yr,
		TradeValueUSD: val,
		NetWeightKg:   wgt,
		DataSource:    sourceKey,
	}
}

func strField(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return fmt.Sprint(v)
		}
	}
	return ""
}

func numField(m map[string]any, key string) *float64 {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch n := v.(type) {
	case float64:
		return &n
	case json.Number:
		f, err := n.Float64()
		if err != nil {
			return nil
		}
		return &f
	default:
		f, err := strconv.ParseFloat(fmt.Sprint(v), 64)
		if err != nil {
			return nil
		}
		return &f
	}
}
