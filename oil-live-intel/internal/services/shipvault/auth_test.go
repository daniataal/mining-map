package shipvault

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

func testLogger() zerolog.Logger {
	return zerolog.New(io.Discard)
}

func TestResolveAuthMode(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		opts ServiceOptions
		want AuthMode
	}{
		{
			name: "manual override wins",
			opts: ServiceOptions{
				BearerToken:    "jwt-manual",
				Email:          "a@b.com",
				Password:       "secret",
				FirebaseAPIKey: "key",
			},
			want: AuthManual,
		},
		{
			name: "refresh token without email",
			opts: ServiceOptions{
				RefreshToken:   "rt-xyz",
				FirebaseAPIKey: "key",
			},
			want: AuthRefresh,
		},
		{
			name: "session json",
			opts: ServiceOptions{
				SessionJSON: `{"idToken":"jwt","refreshToken":"rt"}`,
			},
			want: AuthRefresh,
		},
		{
			name: "auto when email password set",
			opts: ServiceOptions{
				Email:          "a@b.com",
				Password:       "secret",
				FirebaseAPIKey: "key",
			},
			want: AuthAuto,
		},
		{
			name: "auto with email password only",
			opts: ServiceOptions{
				Email:    "a@b.com",
				Password: "secret",
			},
			want: AuthAuto,
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := ResolveAuthMode(tc.opts); got != tc.want {
				t.Fatalf("ResolveAuthMode() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestFirebaseAuth_loginAndRefresh(t *testing.T) {
	t.Parallel()

	const (
		firstJWT  = "first-id-token"
		secondJWT = "refreshed-id-token"
	)

	var refreshCalls atomic.Int32

	signIn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("signIn method = %s", r.Method)
		}
		if !strings.Contains(r.URL.RawQuery, "key=test-api-key") {
			t.Errorf("signIn missing api key query: %s", r.URL.RawQuery)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["email"] != "user@example.com" || body["password"] != "pass123" {
			t.Errorf("unexpected login body: %#v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"idToken":      firstJWT,
			"refreshToken": "refresh-abc",
			"expiresIn":    "3600",
		})
	}))
	defer signIn.Close()

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		refreshCalls.Add(1)
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "refresh-abc" {
			t.Errorf("unexpected refresh form: %#v", r.Form)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  secondJWT,
			"refresh_token": "refresh-abc",
			"expires_in":    "3600",
		})
	}))
	defer tokenSrv.Close()

	auth := newFirebaseAuth("user@example.com", "pass123", "test-api-key", testLogger())
	auth.signInURL = signIn.URL
	auth.tokenURL = tokenSrv.URL

	if err := auth.login(context.Background()); err != nil {
		t.Fatalf("login: %v", err)
	}
	tok, err := auth.token(context.Background())
	if err != nil || tok != firstJWT {
		t.Fatalf("token after login = %q err=%v", tok, err)
	}

	auth.mu.Lock()
	auth.expiresAt = time.Now().Add(5 * time.Minute)
	auth.mu.Unlock()

	tok, err = auth.token(context.Background())
	if err != nil || tok != secondJWT {
		t.Fatalf("token after refresh = %q err=%v refreshCalls=%d", tok, err, refreshCalls.Load())
	}
	if refreshCalls.Load() != 1 {
		t.Fatalf("expected 1 refresh call, got %d", refreshCalls.Load())
	}
}

