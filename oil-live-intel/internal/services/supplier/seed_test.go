package supplier

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/mining-map/oil-live-intel/internal/datarepo"
)

func TestLoadBunkerFuelSuppliers(t *testing.T) {
	path := datarepo.File("bunker_fuel_suppliers_seed.json")
	payload, err := LoadBunkerFuelSuppliers(path)
	if err != nil {
		t.Fatalf("LoadBunkerFuelSuppliers: %v", err)
	}
	if len(payload.Hubs) < 1 {
		t.Fatalf("expected hubs, got %d", len(payload.Hubs))
	}
}

func TestIterSupplierRecordsParity(t *testing.T) {
	path := datarepo.File("bunker_fuel_suppliers_seed.json")
	payload, err := LoadBunkerFuelSuppliers(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	records := IterSupplierRecords(payload)
	names := make([]string, 0, len(records))
	for _, r := range records {
		names = append(names, r.CompanyName)
	}
	if !containsName(names, "Al Arabia Bunkering") {
		t.Fatalf("missing Al Arabia Bunkering in %d records", len(records))
	}
	if !containsName(names, "Akron Trade and Transport") {
		t.Fatalf("missing Akron")
	}
	if len(records) < 240 {
		t.Fatalf("expected >=240 records, got %d", len(records))
	}
	withPhone := 0
	for _, r := range records {
		if r.Phone != "" {
			withPhone++
		}
	}
	if withPhone < 160 {
		t.Fatalf("expected >=160 with phone, got %d", withPhone)
	}
	sg := filterLocode(records, "SGSIN")
	if len(sg) != 39 {
		t.Fatalf("SGSIN count: got %d want 39", len(sg))
	}
	withAddress := 0
	for _, r := range sg {
		if r.Address != "" {
			withAddress++
		}
	}
	if withAddress != 39 {
		t.Fatalf("SGSIN with address: got %d want 39", withAddress)
	}
	bp := findRecord(sg, "BP Singapore")
	if bp == nil {
		t.Fatal("missing BP Singapore")
	}
	if bp.FuelsSupplied != "MDO/ MGO /MFO" {
		t.Fatalf("BP fuels: %q", bp.FuelsSupplied)
	}
	if !strings.Contains(bp.Address, "Marina One") {
		t.Fatalf("BP address: %q", bp.Address)
	}
	if !strings.Contains(bp.ContactPerson, "Masaki Low") {
		t.Fatalf("BP contact: %q", bp.ContactPerson)
	}
	fj := filterLocode(records, "AEFJR")
	if len(fj) < 13 {
		t.Fatalf("AEFJR count: got %d", len(fj))
	}
	akron := findRecord(fj, "Akron")
	if akron == nil {
		t.Fatal("missing Akron Fujairah")
	}
	if akron.FuelsSupplied != "Compliant marine fuels (Port licensed)" {
		t.Fatalf("Akron fuels: %q", akron.FuelsSupplied)
	}
	uk := filterLocode(records, "GB")
	if len(uk) != 53 {
		t.Fatalf("GB count: got %d want 53", len(uk))
	}
	ukWithAddress := 0
	for _, r := range uk {
		if r.Address != "" {
			ukWithAddress++
		}
	}
	if ukWithAddress != 53 {
		t.Fatalf("GB with address: got %d want 53", ukWithAddress)
	}
	valero := findRecord(uk, "Valero")
	if valero == nil {
		t.Fatal("missing Valero UK")
	}
	if !strings.Contains(valero.Address, "Canada Square") {
		t.Fatalf("Valero address: %q", valero.Address)
	}
	if valero.Phone != "02075 133867" {
		t.Fatalf("Valero phone: %q", valero.Phone)
	}
	if valero.Email != "" {
		t.Fatalf("Valero email should be empty, got %q", valero.Email)
	}
	nl := filterLocode(records, "NLRTM")
	if len(nl) != 35 {
		t.Fatalf("NLRTM count: got %d want 35", len(nl))
	}
	shell := findRecord(nl, "Shell Trading Rotterdam")
	if shell == nil {
		t.Fatal("missing Shell Trading Rotterdam")
	}
	if shell.Phone != "" || shell.Email != "" || shell.Address != "" {
		t.Fatalf("Shell NL should be name-only on ILT register")
	}
	if shell.FuelsSupplied != "ILT-registered marine fuel oil supplier (Netherlands)" {
		t.Fatalf("Shell fuels: %q", shell.FuelsSupplied)
	}
	nz := filterLocode(records, "NZ")
	if len(nz) != 62 {
		t.Fatalf("NZ count: got %d want 62", len(nz))
	}
	nzWithPhone := 0
	for _, r := range nz {
		if r.Phone != "" {
			nzWithPhone++
		}
		if r.Email != "" || r.Address != "" {
			t.Fatalf("NZ register has no email/address: %q", r.CompanyName)
		}
	}
	if nzWithPhone != 62 {
		t.Fatalf("NZ with phone: got %d want 62", nzWithPhone)
	}
	allied := findRecord(nz, "Allied Petroleum")
	if allied == nil {
		t.Fatal("missing Allied Petroleum NZ")
	}
	if allied.Phone != "0800 383 566" {
		t.Fatalf("Allied phone: %q", allied.Phone)
	}
	if !strings.Contains(allied.Notes, "Port: Auckland") {
		t.Fatalf("Allied notes: %q", allied.Notes)
	}
	beanr := filterLocode(records, "BEANR")
	if len(beanr) != 37 {
		t.Fatalf("BEANR count: got %d want 37", len(beanr))
	}
	beanrWithAddress := 0
	beanrWithEmail := 0
	for _, r := range beanr {
		if r.Address != "" {
			beanrWithAddress++
		}
		if r.Email != "" {
			beanrWithEmail++
		}
		if r.Phone != "" {
			t.Fatalf("BEANR register has no phone: %q", r.CompanyName)
		}
	}
	if beanrWithAddress != 37 {
		t.Fatalf("BEANR with address: got %d want 37", beanrWithAddress)
	}
	if beanrWithEmail != 30 {
		t.Fatalf("BEANR with email: got %d want 30", beanrWithEmail)
	}
	peninsula := findRecord(beanr, "Peninsula Petroleum")
	if peninsula == nil {
		t.Fatal("missing Peninsula Petroleum BEANR")
	}
	if !strings.Contains(peninsula.Address, "Noorderplaats") {
		t.Fatalf("Peninsula address: %q", peninsula.Address)
	}
	if peninsula.Email != "antwerpops@peninsula360.com" {
		t.Fatalf("Peninsula email: %q", peninsula.Email)
	}
}

func TestSeedPathFromRepo(t *testing.T) {
	path := datarepo.File("bunker_fuel_suppliers_seed.json")
	if filepath.Base(path) != "bunker_fuel_suppliers_seed.json" {
		t.Fatalf("unexpected path %s", path)
	}
}

func containsName(names []string, target string) bool {
	for _, n := range names {
		if n == target {
			return true
		}
	}
	return false
}

func filterLocode(records []SupplierRecord, locode string) []SupplierRecord {
	out := make([]SupplierRecord, 0)
	for _, r := range records {
		if r.Locode == locode {
			out = append(out, r)
		}
	}
	return out
}

func findRecord(records []SupplierRecord, substr string) *SupplierRecord {
	for i := range records {
		if strings.Contains(records[i].CompanyName, substr) {
			return &records[i]
		}
	}
	return nil
}
