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
