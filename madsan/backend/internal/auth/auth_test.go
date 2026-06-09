package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/madsan/intelligence/internal/config"
)

func testService(t *testing.T, secure bool) *Service {
	t.Helper()
	return New(nil, config.Config{
		JWTSecret:       "test-secret",
		CookieSecure:    secure,
		CookieDomain:    "localhost",
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 7 * 24 * time.Hour,
	})
}

func signedAccessToken(t *testing.T, secret string) string {
	t.Helper()
	claims := Claims{
		UserID:   uuid.New().String(),
		TenantID: uuid.New().String(),
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

func TestParseRequestFromCookie(t *testing.T) {
	svc := testService(t, false)
	token := signedAccessToken(t, "test-secret")

	req := httptest.NewRequest(http.MethodGet, "/api/core/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: "madsan_access", Value: token})

	claims, err := svc.ParseRequest(req)
	if err != nil {
		t.Fatalf("ParseRequest: %v", err)
	}
	if claims.Role != "broker" {
		t.Fatalf("role = %q, want broker", claims.Role)
	}
}

func TestParseRequestFromBearerHeader(t *testing.T) {
	svc := testService(t, false)
	token := signedAccessToken(t, "test-secret")

	req := httptest.NewRequest(http.MethodGet, "/api/core/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	claims, err := svc.ParseRequest(req)
	if err != nil {
		t.Fatalf("ParseRequest: %v", err)
	}
	if claims.Role != "broker" {
		t.Fatalf("role = %q, want broker", claims.Role)
	}
}

func TestParseRequestPrefersCookieOverBearer(t *testing.T) {
	svc := testService(t, false)
	cookieToken := signedAccessToken(t, "test-secret")

	req := httptest.NewRequest(http.MethodGet, "/api/core/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: "madsan_access", Value: cookieToken})
	req.Header.Set("Authorization", "Bearer invalid-token")

	claims, err := svc.ParseRequest(req)
	if err != nil {
		t.Fatalf("ParseRequest: %v", err)
	}
	if claims.Role != "broker" {
		t.Fatalf("expected cookie token to win, got role %q", claims.Role)
	}
}

func TestParseRequestUnauthorized(t *testing.T) {
	svc := testService(t, false)
	req := httptest.NewRequest(http.MethodGet, "/api/core/auth/me", nil)
	if _, err := svc.ParseRequest(req); err == nil {
		t.Fatal("expected unauthorized error")
	}
}

func TestSetAuthCookiesDevAttributes(t *testing.T) {
	svc := testService(t, false)
	rec := httptest.NewRecorder()
	svc.SetAuthCookies(rec, "access-token", "refresh-token")

	cookies := rec.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("cookie count = %d, want 2", len(cookies))
	}
	byName := map[string]*http.Cookie{}
	for _, c := range cookies {
		byName[c.Name] = c
	}
	access := byName["madsan_access"]
	if access == nil || !access.HttpOnly || access.Secure || access.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected access cookie: %+v", access)
	}
	refresh := byName["madsan_refresh"]
	if refresh == nil || !refresh.HttpOnly || refresh.Secure || refresh.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected refresh cookie in dev: %+v", refresh)
	}
	if access.Domain != "localhost" || refresh.Domain != "localhost" {
		t.Fatalf("expected cookie domain localhost, got access=%q refresh=%q", access.Domain, refresh.Domain)
	}
}

func TestSetAuthCookiesProdSecure(t *testing.T) {
	svc := testService(t, true)
	rec := httptest.NewRecorder()
	svc.SetAuthCookies(rec, "access-token", "refresh-token")

	byName := map[string]*http.Cookie{}
	for _, c := range rec.Result().Cookies() {
		byName[c.Name] = c
	}
	access := byName["madsan_access"]
	refresh := byName["madsan_refresh"]
	if access == nil || !access.Secure || access.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected prod access cookie: %+v", access)
	}
	if refresh == nil || !refresh.Secure || refresh.SameSite != http.SameSiteStrictMode {
		t.Fatalf("unexpected prod refresh cookie: %+v", refresh)
	}
}

func TestClearAuthCookies(t *testing.T) {
	svc := testService(t, false)
	rec := httptest.NewRecorder()
	svc.ClearAuthCookies(rec)
	for _, c := range rec.Result().Cookies() {
		if c.MaxAge != -1 {
			t.Fatalf("cookie %s max-age = %d, want -1", c.Name, c.MaxAge)
		}
	}
}
