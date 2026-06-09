package supplier

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/mining-map/oil-live-intel/internal/datarepo"
)

const bunkerSeedFile = "bunker_fuel_suppliers_seed.json"

// BunkerSeed is the top-level bunker fuel suppliers seed document.
type BunkerSeed struct {
	Meta map[string]any `json:"meta"`
	Hubs []BunkerHub    `json:"hubs"`
}

// BunkerHub is one port hub in the seed file.
type BunkerHub struct {
	HubKey            string           `json:"hub_key"`
	Locode            string           `json:"locode"`
	PortName          string           `json:"port_name"`
	Country           string           `json:"country"`
	Lat               *float64         `json:"lat"`
	Lng               *float64         `json:"lng"`
	LicenseAuthority  string           `json:"license_authority"`
	RegisterSourceURL string           `json:"register_source_url"`
	Suppliers         []map[string]any `json:"suppliers"`
}

// SupplierRecord is a flattened supplier row with hub context attached.
type SupplierRecord struct {
	CompanyName       string
	SupplierType      string
	ProductTypes      []string
	FuelsSupplied     string
	Address           string
	ContactPerson     string
	Phone             string
	Email             string
	Website           string
	SourceURL         string
	ConfidenceScore   float64
	Notes             string
	HubKey            string
	Locode            string
	PortName          string
	Country           string
	HubLat            *float64
	HubLng            *float64
	LicenseAuthority  string
	RegisterSourceURL string
}

// LoadBunkerFuelSuppliers reads the curated bunker seed JSON.
func LoadBunkerFuelSuppliers(path string) (BunkerSeed, error) {
	if path == "" {
		path = datarepo.File(bunkerSeedFile)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return BunkerSeed{Meta: map[string]any{}, Hubs: nil}, nil
		}
		return BunkerSeed{}, err
	}
	var payload BunkerSeed
	if err := json.Unmarshal(raw, &payload); err != nil {
		return BunkerSeed{}, fmt.Errorf("bunker seed JSON: %w", err)
	}
	return payload, nil
}

// IterSupplierRecords flattens hub supplier rows with hub context attached.
func IterSupplierRecords(payload BunkerSeed) []SupplierRecord {
	out := make([]SupplierRecord, 0)
	for _, hub := range payload.Hubs {
		for _, raw := range hub.Suppliers {
			name := strings.TrimSpace(stringFromAny(raw["company_name"]))
			if len(name) < 3 {
				continue
			}
			lower := strings.ToLower(name)
			if strings.Contains(lower, "placeholder") || strings.Contains(lower, "port register") {
				continue
			}
			sourceURL := strings.TrimSpace(stringFromAny(raw["source_url"]))
			if sourceURL == "" {
				sourceURL = strings.TrimSpace(hub.RegisterSourceURL)
			}
			conf := 0.65
			if v, ok := raw["confidence_score"].(float64); ok {
				conf = v
			}
			out = append(out, SupplierRecord{
				CompanyName:       name,
				SupplierType:      defaultString(stringFromAny(raw["supplier_type"]), "bunker_supplier"),
				ProductTypes:      stringSliceFromAny(raw["product_types"]),
				FuelsSupplied:     strings.TrimSpace(stringFromAny(raw["fuels_supplied"])),
				Address:           strings.TrimSpace(stringFromAny(raw["address"])),
				ContactPerson:     strings.TrimSpace(stringFromAny(raw["contact_person"])),
				Phone:             strings.TrimSpace(stringFromAny(raw["phone"])),
				Email:             strings.TrimSpace(stringFromAny(raw["email"])),
				Website:           strings.TrimSpace(stringFromAny(raw["website"])),
				SourceURL:         sourceURL,
				ConfidenceScore:   conf,
				Notes:             strings.TrimSpace(stringFromAny(raw["notes"])),
				HubKey:            hub.HubKey,
				Locode:            hub.Locode,
				PortName:          hub.PortName,
				Country:           hub.Country,
				HubLat:            hub.Lat,
				HubLng:            hub.Lng,
				LicenseAuthority:  hub.LicenseAuthority,
				RegisterSourceURL: hub.RegisterSourceURL,
			})
		}
	}
	return out
}

// ExpectedSupplierCount returns upsert-eligible record count for parity tests.
func ExpectedSupplierCount(payload BunkerSeed) int {
	return len(IterSupplierRecords(payload))
}

func stringFromAny(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func defaultString(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return strings.TrimSpace(v)
}

func stringSliceFromAny(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, item := range t {
			s := strings.TrimSpace(stringFromAny(item))
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}
