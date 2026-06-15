package shipvault

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

const (
	firebaseSignInURL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
	firebaseTokenURL  = "https://securetoken.googleapis.com/v1/token"
	// refreshMargin refreshes the JWT this long before Firebase reports expiry (~1h).
	refreshMargin = 10 * time.Minute
)

// AuthMode describes how ShipVault credentials are supplied.
type AuthMode int

const (
	AuthDisabled AuthMode = iota
	AuthManual
	AuthRefresh
	AuthAuto
)

func (m AuthMode) String() string {
	switch m {
	case AuthManual:
		return "manual token"
	case AuthRefresh:
		return "refresh token"
	case AuthAuto:
		return "email/password"
	default:
		return "disabled"
	}
}

// RefreshTokenPersister persists rotated Firebase refresh tokens (e.g. Postgres).
type RefreshTokenPersister func(ctx context.Context, refreshToken string) error

// ServiceOptions configures the ShipVault client.
type ServiceOptions struct {
	BaseURL        string
	CacheTTLDays   int
	BearerToken    string // manual override; highest priority
	RefreshToken   string // DevTools refreshToken — auto-refresh without re-login
	SessionJSON    string // one-shot {idToken, refreshToken, expiresIn} from DevTools
	Email          string
	Password       string
	FirebaseAPIKey string // optional; discovered from app.shipvault.io when empty
	AppOriginURL   string // web app origin for discovery (default https://app.shipvault.io)
	// PersistRefreshToken is called whenever Firebase returns or rotates a refresh token.
	PersistRefreshToken RefreshTokenPersister
}

// ResolveAuthMode priority: manual bearer > refresh/session > email/password.
func ResolveAuthMode(opts ServiceOptions) AuthMode {
	if strings.TrimSpace(opts.BearerToken) != "" {
		return AuthManual
	}
	if strings.TrimSpace(opts.SessionJSON) != "" || strings.TrimSpace(opts.RefreshToken) != "" {
		return AuthRefresh
	}
	if strings.TrimSpace(opts.Email) != "" && strings.TrimSpace(opts.Password) != "" {
		return AuthAuto
	}
	return AuthDisabled
}

// firebaseSession is the sign-in / securetoken shape copied from DevTools.
type firebaseSession struct {
	IDToken      string `json:"idToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    string `json:"expiresIn"`
}

func parseFirebaseSession(raw string) (firebaseSession, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return firebaseSession{}, fmt.Errorf("empty session json")
	}
	var s firebaseSession
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return firebaseSession{}, fmt.Errorf("shipvault session json: %w", err)
	}
	if s.RefreshToken == "" && s.IDToken == "" {
		return firebaseSession{}, fmt.Errorf("shipvault session json: need idToken or refreshToken")
	}
	return s, nil
}

type tokenProvider interface {
	token(ctx context.Context) (string, error)
	invalidate()
	hasToken() bool
}

type staticTokenProvider struct {
	bearer string
}

func (p *staticTokenProvider) token(_ context.Context) (string, error) {
	if p.bearer == "" {
		return "", fmt.Errorf("no ShipVault token configured")
	}
	return p.bearer, nil
}

func (p *staticTokenProvider) invalidate() {}

func (p *staticTokenProvider) hasToken() bool { return p.bearer != "" }

type firebaseAuth struct {
	email, password, apiKey string
	signInURL, tokenURL     string
	httpClient              *http.Client
	log                     zerolog.Logger
	onRefreshTokenPersist   func(string)

	mu           sync.Mutex
	idToken      string
	refreshToken string
	expiresAt    time.Time
}

func newFirebaseAuth(email, password, apiKey string, log zerolog.Logger) *firebaseAuth {
	return &firebaseAuth{
		email:      email,
		password:   password,
		apiKey:     apiKey,
		signInURL:  firebaseSignInURL,
		tokenURL:   firebaseTokenURL,
		httpClient: &http.Client{Timeout: httpTimeout},
		log:        log,
	}
}

// bootstrapFirebaseAuth seeds tokens from session/refresh env and obtains a valid JWT.
func bootstrapFirebaseAuth(ctx context.Context, fb *firebaseAuth, opts ServiceOptions) error {
	if raw := strings.TrimSpace(opts.SessionJSON); raw != "" {
		sess, err := parseFirebaseSession(raw)
		if err != nil {
			return err
		}
		refresh := sess.RefreshToken
		if refresh == "" {
			refresh = strings.TrimSpace(opts.RefreshToken)
		}
		if sess.IDToken != "" {
			fb.storeTokens(sess.IDToken, refresh, parseExpiresIn(sess.ExpiresIn))
			fb.mu.Lock()
			valid := fb.idToken != "" && time.Until(fb.expiresAt) > refreshMargin
			fb.mu.Unlock()
			if valid {
				return nil
			}
		}
		if refresh != "" {
			fb.mu.Lock()
			fb.refreshToken = refresh
			fb.mu.Unlock()
		}
	}

	if rt := strings.TrimSpace(opts.RefreshToken); rt != "" {
		fb.mu.Lock()
		if fb.refreshToken == "" {
			fb.refreshToken = rt
		}
		fb.mu.Unlock()
	}

	fb.mu.Lock()
	hasRefresh := fb.refreshToken != ""
	hasCreds := strings.TrimSpace(fb.email) != "" && strings.TrimSpace(fb.password) != ""
	fb.mu.Unlock()

	if hasRefresh {
		if err := fb.refreshWithToken(ctx); err == nil {
			return nil
		} else if !hasCreds {
			return fmt.Errorf("refresh token exchange failed: %w", err)
		}
	}
	if hasCreds {
		return fb.login(ctx)
	}
	return fmt.Errorf("no refresh token, session, or email/password configured")
}

func (a *firebaseAuth) hasToken() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.idToken != ""
}

func (a *firebaseAuth) invalidate() {
	a.mu.Lock()
	a.expiresAt = time.Time{}
	a.mu.Unlock()
}

func (a *firebaseAuth) token(ctx context.Context) (string, error) {
	a.mu.Lock()
	if a.idToken != "" && time.Until(a.expiresAt) > refreshMargin {
		tok := a.idToken
		a.mu.Unlock()
		return tok, nil
	}
	a.mu.Unlock()

	if err := a.refresh(ctx); err != nil {
		return "", err
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.idToken == "" {
		return "", fmt.Errorf("shipvault firebase auth: no token after refresh")
	}
	return a.idToken, nil
}

func (a *firebaseAuth) refresh(ctx context.Context) error {
	a.mu.Lock()
	hasRefresh := a.refreshToken != ""
	hasCreds := strings.TrimSpace(a.email) != "" && strings.TrimSpace(a.password) != ""
	a.mu.Unlock()

	if hasRefresh {
		if err := a.refreshWithToken(ctx); err == nil {
			return nil
		}
		if !hasCreds {
			return fmt.Errorf("shipvault firebase refresh failed and no email/password configured")
		}
		a.log.Warn().Msg("shipvault firebase refresh failed; re-authenticating")
	}

	if hasCreds {
		return a.login(ctx)
	}
	return fmt.Errorf("shipvault firebase: no refresh token and no email/password")
}

func (a *firebaseAuth) login(ctx context.Context) error {
	body, err := json.Marshal(map[string]any{
		"email":             a.email,
		"password":          a.password,
		"returnSecureToken": true,
	})
	if err != nil {
		return err
	}

	u := a.signInURL + "?key=" + url.QueryEscape(a.apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("shipvault firebase login: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("shipvault firebase login %d: %s", resp.StatusCode, sanitizeAuthError(raw))
	}

	var out struct {
		IDToken      string `json:"idToken"`
		RefreshToken string `json:"refreshToken"`
		ExpiresIn    string `json:"expiresIn"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return fmt.Errorf("shipvault firebase login decode: %w", err)
	}
	if out.IDToken == "" {
		return fmt.Errorf("shipvault firebase login: empty idToken")
	}

	a.storeTokens(out.IDToken, out.RefreshToken, parseExpiresIn(out.ExpiresIn))
	a.log.Info().Msg("shipvault firebase login succeeded")
	return nil
}

