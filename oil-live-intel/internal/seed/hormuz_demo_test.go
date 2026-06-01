package seed

import (
	"testing"
)

func TestEnsureHormuzCrisisDemoMCR_skipsWhenDemoDisabled(t *testing.T) {
	t.Setenv("OIL_LIVE_DISABLE_DEMO_SEED", "1")
	if err := EnsureHormuzCrisisDemoMCR(t.Context(), nil); err != nil {
		t.Fatal(err)
	}
}
