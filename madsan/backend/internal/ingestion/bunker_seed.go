package ingestion

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type bunkerHub struct {
	HubKey            string         `json:"hub_key"`
	Locode            string         `json:"locode"`
	PortName          string         `json:"port_name"`
	Country           string         `json:"country"`
	Lat               float64        `json:"lat"`
	Lng               float64        `json:"lng"`
	LicenseAuthority  string         `json:"license_authority"`
	RegisterSourceURL string         `json:"register_source_url"`
	RegisterTier      string         `json:"register_tier"`
	Suppliers         []bunkerSupplier `json:"suppliers"`
}

type bunkerSupplier struct {
	CompanyName      string   `json:"company_name"`
	SupplierType     string   `json:"supplier_type"`
	ProductTypes     []string `json:"product_types"`
	Phone            string   `json:"phone"`
	Email            string   `json:"email"`
	SourceURL        string   `json:"source_url"`
	ConfidenceScore  float64  `json:"confidence_score"`
	FuelsSupplied    string   `json:"fuels_supplied"`
}

func (s *Service) ingestBunkerSeed(sourceSlug string) ([]NormalizedRecord, error) {
	path := filepath.Join(s.cfg.RawDataDir, "bunker_fuel_suppliers_seed.json")
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Meta struct {
			SourceID   string `json:"source_id"`
			SourceName string `json:"source_name"`
		} `json:"meta"`
		Hubs []bunkerHub `json:"hubs"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, err
	}

	countryCode := func(country string) string {
		switch strings.ToLower(country) {
		case "united arab emirates":
			return "AE"
		case "singapore":
			return "SG"
		case "netherlands":
			return "NL"
		case "united kingdom":
			return "GB"
		case "new zealand":
			return "NZ"
		case "belgium":
			return "BE"
		case "oman":
			return "OM"
		case "gibraltar":
			return "GI"
		case "malta":
			return "MT"
		case "greece":
			return "GR"
		case "turkey":
			return "TR"
		default:
			return ""
		}
	}

	var out []NormalizedRecord
	for _, hub := range doc.Hubs {
		cc := countryCode(hub.Country)
		lat, lng := hub.Lat, hub.Lng
		for _, sup := range hub.Suppliers {
			commodities := sup.ProductTypes
			if len(commodities) == 0 {
				commodities = []string{"marine_fuel"}
			}
			raw := map[string]any{
				"hub_key": hub.HubKey, "port_name": hub.PortName, "locode": hub.Locode,
				"license_authority": hub.LicenseAuthority, "register_tier": hub.RegisterTier,
				"phone": sup.Phone, "email": sup.Email, "source_url": sup.SourceURL,
				"confidence_score": sup.ConfidenceScore, "fuels_supplied": sup.FuelsSupplied,
				"supplier_type": sup.SupplierType,
			}
			out = append(out, NormalizedRecord{
				EntityType:  "company",
				Name:        normalizeName(sup.CompanyName),
				CountryCode: cc,
				Latitude:    &lat,
				Longitude:   &lng,
				Commodities: commodities,
				AssetType:   "port",
				SourceSlug:  sourceSlug,
				RawPayload:  raw,
				ExternalID:  hub.HubKey + ":" + sup.CompanyName,
			})
		}
	}
	return out, nil
}