func (a *firebaseAuth) refreshWithToken(ctx context.Context) error {
	a.mu.Lock()
	refreshTok := a.refreshToken
	a.mu.Unlock()
	if refreshTok == "" {
		return fmt.Errorf("shipvault firebase refresh: no refresh token")
	}

	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshTok)

	u := a.tokenURL + "?key=" + url.QueryEscape(a.apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("shipvault firebase refresh: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("shipvault firebase refresh %d: %s", resp.StatusCode, sanitizeAuthError(raw))
	}

	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    string `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return fmt.Errorf("shipvault firebase refresh decode: %w", err)
	}
	if out.AccessToken == "" {
		return fmt.Errorf("shipvault firebase refresh: empty access_token")
	}

	refreshOut := out.RefreshToken
	if refreshOut == "" {
		refreshOut = refreshTok
	}

	a.storeTokens(out.AccessToken, refreshOut, parseExpiresIn(out.ExpiresIn))
	a.log.Info().Msg("shipvault firebase token refreshed")
	return nil
}

func (a *firebaseAuth) storeTokens(idToken, refreshToken string, ttl time.Duration) {
	if ttl <= 0 {
		ttl = time.Hour
	}
	var persist string
	a.mu.Lock()
	a.idToken = idToken
	if refreshToken != "" {
		a.refreshToken = refreshToken
		persist = refreshToken
	}
	a.expiresAt = time.Now().Add(ttl)
	a.mu.Unlock()
	if persist != "" && a.onRefreshTokenPersist != nil {
		a.onRefreshTokenPersist(persist)
	}
}

// refreshTokenValue returns the current Firebase refresh token (for DB persistence).
func (a *firebaseAuth) refreshTokenValue() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.refreshToken
}

// setRefreshToken seeds or replaces the refresh token and clears the cached JWT.
func (a *firebaseAuth) setRefreshToken(refreshToken string) {
	refreshToken = strings.TrimSpace(refreshToken)
	a.mu.Lock()
	a.refreshToken = refreshToken
	a.idToken = ""
	a.expiresAt = time.Time{}
	a.mu.Unlock()
}

func parseExpiresIn(raw string) time.Duration {
	secs, err := time.ParseDuration(raw + "s")
	if err != nil || secs <= 0 {
		return time.Hour
	}
	return secs
}

func sanitizeAuthError(raw []byte) string {
	var errBody struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &errBody) == nil && errBody.Error.Message != "" {
		return errBody.Error.Message
	}
	return strings.TrimSpace(string(raw))
}
