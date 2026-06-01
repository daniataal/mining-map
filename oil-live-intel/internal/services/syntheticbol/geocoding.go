package syntheticbol

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// dischargeGeo is a resolved discharge endpoint from public hints.
type dischargeGeo struct {
	Lat     float64
	Lng     float64
	Name    string
	Country string
	Method  string
}

// applyDischargeFallback fills discharge corridor coords and hints when only load is known.
func applyDischargeFallback(ctx context.Context, pool *pgxpool.Pool, d *mcrDraft) {
	if d == nil || (d.CorridorDischargeLat != nil && d.CorridorDischargeLng != nil) {
		return
	}
	if d.CorridorLoadLat == nil || d.CorridorLoadLng == nil || d.MMSI == nil {
		return
	}
	loadCountry := ""
	if d.LoadCountry != nil {
		loadCountry = *d.LoadCountry
	}
	hs := hsForFamily(d.CommodityFamily)
	geo, ok := resolveDischargeCoords(ctx, pool, *d.MMSI, loadCountry, hs)
	if !ok {
		return
	}
	d.CorridorDischargeLat = &geo.Lat
	d.CorridorDischargeLng = &geo.Lng
	if d.DischargeHint == nil || *d.DischargeHint == "" {
		d.DischargeHint = strPtr(geo.Name)
	}
	if d.DischargeCountry == nil || *d.DischargeCountry == "" {
		d.DischargeCountry = strPtr(geo.Country)
	}
	if d.Metadata == nil {
		d.Metadata = map[string]any{}
	}
	d.Metadata["discharge_geocode_method"] = geo.Method
	evidence := fmt.Sprintf("Discharge geocoded via %s → %s (%s)", geo.Method, geo.Name, geo.Country)
	d.EvidenceChain = append(d.EvidenceChain, evidence)
	d.Sources = append(d.Sources, map[string]string{"name": "oil_terminals", "field": geo.Method})
}

func resolveDischargeCoords(ctx context.Context, pool *pgxpool.Pool, mmsi int64, loadCountry, hs string) (dischargeGeo, bool) {
	dest := latestVesselDestination(ctx, pool, mmsi)
	if dest != "" {
		if geo, ok := terminalByDestinationHint(ctx, pool, dest); ok {
			return geo, true
		}
		if country := parseDestinationCountry(dest); country != "" {
			if geo, ok := terminalInCountry(ctx, pool, country, dest); ok {
				geo.Method = "ais_destination_country"
				return geo, true
			}
		}
	}
	partner := topTradePartner(ctx, pool, loadCountry, hs)
	if partner != "" {
		if geo, ok := terminalInCountry(ctx, pool, partner, ""); ok {
			geo.Method = "comtrade_partner_terminal"
			return geo, true
		}
	}
	return dischargeGeo{}, false
}

