package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDeployEnvSetsUnsetKeys(t *testing.T) {
	root := t.TempDir()
	backend := filepath.Join(root, "madsan", "backend")
	deploy := filepath.Join(root, "madsan", "deploy")
	if err := os.MkdirAll(backend, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(deploy, 0o755); err != nil {
		t.Fatal(err)
	}
	envPath := filepath.Join(deploy, ".env")
	if err := os.WriteFile(envPath, []byte("EIA_API_KEY=from-deploy-env\nSHIPVAULT_BEARER_TOKEN=sv-test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	if err := os.Chdir(backend); err != nil {
		t.Fatal(err)
	}

	t.Setenv("EIA_API_KEY", "")
	t.Setenv("SHIPVAULT_BEARER_TOKEN", "")

	LoadDeployEnv()
	if got := os.Getenv("EIA_API_KEY"); got != "from-deploy-env" {
		t.Fatalf("EIA_API_KEY = %q, want from-deploy-env", got)
	}
	if got := os.Getenv("SHIPVAULT_BEARER_TOKEN"); got != "sv-test" {
		t.Fatalf("SHIPVAULT_BEARER_TOKEN = %q, want sv-test", got)
	}

	t.Setenv("EIA_API_KEY", "already-set")
	LoadDeployEnv()
	if got := os.Getenv("EIA_API_KEY"); got != "already-set" {
		t.Fatalf("LoadDeployEnv overwrote existing env: %q", got)
	}
}

func TestLoadReadsDeployEnvWhenUnset(t *testing.T) {
	root := t.TempDir()
	backend := filepath.Join(root, "madsan", "backend")
	deploy := filepath.Join(root, "madsan", "deploy")
	if err := os.MkdirAll(backend, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(deploy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deploy, ".env"), []byte("EIA_API_KEY=load-test-key\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	if err := os.Chdir(backend); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EIA_API_KEY", "")

	cfg := Load()
	if cfg.EIAAPIKey != "load-test-key" {
		t.Fatalf("cfg.EIAAPIKey = %q, want load-test-key", cfg.EIAAPIKey)
	}
}
