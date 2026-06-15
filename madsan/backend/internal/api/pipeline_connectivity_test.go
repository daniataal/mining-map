package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/madsan/intelligence/internal/config"
)

func TestPipelineConnectivityRouteRegistered(t *testing.T) {
	srv := &Server{cfg: config.Config{}}
	handler := srv.Router()

	req := httptest.NewRequest(http.MethodGet, "/api/energy/pipelines/not-a-uuid/connectivity", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code == http.StatusNotFound {
		t.Fatal("pipeline connectivity route not registered")
	}
}
