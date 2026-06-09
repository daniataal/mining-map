package datarepo

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileJoinsName(t *testing.T) {
	path := File("bunker_fuel_suppliers_seed.json")
	if filepath.Base(path) != "bunker_fuel_suppliers_seed.json" {
		t.Fatalf("unexpected path: %s", path)
	}
}

func TestDirHonorsMeridianDataDir(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("MERIDIAN_DATA_DIR", tmp)
	if got := Dir(); got != tmp {
		t.Fatalf("Dir() = %q want %q", got, tmp)
	}
}

func TestDirFallback(t *testing.T) {
	t.Setenv("MERIDIAN_DATA_DIR", "")
	dir := Dir()
	if dir == "" {
		t.Fatal("Dir() returned empty")
	}
	_ = os.Getenv("MERIDIAN_DATA_DIR")
}
