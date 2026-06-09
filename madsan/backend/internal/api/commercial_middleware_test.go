package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"
)

func TestRequireCommercialSourcesPassesWithoutKeys(t *testing.T) {
	srv := &Server{log: zerolog.Nop()}
	ok := false
	h := srv.requireCommercialSources(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { ok = true }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	if !ok {
		t.Fatal("expected pass-through")
	}
}
