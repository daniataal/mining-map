package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/auth"
	"github.com/madsan/intelligence/internal/config"
)

func testAccessToken(t *testing.T, secret string) string {
	t.Helper()
	uid := uuid.New()
	tid := uuid.New()
	claims := auth.Claims{
		UserID:   uid.String(),
		TenantID: tid.String(),
		Role:     "broker",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func TestRequireAuthUnauthorized(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
	}
	called := false
	handler := srv.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if called {
		t.Fatal("next handler should not run without auth")
	}
}

func TestRequireAuthBearerHeaderFallback(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
	}
	var gotClaims *auth.Claims
	handler := srv.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var ok bool
		gotClaims, ok = authClaims(r)
		if !ok {
			t.Fatal("expected claims in context")
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+testAccessToken(t, secret))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if gotClaims == nil || gotClaims.Role != "broker" {
		t.Fatalf("unexpected claims: %+v", gotClaims)
	}
}

func TestRequireAuthStoresClaims(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
	}
	var gotClaims *auth.Claims
	handler := srv.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var ok bool
		gotClaims, ok = authClaims(r)
		if !ok {
			t.Fatal("expected claims in context")
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "madsan_access", Value: testAccessToken(t, secret)})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if gotClaims == nil || gotClaims.Role != "broker" {
		t.Fatalf("unexpected claims: %+v", gotClaims)
	}
}

func TestRequireEntitlementWithoutAuth(t *testing.T) {
	srv := &Server{log: zerolog.Nop()}
	handler := srv.requireEntitlement(featureDealVerification)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/deals/verify", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestDealsVerifyRouteRequiresAuth(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
		cfg:  config.Config{JWTSecret: secret},
	}
	handler := srv.Router()

	req := httptest.NewRequest(http.MethodPost, "/api/deals/verify", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST /api/deals/verify status = %d, want 401", rec.Code)
	}
}

func TestDealsPackRouteRequiresAuth(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
		cfg:  config.Config{JWTSecret: secret},
	}
	handler := srv.Router()

	req := httptest.NewRequest(http.MethodGet, "/api/deals/00000000-0000-0000-0000-000000000001/pack", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/deals/{id}/pack status = %d, want 401", rec.Code)
	}
}

func TestDealsChangesRouteRequiresAuth(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
		cfg:  config.Config{JWTSecret: secret},
	}
	handler := srv.Router()

	req := httptest.NewRequest(http.MethodGet, "/api/deals/00000000-0000-0000-0000-000000000001/changes", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/deals/{id}/changes status = %d, want 401", rec.Code)
	}
}

func TestAuthMeReadsCookie(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
		cfg:  config.Config{JWTSecret: secret},
	}
	handler := srv.Router()

	req := httptest.NewRequest(http.MethodGet, "/api/core/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: "madsan_access", Value: testAccessToken(t, secret)})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/core/auth/me status = %d, want 200", rec.Code)
	}
}

func TestAuthMeReadsBearerHeader(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
		cfg:  config.Config{JWTSecret: secret},
	}
	handler := srv.Router()

	req := httptest.NewRequest(http.MethodGet, "/api/core/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+testAccessToken(t, secret))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/core/auth/me status = %d, want 200", rec.Code)
	}
}

func TestAuthLogoutClearsCookies(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
		cfg:  config.Config{JWTSecret: secret},
	}
	handler := srv.Router()

	req := httptest.NewRequest(http.MethodPost, "/api/core/auth/logout", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/core/auth/logout status = %d, want 200", rec.Code)
	}
	cleared := 0
	for _, c := range rec.Result().Cookies() {
		if c.MaxAge < 0 {
			cleared++
		}
	}
	if cleared < 2 {
		t.Fatalf("expected cleared auth cookies, got %d", cleared)
	}
}

func TestDealsWatchRouteRequiresAuth(t *testing.T) {
	secret := "test-secret"
	srv := &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
		cfg:  config.Config{JWTSecret: secret},
	}
	handler := srv.Router()
	dealID := "00000000-0000-0000-0000-000000000001"

	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		req := httptest.NewRequest(method, "/api/deals/"+dealID+"/watch", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s /api/deals/{id}/watch status = %d, want 401", method, rec.Code)
		}
	}
}
