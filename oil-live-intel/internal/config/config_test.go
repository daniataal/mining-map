package config

import "testing"

func TestDisableDemoSeed_defaultTrue(t *testing.T) {
	t.Setenv("OIL_LIVE_DISABLE_DEMO_SEED", "")
	cfg := Load()
	if !cfg.DisableDemoSeed {
		t.Fatalf("expected DisableDemoSeed true when env unset, got false")
	}
}

func TestDisableDemoSeed_explicitOff(t *testing.T) {
	t.Setenv("OIL_LIVE_DISABLE_DEMO_SEED", "0")
	cfg := Load()
	if cfg.DisableDemoSeed {
		t.Fatalf("expected DisableDemoSeed false when env=0, got true")
	}
}

func TestShipVaultEnabled_manualToken(t *testing.T) {
	t.Setenv("SHIPVAULT_BEARER_TOKEN", "jwt")
	t.Setenv("SHIPVAULT_EMAIL", "")
	t.Setenv("SHIPVAULT_PASSWORD", "")
	t.Setenv("SHIPVAULT_FIREBASE_API_KEY", "")
	cfg := Load()
	if !cfg.ShipVaultEnabled {
		t.Fatal("expected enabled with bearer token")
	}
}

func TestShipVaultEnabled_autoAuth(t *testing.T) {
	t.Setenv("SHIPVAULT_BEARER_TOKEN", "")
	t.Setenv("SHIPVAULT_REFRESH_TOKEN", "")
	t.Setenv("SHIPVAULT_SESSION_JSON", "")
	t.Setenv("SHIPVAULT_EMAIL", "a@b.com")
	t.Setenv("SHIPVAULT_PASSWORD", "secret")
	t.Setenv("SHIPVAULT_FIREBASE_API_KEY", "")
	cfg := Load()
	if !cfg.ShipVaultEnabled {
		t.Fatal("expected enabled with email/password")
	}
}

func TestShipVaultEnabled_refreshToken(t *testing.T) {
	t.Setenv("SHIPVAULT_BEARER_TOKEN", "")
	t.Setenv("SHIPVAULT_REFRESH_TOKEN", "long-lived-refresh")
	t.Setenv("SHIPVAULT_SESSION_JSON", "")
	t.Setenv("SHIPVAULT_EMAIL", "")
	t.Setenv("SHIPVAULT_PASSWORD", "")
	cfg := Load()
	if !cfg.ShipVaultEnabled {
		t.Fatal("expected enabled with refresh token only")
	}
}

func TestShipVaultConfigured_dbToken(t *testing.T) {
	t.Setenv("SHIPVAULT_BEARER_TOKEN", "")
	t.Setenv("SHIPVAULT_REFRESH_TOKEN", "")
	t.Setenv("SHIPVAULT_SESSION_JSON", "")
	t.Setenv("SHIPVAULT_EMAIL", "")
	t.Setenv("SHIPVAULT_PASSWORD", "")
	cfg := Load()
	if !cfg.ShipVaultConfigured(true) {
		t.Fatal("expected configured when DB has refresh token")
	}
	if cfg.ShipVaultConfigured(false) {
		t.Fatal("expected not configured without env or DB")
	}
}

func TestShipVaultEnabled_disabled(t *testing.T) {
	t.Setenv("SHIPVAULT_BEARER_TOKEN", "")
	t.Setenv("SHIPVAULT_REFRESH_TOKEN", "")
	t.Setenv("SHIPVAULT_SESSION_JSON", "")
	t.Setenv("SHIPVAULT_EMAIL", "")
	t.Setenv("SHIPVAULT_PASSWORD", "")
	cfg := Load()
	if cfg.ShipVaultEnabled {
		t.Fatal("expected disabled without credentials")
	}
}