func TestFirebaseAuth_loginFailure(t *testing.T) {
	t.Parallel()

	signIn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"INVALID_PASSWORD"}}`))
	}))
	defer signIn.Close()

	auth := newFirebaseAuth("user@example.com", "wrong", "key", testLogger())
	auth.signInURL = signIn.URL

	err := auth.login(context.Background())
	if err == nil || !strings.Contains(err.Error(), "INVALID_PASSWORD") {
		t.Fatalf("expected INVALID_PASSWORD error, got %v", err)
	}
}

func TestService_doRequest_retries401WithAutoAuth(t *testing.T) {
	t.Parallel()

	const (
		firstJWT  = "token-one"
		secondJWT = "token-two"
	)

	signIn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"idToken":      firstJWT,
			"refreshToken": "rt",
			"expiresIn":    "3600",
		})
	}))
	defer signIn.Close()

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  secondJWT,
			"refresh_token": "rt",
			"expires_in":    "3600",
		})
	}))
	defer tokenSrv.Close()

	var apiCalls atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := apiCalls.Add(1)
		auth := r.Header.Get("Authorization")
		switch n {
		case 1:
			if auth != "Bearer "+firstJWT {
				t.Errorf("call 1 auth = %q", auth)
			}
			w.WriteHeader(http.StatusUnauthorized)
		case 2:
			if auth != "Bearer "+secondJWT {
				t.Errorf("call 2 auth = %q", auth)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"imo": "1234567", "name": "TEST SHIP"})
		default:
			t.Fatalf("unexpected api call %d", n)
		}
	}))
	defer api.Close()

	fb := newFirebaseAuth("user@example.com", "pass", "key", testLogger())
	fb.signInURL = signIn.URL
	fb.tokenURL = tokenSrv.URL
	if err := fb.login(context.Background()); err != nil {
		t.Fatal(err)
	}

	svc := &Service{
		baseURL:    api.URL,
		authMode:   AuthAuto,
		tokenProv:  fb,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		log:        testLogger(),
	}

	var out map[string]any
	if err := svc.doRequest(context.Background(), "/api/units/shipsearch/1234567?page=1&pageSize=50&sortColumn=name&sortDir=ASC", &out); err != nil {
		t.Fatalf("doRequest: %v", err)
	}
	if apiCalls.Load() != 2 {
		t.Fatalf("expected 2 api calls, got %d", apiCalls.Load())
	}
	if out["name"] != "TEST SHIP" {
		t.Fatalf("unexpected body: %#v", out)
	}
}

func TestFirebaseAuth_refreshOnlyBootstrap(t *testing.T) {
	t.Parallel()

	const refreshedJWT = "from-refresh-only"

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("refresh_token") != "long-lived-rt" {
			t.Errorf("refresh_token = %q", r.Form.Get("refresh_token"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  refreshedJWT,
			"refresh_token": "long-lived-rt",
			"expires_in":    "3600",
		})
	}))
	defer tokenSrv.Close()

	auth := newFirebaseAuth("", "", "test-api-key", testLogger())
	auth.tokenURL = tokenSrv.URL

	if err := bootstrapFirebaseAuth(context.Background(), auth, ServiceOptions{
		RefreshToken:   "long-lived-rt",
		FirebaseAPIKey: "test-api-key",
	}); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	tok, err := auth.token(context.Background())
	if err != nil || tok != refreshedJWT {
		t.Fatalf("token = %q err=%v", tok, err)
	}
}

func TestBootstrapFirebaseAuth_sessionJSON(t *testing.T) {
	t.Parallel()

	auth := newFirebaseAuth("", "", "key", testLogger())
	sess := `{"idToken":"sess-jwt","refreshToken":"sess-rt","expiresIn":"3600"}`
	if err := bootstrapFirebaseAuth(context.Background(), auth, ServiceOptions{SessionJSON: sess}); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	tok, err := auth.token(context.Background())
	if err != nil || tok != "sess-jwt" {
		t.Fatalf("token = %q err=%v", tok, err)
	}
}

func TestResolveFirebaseAPIKey_discoversFromApp(t *testing.T) {
	t.Parallel()

	const apiKey = "AIzaSy000000000000000000000000000000000"

	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			_, _ = w.Write([]byte(`<html><script src="/assets/app.js"></script></html>`))
		case "/assets/app.js":
			_, _ = w.Write([]byte(`firebase.initializeApp({apiKey:"` + apiKey + `"})`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer app.Close()

	got, err := resolveFirebaseAPIKey(context.Background(), ServiceOptions{AppOriginURL: app.URL}, app.Client())
	if err != nil {
		t.Fatal(err)
	}
	if got != apiKey {
		t.Fatalf("resolveFirebaseAPIKey() = %q, want %q", got, apiKey)
	}
}

func TestFirebaseAuth_persistsRefreshTokenOnRotate(t *testing.T) {
	t.Parallel()
	var saved []string
	auth := newFirebaseAuth("", "", "key", testLogger())
	auth.onRefreshTokenPersist = func(rt string) { saved = append(saved, rt) }
	auth.storeTokens("jwt", "rt-1", time.Hour)
	if len(saved) != 1 || saved[0] != "rt-1" {
		t.Fatalf("persist = %#v", saved)
	}
	auth.storeTokens("jwt2", "rt-2", time.Hour)
	if len(saved) != 2 || saved[1] != "rt-2" {
		t.Fatalf("persist after rotate = %#v", saved)
	}
}

func TestNewService_manualToken(t *testing.T) {
	t.Parallel()

	svc, mode, err := NewService(ServiceOptions{
		BaseURL:     "http://example.com",
		BearerToken: "manual-jwt",
	}, testLogger())
	if err != nil {
		t.Fatal(err)
	}
	if mode != AuthManual {
		t.Fatalf("mode = %v", mode)
	}
	if !svc.HasToken() {
		t.Fatal("expected HasToken true")
	}
}
