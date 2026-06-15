package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/auth"
	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
)

func TestWithTenantGUCNoClaims(t *testing.T) {
	srv := &Server{log: zerolog.Nop()}
	called := false
	handler := srv.withTenantGUC(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if _, ok := database.TenantIDFromContext(r.Context()); ok {
			t.Fatal("tenant id should not be set without auth claims")
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called || rec.Code != http.StatusOK {
		t.Fatalf("handler not called cleanly: called=%v status=%d", called, rec.Code)
	}
}

func TestWithTenantGUCStoresTenantWithoutDB(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
	}
	var gotTenant uuid.UUID
	chain := srv.requireAuth(srv.withTenantGUC(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var ok bool
		gotTenant, ok = database.TenantIDFromContext(r.Context())
		if !ok {
			t.Fatal("expected tenant id in context")
		}
		w.WriteHeader(http.StatusOK)
	})))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "madsan_access", Value: testAccessToken(t, secret)})
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if gotTenant == uuid.Nil {
		t.Fatal("expected non-nil tenant id")
	}
}