func latestVesselDestination(ctx context.Context, pool *pgxpool.Pool, mmsi int64) string {
	var dest *string
	_ = pool.QueryRow(ctx, `
		SELECT destination FROM oil_ais_positions
		WHERE mmsi = $1 AND destination IS NOT NULL AND TRIM(destination) <> ''
		ORDER BY ts DESC NULLS LAST LIMIT 1
	`, mmsi).Scan(&dest)
	if dest != nil && strings.TrimSpace(*dest) != "" {
		return normalizeDestination(*dest)
	}
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(TRIM(destination_out), ''), NULLIF(TRIM(destination_in), ''))
		FROM oil_port_calls
		WHERE mmsi = $1
		ORDER BY COALESCE(departure_ts, arrival_ts) DESC NULLS LAST
		LIMIT 1
	`, mmsi).Scan(&dest)
	if dest != nil {
		return normalizeDestination(*dest)
	}
	return ""
}

func normalizeDestination(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	upper := strings.ToUpper(s)
	switch upper {
	case "FOR ORDERS", "FOR ORDER", "TBA", "UNKNOWN", "N/A", "NA":
		return ""
	}
	return s
}

// parseDestinationCountry extracts a country hint from AIS destination free text.
func parseDestinationCountry(dest string) string {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return ""
	}
	// Common patterns: "SG SIN", "ROTTERDAM", "USA HOUSTON"
	parts := strings.Fields(strings.ToUpper(dest))
	if len(parts) == 0 {
		return ""
	}
	locodeCountry := map[string]string{
		"SG": "Singapore", "AE": "United Arab Emirates", "SA": "Saudi Arabia",
		"US": "United States", "USA": "United States", "CN": "China", "IN": "India",
		"NL": "Netherlands", "GB": "United Kingdom", "UK": "United Kingdom",
		"KR": "South Korea", "JP": "Japan", "MY": "Malaysia", "ID": "Indonesia",
		"QA": "Qatar", "KW": "Kuwait", "OM": "Oman", "BH": "Bahrain",
		"DE": "Germany", "FR": "France", "IT": "Italy", "ES": "Spain",
		"BR": "Brazil", "MX": "Mexico", "CA": "Canada", "AU": "Australia",
		"TR": "Turkey", "EG": "Egypt", "ZA": "South Africa", "NG": "Nigeria",
	}
	if c, ok := locodeCountry[parts[0]]; ok {
		return c
	}
	// Full country / port names
	nameCountry := map[string]string{
		"SINGAPORE": "Singapore", "FUJAIRAH": "United Arab Emirates", "JEBEL": "United Arab Emirates",
		"ROTTERDAM": "Netherlands", "HOUSTON": "United States",
		"YANBU": "Saudi Arabia", "RAS": "Saudi Arabia", "DAMMAM": "Saudi Arabia",
		"NINGBO": "China", "QINGDAO": "China", "SHANGHAI": "China",
		"INCHEON": "South Korea", "ULSAN": "South Korea", "YEOSU": "South Korea",
		"MUMBAI": "India", "CHENNAI": "India", "KANDLA": "India",
		"ANTWERP": "Belgium", "LAVERA": "France", "MARSEILLE": "France",
	}
	for _, p := range parts {
		if c, ok := nameCountry[p]; ok {
			return c
		}
	}
	// Substring match on multi-word destinations
	lower := strings.ToLower(dest)
	for token, country := range map[string]string{
		"singapore": "Singapore", "fujairah": "United Arab Emirates", "rotterdam": "Netherlands",
		"houston": "United States", "yanbu": "Saudi Arabia", "ras tanura": "Saudi Arabia",
		"china": "China", "india": "India", "korea": "South Korea", "japan": "Japan",
		"netherlands": "Netherlands", "belgium": "Belgium", "uae": "United Arab Emirates",
	} {
		if strings.Contains(lower, token) {
			return country
		}
	}
	return ""
}

func terminalByDestinationHint(ctx context.Context, pool *pgxpool.Pool, dest string) (dischargeGeo, bool) {
	hint := strings.TrimSpace(dest)
	if len(hint) < 3 {
		return dischargeGeo{}, false
	}
	var name, country string
	var lat, lng float64
	err := pool.QueryRow(ctx, `
		SELECT name, COALESCE(country,''), ST_Y(geom::geometry), ST_X(geom::geometry)
		FROM oil_terminals
		WHERE geom IS NOT NULL
		  AND (
		    name ILIKE '%' || $1 || '%'
		    OR COALESCE(port,'') ILIKE '%' || $1 || '%'
		    OR COALESCE(city,'') ILIKE '%' || $1 || '%'
		  )
		ORDER BY confidence DESC NULLS LAST, name
		LIMIT 1
	`, hint).Scan(&name, &country, &lat, &lng)
	if err != nil {
		return dischargeGeo{}, false
	}
	return dischargeGeo{Lat: lat, Lng: lng, Name: name, Country: country, Method: "ais_destination_terminal"}, true
}

func terminalInCountry(ctx context.Context, pool *pgxpool.Pool, country, nameHint string) (dischargeGeo, bool) {
	country = strings.TrimSpace(country)
	if country == "" {
		return dischargeGeo{}, false
	}
	var name, ctry string
	var lat, lng float64
	q := `
		SELECT name, COALESCE(country,''), ST_Y(geom::geometry), ST_X(geom::geometry)
		FROM oil_terminals
		WHERE geom IS NOT NULL AND country ILIKE '%' || $1 || '%'
	`
	args := []any{country}
	if nameHint != "" {
		q += ` AND (name ILIKE '%' || $2 || '%' OR COALESCE(port,'') ILIKE '%' || $2 || '%')`
		args = append(args, nameHint)
	}
	q += ` ORDER BY confidence DESC NULLS LAST, name LIMIT 1`
	err := pool.QueryRow(ctx, q, args...).Scan(&name, &ctry, &lat, &lng)
	if err != nil {
		return dischargeGeo{}, false
	}
	return dischargeGeo{Lat: lat, Lng: lng, Name: name, Country: ctry, Method: "terminal_country_match"}, true
}

func topTradePartner(ctx context.Context, pool *pgxpool.Pool, exportCountry, hs string) string {
	if exportCountry == "" {
		return ""
	}
	var partner *string
	_ = pool.QueryRow(ctx, `
		SELECT partner FROM oil_trade_flows
		WHERE flow_type = 'X' AND hs_code = $2
		  AND reporter ILIKE '%' || $1 || '%'
		  AND partner IS NOT NULL AND partner <> '' AND partner <> 'World'
		ORDER BY trade_value_usd DESC NULLS LAST
		LIMIT 1
	`, exportCountry, hs).Scan(&partner)
	if partner != nil && strings.TrimSpace(*partner) != "" {
		return strings.TrimSpace(*partner)
	}
	return ""
}
