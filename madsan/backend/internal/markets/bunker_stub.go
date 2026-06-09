package markets

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Indicative desk baseline — not sourced from bunker_fuel_suppliers_seed (register only).
const vlsfoReferenceUSDMT = 612.0

type bunkerSeedMeta struct {
	Loaded             bool
	HubCount           int
	SupplierCount      int
	VLSFOSupplierCount int
	SingaporeSuppliers int
	SourceAccessed     string
}

func bunkerVLSFOQuote(now time.Time) Quote {
	meta := loadBunkerSeedMeta()
	disclaimer := "Reference stub — no bunker price feed wired; indicative desk baseline only"
	if meta.Loaded {
		disclaimer = fmt.Sprintf(
			"Reference stub — bunker_fuel_suppliers_seed lists %d licensed suppliers across %d hubs (%d VLSFO-capable, %d in Singapore); register has no prices",
			meta.SupplierCount, meta.HubCount, meta.VLSFOSupplierCount, meta.SingaporeSuppliers,
		)
		if meta.SourceAccessed != "" {
			disclaimer += " (register accessed " + meta.SourceAccessed + ")"
		}
	}
	return Quote{
		Symbol:     "VLSFO_SG",
		Label:      "VLSFO Singapore",
		Price:      vlsfoReferenceUSDMT,
		Currency:   "USD",
		Unit:       "/MT",
		Tier:       tierReferenceStub,
		Disclaimer: disclaimer,
		ObservedAt: now,
	}
}

func loadBunkerSeedMeta() bunkerSeedMeta {
	b, ok := readBunkerSeedFile()
	if !ok {
		return bunkerSeedMeta{}
	}
	var doc struct {
		Meta struct {
			SourceAccessedAt string `json:"source_accessed_at"`
		} `json:"meta"`
		Hubs []struct {
			HubKey    string `json:"hub_key"`
			Country   string `json:"country"`
			Suppliers []struct {
				ProductTypes []string `json:"product_types"`
			} `json:"suppliers"`
		} `json:"hubs"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return bunkerSeedMeta{}
	}

	meta := bunkerSeedMeta{
		Loaded:         true,
		HubCount:       len(doc.Hubs),
		SourceAccessed: doc.Meta.SourceAccessedAt,
	}
	for _, hub := range doc.Hubs {
		meta.SupplierCount += len(hub.Suppliers)
		isSingapore := hub.HubKey == "singapore" || strings.EqualFold(hub.Country, "singapore")
		for _, sup := range hub.Suppliers {
			if isSingapore {
				meta.SingaporeSuppliers++
			}
			for _, p := range sup.ProductTypes {
				if strings.EqualFold(p, "vlsfo") {
					meta.VLSFOSupplierCount++
					break
				}
			}
		}
	}
	return meta
}

func readBunkerSeedFile() ([]byte, bool) {
	for _, path := range bunkerSeedPaths() {
		b, err := os.ReadFile(path)
		if err == nil && len(b) > 0 {
			return b, true
		}
	}
	return nil, false
}

func bunkerSeedPaths() []string {
	seen := map[string]struct{}{}
	add := func(paths *[]string, p string) {
		if ap, err := filepath.Abs(p); err == nil {
			p = ap
		}
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
		*paths = append(*paths, p)
	}

	var paths []string
	if raw := os.Getenv("MADSAN_RAW_DIR"); raw != "" {
		add(&paths, filepath.Join(raw, "bunker_fuel_suppliers_seed.json"))
	}
	if wd, err := os.Getwd(); err == nil {
		add(&paths, filepath.Join(wd, "raw", "bunker_fuel_suppliers_seed.json"))
		if filepath.Base(wd) == "backend" {
			add(&paths, filepath.Join(filepath.Dir(wd), "raw", "bunker_fuel_suppliers_seed.json"))
			add(&paths, filepath.Join(filepath.Dir(filepath.Dir(wd)), "data", "bunker_fuel_suppliers_seed.json"))
		}
	}
	add(&paths, filepath.Join("..", "raw", "bunker_fuel_suppliers_seed.json"))
	add(&paths, filepath.Join("..", "..", "data", "bunker_fuel_suppliers_seed.json"))
	return paths
}
