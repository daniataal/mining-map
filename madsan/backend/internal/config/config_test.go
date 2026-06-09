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
