package config

import (
	"os"
	"path/filepath"
	"testing"
)

func expectedMadsanRawDir(t *testing.T) string {
	t.Helper()
	dir := locateMadsanRawDir()
	if dir == "" {
		t.Fatal("locateMadsanRawDir returned empty")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("expected madsan raw dir missing: %s (%v)", dir, err)
	}
	return dir
}

func TestResolveRawDirModuleDefault(t *testing.T) {
	want := expectedMadsanRawDir(t)

	for _, raw := range []string{"", "raw", "../raw", "madsan/raw", "./madsan/raw"} {
		name := raw
		if name == "" {
			name = "empty"
		}
		t.Run(name, func(t *testing.T) {
			if got := resolveRawDir(raw); got != want {
				t.Fatalf("resolveRawDir(%q) = %q, want %q", raw, got, want)
			}
		})
	}
}

func TestGrantMapPremiumLayersDevDefault(t *testing.T) {
	t.Setenv("MADSAN_GRANT_MAP_PREMIUM_LAYERS", "")
	t.Setenv("MADSAN_JWT_SECRET", "dev-change-me-in-production")
	if !grantMapPremiumLayersDefault() {
		t.Fatal("expected grant when JWT secret is dev default")
	}
	t.Setenv("MADSAN_JWT_SECRET", "production-secret")
	if grantMapPremiumLayersDefault() {
		t.Fatal("expected no grant with production JWT secret")
	}
	t.Setenv("MADSAN_GRANT_MAP_PREMIUM_LAYERS", "true")
	if !grantMapPremiumLayersDefault() {
		t.Fatal("expected explicit env override true")
	}
}

func TestResolveRawDirIgnoresCwd(t *testing.T) {
	want := expectedMadsanRawDir(t)
	backendDir := filepath.Dir(filepath.Dir(want)) // madsan/backend

	cases := []struct {
		name string
		cwd  string
	}{
		{"backend", backendDir},
		{"madsan", filepath.Dir(backendDir)},
		{"temp", t.TempDir()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Chdir(tc.cwd)
			if got := resolveRawDir("madsan/raw"); got != want {
				t.Fatalf("cwd=%q: resolveRawDir(madsan/raw) = %q, want %q", tc.cwd, got, want)
			}
			if got := resolveRawDir(""); got != want {
				t.Fatalf("cwd=%q: resolveRawDir(\"\") = %q, want %q", tc.cwd, got, want)
			}
		})
	}
}

func TestResolveRawDirAbsolutePassthrough(t *testing.T) {
	const dockerRaw = "/raw"
	if got := resolveRawDir(dockerRaw); got != dockerRaw {
		t.Fatalf("resolveRawDir(/raw) = %q, want %q", got, dockerRaw)
	}
}

func TestResolveRawDirWrongAbsoluteBackendPath(t *testing.T) {
	want := expectedMadsanRawDir(t)
	backendDir := filepath.Dir(filepath.Dir(want))
	wrong := filepath.Join(backendDir, "madsan", "raw")

	if got := resolveRawDir(wrong); got != want {
		t.Fatalf("resolveRawDir(wrong abs) = %q, want %q", got, want)
	}
	t.Setenv("MADSAN_RAW_DIR", wrong)
	if got := Load().RawDataDir; got != want {
		t.Fatalf("Load().RawDataDir with wrong env = %q, want %q", got, want)
	}
}

func TestLocateMadsanRawDirHasSeed(t *testing.T) {
	dir := locateMadsanRawDir()
	if dir == "" {
		t.Fatal("locateMadsanRawDir returned empty")
	}
	if !rawDirHasSeed(dir) {
		t.Fatalf("expected seed marker in %s", dir)
	}
}
