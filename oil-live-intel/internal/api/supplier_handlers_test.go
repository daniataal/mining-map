package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mining-map/oil-live-intel/internal/config"
)

func TestTriggerBunkerFuelSuppliersSyncUnauthorized(t *testing.T) {
	s := &Server{Config: config.Config{InternalBroadcastKey: "secret"}}
	req := httptest.NewRequest(http.MethodPost, "/api/oil-live/internal/bunker-fuel-suppliers/sync", nil)
	rec := httptest.NewRecorder()
	s.TriggerBunkerFuelSuppliersSync(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
