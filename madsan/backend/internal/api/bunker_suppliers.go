package api

import (
	"net/http"
)

// listBunkerSuppliers returns licensed bunker suppliers grouped by hub, from the
// curated seed ingested into companies (official port/regulator registers only).
func (s *Server) listBunkerSuppliers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id, c.name, COALESCE(c.country_code,''),
			c.raw_source_payload->>'hub_key',
			c.raw_source_payload->>'port_name',
			c.raw_source_payload->>'locode',
			c.raw_source_payload->>'license_authority',
			c.raw_source_payload->>'register_tier',
			c.raw_source_payload->>'register_source_url',
			c.raw_source_payload->>'phone',
			c.raw_source_payload->>'email',
			c.raw_source_payload->>'source_url',
			c.raw_source_payload->>'fuels_supplied',
			c.latitude, c.longitude,
			COALESCE(c.commodities_supported, ARRAY[]::text[]),
			COALESCE(c.confidence_score, 0)
		FROM companies c
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
		ID               string   `json:"id"`
		Name             string   `json:"name"`
		CountryCode      string   `json:"country_code,omitempty"`
		Phone            string   `json:"phone,omitempty"`
		Email            string   `json:"email,omitempty"`
		Products         []string `json:"products,omitempty"`
		FuelsSupplied    string   `json:"fuels_supplied,omitempty"`
		SourceURL        string   `json:"source_url,omitempty"`
		RegisterTier     string   `json:"register_tier,omitempty"`
		ConfidenceScore  float64  `json:"confidence_score"`
		Latitude         *float64 `json:"latitude,omitempty"`
		Longitude        *float64 `json:"longitude,omitempty"`
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
		var lat, lon *float64
		var products []string
		var conf float64
		if rows.Scan(&id, &name, &cc, &hubKey, &portName, &locode, &authority, &regTier, &regURL,
			&phone, &email, &srcURL, &fuels, &lat, &lon, &products, &conf) != nil {
			continue
		}
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
		"hubs":        out,
		"hub_count":   len(out),
		"supplier_count": total,
		"tier":        "official_register",
		"disclaimer":  "Licensed bunker suppliers from public port/regulator registers only — confirm licence status before deals.",
	})
}
