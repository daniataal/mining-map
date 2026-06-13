package api

import (
	"net/http"
	"strconv"
	"strings"
)

// listBunkerSuppliers returns licensed bunker suppliers grouped by hub, from the
// curated seed ingested into companies (official port/regulator registers only).
func (s *Server) listBunkerSuppliers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		WITH contact_rollup AS (
			SELECT
				company_id,
				MAX(email) FILTER (WHERE NULLIF(TRIM(email), '') IS NOT NULL) AS email,
				MAX(phone) FILTER (WHERE NULLIF(TRIM(phone), '') IS NOT NULL) AS phone
			FROM contacts
			GROUP BY company_id
		)
		SELECT c.id, c.name, COALESCE(c.country_code,''),
			COALESCE(c.raw_source_payload->>'hub_key',''),
			COALESCE(c.raw_source_payload->>'port_name',''),
			COALESCE(c.raw_source_payload->>'locode',''),
			COALESCE(c.raw_source_payload->>'license_authority',''),
			COALESCE(c.raw_source_payload->>'register_tier',''),
			COALESCE(c.raw_source_payload->>'register_source_url', c.raw_source_payload->>'source_url', ''),
			COALESCE(cr.phone, c.phone, c.raw_source_payload->>'phone', ''),
			COALESCE(cr.email, c.email, c.raw_source_payload->>'email', ''),
			COALESCE(c.website, c.raw_source_payload->>'website', c.raw_source_payload->>'source_url', ''),
			COALESCE(c.raw_source_payload->>'fuels_supplied',''),
			COALESCE(c.raw_source_payload->>'latitude', c.raw_source_payload->>'lat', ''),
			COALESCE(c.raw_source_payload->>'longitude', c.raw_source_payload->>'lon', ''),
			COALESCE(c.commodities, ARRAY[]::text[]),
			COALESCE(c.confidence_score, 0)
		FROM companies c
		LEFT JOIN contact_rollup cr ON cr.company_id = c.id
		WHERE c.raw_source_payload ? 'hub_key'
		ORDER BY c.raw_source_payload->>'port_name', c.name
		LIMIT 1000
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type supplier struct {
		ID              string   `json:"id"`
		Name            string   `json:"name"`
		CountryCode     string   `json:"country_code,omitempty"`
		Phone           string   `json:"phone,omitempty"`
		Email           string   `json:"email,omitempty"`
		Products        []string `json:"products,omitempty"`
		FuelsSupplied   string   `json:"fuels_supplied,omitempty"`
		SourceURL       string   `json:"source_url,omitempty"`
		RegisterTier    string   `json:"register_tier,omitempty"`
		ConfidenceScore float64  `json:"confidence_score"`
		Latitude        *float64 `json:"latitude,omitempty"`
		Longitude       *float64 `json:"longitude,omitempty"`
	}
	type hub struct {
		HubKey            string     `json:"hub_key"`
		PortName          string     `json:"port_name"`
		Locode            string     `json:"locode,omitempty"`
		CountryCode       string     `json:"country_code,omitempty"`
		LicenseAuthority  string     `json:"license_authority,omitempty"`
		RegisterSourceURL string     `json:"register_source_url,omitempty"`
		RegisterTier      string     `json:"register_tier,omitempty"`
		Latitude          *float64   `json:"latitude,omitempty"`
		Longitude         *float64   `json:"longitude,omitempty"`
		Suppliers         []supplier `json:"suppliers"`
	}

	hubs := map[string]*hub{}
	hubOrder := []string{}
	for rows.Next() {
		var id, name, cc, hubKey, portName, locode, authority, regTier, regURL, phone, email, srcURL, fuels string
		var latText, lonText string
		var products []string
		var conf float64
		if rows.Scan(&id, &name, &cc, &hubKey, &portName, &locode, &authority, &regTier, &regURL,
			&phone, &email, &srcURL, &fuels, &latText, &lonText, &products, &conf) != nil {
			continue
		}
		lat := parseOptionalFloat(latText)
		lon := parseOptionalFloat(lonText)
		products = bunkerProducts(products, fuels)
		h, ok := hubs[hubKey]
		if !ok {
			h = &hub{
				HubKey: hubKey, PortName: portName, Locode: locode, CountryCode: cc,
				LicenseAuthority: authority, RegisterSourceURL: regURL, RegisterTier: regTier,
				Latitude: lat, Longitude: lon, Suppliers: []supplier{},
			}
			hubs[hubKey] = h
			hubOrder = append(hubOrder, hubKey)
		}
		h.Suppliers = append(h.Suppliers, supplier{
			ID: id, Name: name, CountryCode: cc, Phone: phone, Email: email,
			Products: products, FuelsSupplied: fuels, SourceURL: srcURL,
			RegisterTier: regTier, ConfidenceScore: conf, Latitude: lat, Longitude: lon,
		})
	}

	out := make([]hub, 0, len(hubOrder))
	total := 0
	for _, key := range hubOrder {
		h := hubs[key]
		total += len(h.Suppliers)
		out = append(out, *h)
	}
	writeJSON(w, map[string]any{
		"hubs":           out,
		"hub_count":      len(out),
		"supplier_count": total,
		"tier":           "official_register",
		"disclaimer":     "Licensed bunker suppliers from public port/regulator registers only — confirm licence status before deals.",
	})
}

func parseOptionalFloat(raw string) *float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil
	}
	return &v
}

func bunkerProducts(commodities []string, fuels string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(commodities)+2)
	add := func(v string) {
		v = strings.TrimSpace(v)
		v = strings.Trim(v, " .")
		if v == "" {
			return
		}
		key := strings.ToLower(v)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, v)
	}
	for _, commodity := range commodities {
		add(commodity)
	}
	for _, part := range strings.FieldsFunc(fuels, func(r rune) bool {
		return r == ',' || r == ';' || r == '|' || r == '/'
	}) {
		add(part)
	}
	if len(out) == 0 && strings.TrimSpace(fuels) != "" {
		add(fuels)
	}
	return out
}
