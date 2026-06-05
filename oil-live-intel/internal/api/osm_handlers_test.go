package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestOSMLayerMVTUnknownLayer(t *testing.T) {
	s := &Server{}
	r := chi.NewRouter()
	r.Get("/tiles/{layer_id}/{z}/{x}/{y}.pbf", s.OSMLayerMVT)

	req := httptest.NewRequest(http.MethodGet, "/tiles/unknown/10/512/384.pbf", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d", w.Code)
	}
}

func TestOSMLayerMVTInvalidZ(t *testing.T) {
	s := &Server{Pool: nil}
	r := chi.NewRouter()
	r.Get("/tiles/{layer_id}/{z}/{x}/{y}.pbf", s.OSMLayerMVT)

	req := httptest.NewRequest(http.MethodGet, "/tiles/pipelines/not-a-number/512/384.pbf", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d", w.Code)
	}
}

func TestOSMLayerMVTNoPool(t *testing.T) {
	s := &Server{Pool: nil}
	r := chi.NewRouter()
	r.Get("/tiles/{layer_id}/{z}/{x}/{y}.pbf", s.OSMLayerMVT)

	req := httptest.NewRequest(http.MethodGet, "/tiles/pipelines/10/512/384.pbf", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", w.Code)
	}
}

func TestOSMLayersCatalogIncludesMVT(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/map/petroleum-osm/layers", nil)
	w := httptest.NewRecorder()
	s.OSMLayersCatalog(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"render_mode":"mvt"`) ||
		!strings.Contains(body, `"tile_url_template"`) ||
		!strings.Contains(body, `"source_layer":"petroleum_osm"`) {
		t.Fatalf("catalog missing mvt fields: %s", body)
	}
}
