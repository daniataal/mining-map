package maritimecontext

import (
	"encoding/csv"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	unlocodeCSVURL         = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv"
	unlocodeOfficialSource = "https://unece.org/trade/cefact/UNLOCODE-Download"
	unlocodeCacheTTL       = 24 * time.Hour
	defaultHTTPTimeout     = 12 * time.Second
)

var (
	coordRE      = regexp.MustCompile(`^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$`)
	unlocodeRows []PortRow
	unlocodeAt   time.Time
)

type PortRow struct {
	UNLOCODE    string  `json:"unlocode"`
	CountryISO2 string  `json:"country_iso2"`
	Name        string  `json:"name"`
	NameASCII   string  `json:"name_ascii"`
	Subdivision *string `json:"subdivision,omitempty"`
	Status      *string `json:"status,omitempty"`
	Function    string  `json:"function"`
	Remarks     *string `json:"remarks,omitempty"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	Role        string  `json:"role"`
	SourceLabel string  `json:"source_label"`
	SourceURL   string  `json:"source_url"`
}

type PortReference struct {
	PortRow
	DistanceKM *float64 `json:"distance_km"`
	Confidence float64  `json:"confidence"`
	MatchedOn  string   `json:"matched_on,omitempty"`
}

var oilPortKeywords = []string{"oil", "gas", "lng", "lpg", "petro", "petrol", "terminal", "offshore", "energy", "refinery"}

func parseUNLOCODECoordinates(raw string) (lat, lng float64, ok bool) {
	raw = strings.TrimSpace(raw)
	m := coordRE.FindStringSubmatch(raw)
	if m == nil {
		return 0, 0, false
	}
	latDeg, latMin := atoi(m[1]), atoi(m[2])
	lonDeg, lonMin := atoi(m[4]), atoi(m[5])
	lat = float64(latDeg) + float64(latMin)/60.0
	if m[3] == "S" {
		lat = -lat
	}
	lng = float64(lonDeg) + float64(lonMin)/60.0
	if m[6] == "W" {
		lng = -lng
	}
	return lat, lng, true
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}

func isPortFunction(code string) bool {
	code = strings.TrimSpace(code)
	return len(code) > 0 && code[0] == '1'
}

func looksEnergyRelated(name, remarks string) bool {
	hay := strings.ToLower(name + " " + remarks)
	for _, kw := range oilPortKeywords {
		if strings.Contains(hay, kw) {
			return true
		}
	}
	return false
}

func portRole(name, remarks string) string {
	if looksEnergyRelated(name, remarks) {
		return "energy_port"
	}
	return "port"
}

func loadUNLOCODEPorts(force bool) ([]PortRow, error) {
	if !force && len(unlocodeRows) > 0 && time.Since(unlocodeAt) < unlocodeCacheTTL {
		return unlocodeRows, nil
	}
	client := &http.Client{Timeout: defaultHTTPTimeout}
	req, err := http.NewRequest(http.MethodGet, unlocodeCSVURL, nil)
	if err != nil {
		return cachedPorts(), err
	}
	req.Header.Set("User-Agent", "meridian-oil-live-intel/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return cachedPorts(), err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return cachedPorts(), err
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return cachedPorts(), err
	}
	reader := csv.NewReader(strings.NewReader(string(body)))
	headers, err := reader.Read()
	if err != nil {
		return cachedPorts(), err
	}
	col := map[string]int{}
	for i, h := range headers {
		col[strings.TrimSpace(h)] = i
	}
	get := func(row []string, name string) string {
		i, ok := col[name]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}
	var rows []PortRow
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		fn := get(row, "Function")
		if !isPortFunction(fn) {
			continue
		}
		lat, lng, ok := parseUNLOCODECoordinates(get(row, "Coordinates"))
		if !ok {
			continue
		}
		country := strings.ToUpper(get(row, "Country"))
		loc := strings.ToUpper(get(row, "Location"))
		name := get(row, "Name")
		if country == "" || loc == "" || name == "" {
			continue
		}
		remarks := get(row, "Remarks")
		nameASCII := get(row, "NameWoDiacritics")
		if nameASCII == "" {
			nameASCII = name
		}
		sub := get(row, "Subdivision")
		st := get(row, "Status")
		var subPtr, stPtr, remPtr *string
		if sub != "" {
			subPtr = &sub
		}
		if st != "" {
			stPtr = &st
		}
		if remarks != "" {
			remPtr = &remarks
		}
		rows = append(rows, PortRow{
			UNLOCODE: country + loc, CountryISO2: country, Name: name, NameASCII: nameASCII,
			Subdivision: subPtr, Status: stPtr, Function: fn, Remarks: remPtr,
			Lat: lat, Lng: lng, Role: portRole(name, remarks),
			SourceLabel: "UN/LOCODE", SourceURL: unlocodeOfficialSource,
		})
	}
	if len(rows) > 0 {
		unlocodeRows = rows
		unlocodeAt = time.Now()
	}
	return cachedPorts(), nil
}

func cachedPorts() []PortRow {
	if len(unlocodeRows) == 0 {
		return nil
	}
	out := make([]PortRow, len(unlocodeRows))
	copy(out, unlocodeRows)
	return out
}

func HaversineKM(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371.0
	p1, p2 := lat1*math.Pi/180, lat2*math.Pi/180
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return r * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func FindNearestPorts(countryISO2 string, lat, lng *float64, limit int) []map[string]any {
	if limit <= 0 {
		limit = 5
	}
	rows, _ := loadUNLOCODEPorts(false)
	if len(rows) == 0 {
		return nil
	}
	country := strings.ToUpper(strings.TrimSpace(countryISO2))
	scoped := make([]PortRow, 0, len(rows))
	for _, row := range rows {
		if country == "" || row.CountryISO2 == country {
			scoped = append(scoped, row)
		}
	}
	out := make([]map[string]any, 0, limit)
	if lat != nil && lng != nil {
		type scored struct {
			row PortRow
			d   float64
		}
		scoredRows := make([]scored, 0, len(scoped))
		for _, row := range scoped {
			scoredRows = append(scoredRows, scored{row, HaversineKM(*lat, *lng, row.Lat, row.Lng)})
		}
		for i := 0; i < len(scoredRows); i++ {
			for j := i + 1; j < len(scoredRows); j++ {
				if scoredRows[j].d < scoredRows[i].d {
					scoredRows[i], scoredRows[j] = scoredRows[j], scoredRows[i]
				}
			}
		}
		for i := 0; i < len(scoredRows) && i < limit; i++ {
			conf := 0.45
			if scoredRows[i].row.Role == "energy_port" {
				conf = 0.65
			}
			d := math.Round(scoredRows[i].d*10) / 10
			out = append(out, portToMap(scoredRows[i].row, &d, conf))
		}
		return out
	}
	for i := 0; i < len(scoped); i++ {
		for j := i + 1; j < len(scoped); j++ {
			ri := 1
			rj := 1
			if scoped[i].Role == "energy_port" {
				ri = 0
			}
			if scoped[j].Role == "energy_port" {
				rj = 0
			}
			if rj < ri || (rj == ri && scoped[j].Name < scoped[i].Name) {
				scoped[i], scoped[j] = scoped[j], scoped[i]
			}
		}
	}
	for i := 0; i < len(scoped) && i < limit; i++ {
		conf := 0.35
		if scoped[i].Role == "energy_port" {
			conf = 0.55
		}
		out = append(out, portToMap(scoped[i], nil, conf))
	}
	return out
}

func MatchDestinationToPort(destination, countryISO2 string) map[string]any {
	token := normalizeToken(destination)
	if token == "" {
		return nil
	}
	rows, _ := loadUNLOCODEPorts(false)
	if len(rows) == 0 {
		return nil
	}
	country := strings.ToUpper(strings.TrimSpace(countryISO2))
	scoped := rows
	if country != "" {
		scoped = make([]PortRow, 0)
		for _, row := range rows {
			if row.CountryISO2 == country {
				scoped = append(scoped, row)
			}
		}
		if len(scoped) == 0 {
			scoped = rows
		}
	}
	var bestScore float64
	var best *PortRow
	for i := range scoped {
		row := scoped[i]
		tokens := []string{normalizeToken(row.Name), normalizeToken(row.NameASCII), normalizeToken(row.UNLOCODE)}
		score := 0.0
		for _, cand := range tokens {
			if cand == "" {
				continue
			}
			if token == cand {
				score = 1.0
				break
			}
			if strings.Contains(token, cand) || strings.Contains(cand, token) {
				score = 0.82
			}
		}
		if score > 0 && (best == nil || score > bestScore) {
			bestScore = score
			copy := row
			best = &copy
		}
	}
	if best == nil {
		return nil
	}
	m := portToMap(*best, nil, bestScore)
	m["matched_on"] = strings.TrimSpace(destination)
	m["confidence"] = bestScore
	return m
}

func portToMap(row PortRow, dist *float64, conf float64) map[string]any {
	m := map[string]any{
		"unlocode": row.UNLOCODE, "country_iso2": row.CountryISO2, "name": row.Name,
		"name_ascii": row.NameASCII, "lat": row.Lat, "lng": row.Lng, "role": row.Role,
		"source_label": row.SourceLabel, "source_url": row.SourceURL, "confidence": conf,
		"function": row.Function,
	}
	if row.Subdivision != nil {
		m["subdivision"] = *row.Subdivision
	}
	if row.Status != nil {
		m["status"] = *row.Status
	}
	if row.Remarks != nil {
		m["remarks"] = *row.Remarks
	}
	if dist != nil {
		m["distance_km"] = *dist
	} else {
		m["distance_km"] = nil
	}
	return m
}
