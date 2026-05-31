package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/rs/zerolog"
)

func TestShipVaultBootstrap_forbiddenWithoutAuth(t *testing.T) {
	t.Parallel()
	s := &Server{
		Config: config.Config{
			InternalBroadcastKey:      "secret",
			ShipVaultBootstrapAllowed: false,
		},
		Log: zerolog.Nop(),
	}
	body, _ := json.Marshal(map[string]string{"refreshToken": "rt-test"})
	req := httptest.NewRequest(http.MethodPost, "/api/oil-live/admin/shipvault/bootstrap", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	s.ShipVaultBootstrap(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestShipVaultBootstrap_allowedWithInternalKey(t *testing.T) {
	t.Parallel()
	s := &Server{
		Config: config.Config{
			InternalBroadcastKey:      "secret",
			ShipVaultBootstrapAllowed: false,
		},
		Log: zerolog.Nop(),
	}
	if !s.shipVaultBootstrapAllowed(httptest.NewRequest(http.MethodPost, "/", nil)) {
		// no header — still forbidden
	}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("X-Oil-Intel-Internal", "secret")
	if !s.shipVaultBootstrapAllowed(req) {
		t.Fatal("expected internal key to allow bootstrap")
	}
}

func TestShipVaultBootstrap_devFlag(t *testing.T) {
	t.Parallel()
	s := &Server{
		Config: config.Config{ShipVaultBootstrapAllowed: true},
	}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	if !s.shipVaultBootstrapAllowed(req) {
		t.Fatal("expected SHIPVAULT_BOOTSTRAP_ALLOWED to allow bootstrap")
	}
}
