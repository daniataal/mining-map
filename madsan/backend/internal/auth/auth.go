package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/madsan/intelligence/internal/config"
)

type Claims struct {
	UserID   string `json:"uid"`
	TenantID string `json:"tid,omitempty"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

type Service struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func New(pool *pgxpool.Pool, cfg config.Config) *Service {
	return &Service{pool: pool, cfg: cfg}
}

func (s *Service) Register(ctx context.Context, email, password, displayName, tenantSlug string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var userID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3)
		ON CONFLICT (email) DO NOTHING RETURNING id
	`, email, string(hash), displayName).Scan(&userID)
	if err != nil {
		return errors.New("email already registered")
	}
	var tenantID uuid.UUID
	if tenantSlug == "" {
		tenantSlug = "default"
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO tenants (name, slug) VALUES ($1,$2)
		ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id
	`, tenantSlug, tenantSlug).Scan(&tenantID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'broker')
		ON CONFLICT DO NOTHING
	`, tenantID, userID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_subscriptions (tenant_id, plan_id, status)
		SELECT $1, p.id, 'active' FROM plans p WHERE p.slug = 'free'
		ON CONFLICT DO NOTHING
	`, tenantID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) Login(ctx context.Context, email, password string) (access string, refresh string, err error) {
	var userID uuid.UUID
	var hash string
	var role string
	var tenantID uuid.UUID
	err = s.pool.QueryRow(ctx, `
		SELECT u.id, u.password_hash, COALESCE(m.role,'viewer'), m.tenant_id
		FROM users u
		LEFT JOIN memberships m ON m.user_id = u.id
		WHERE u.email = $1 AND u.is_active = true
		LIMIT 1
	`, email).Scan(&userID, &hash, &role, &tenantID)
	if err != nil {
		return "", "", errors.New("invalid credentials")
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return "", "", errors.New("invalid credentials")
	}
	access, err = s.signAccess(userID, tenantID, role)
	if err != nil {
		return "", "", err
	}
	refresh, err = s.createRefresh(ctx, userID)
	return access, refresh, err
}

func (s *Service) signAccess(userID, tenantID uuid.UUID, role string) (string, error) {
	claims := Claims{
		UserID:   userID.String(),
		TenantID: tenantID.String(),
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.cfg.AccessTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(s.cfg.JWTSecret))
}

func (s *Service) createRefresh(ctx context.Context, userID uuid.UUID) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)
	h := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(ctx, `
		INSERT INTO sessions (user_id, refresh_token_hash, expires_at)
		VALUES ($1,$2,$3)
	`, userID, hex.EncodeToString(h[:]), time.Now().Add(s.cfg.RefreshTokenTTL))
	return token, err
}

func (s *Service) authCookie(name, value, path string, maxAge int, sameSite http.SameSite) *http.Cookie {
	c := &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: sameSite,
		MaxAge:   maxAge,
	}
	if s.cfg.CookieDomain != "" {
		c.Domain = s.cfg.CookieDomain
	}
	return c
}

func (s *Service) SetAuthCookies(w http.ResponseWriter, access, refresh string) {
	refreshSameSite := http.SameSiteStrictMode
	if !s.cfg.CookieSecure {
		refreshSameSite = http.SameSiteLaxMode
	}
	http.SetCookie(w, s.authCookie("madsan_access", access, "/", int(s.cfg.AccessTokenTTL.Seconds()), http.SameSiteLaxMode))
	if refresh != "" {
		http.SetCookie(w, s.authCookie("madsan_refresh", refresh, "/api/core/auth", int(s.cfg.RefreshTokenTTL.Seconds()), refreshSameSite))
	}
}

func (s *Service) ClearAuthCookies(w http.ResponseWriter) {
	http.SetCookie(w, s.authCookie("madsan_access", "", "/", -1, http.SameSiteLaxMode))
	http.SetCookie(w, s.authCookie("madsan_refresh", "", "/api/core/auth", -1, http.SameSiteLaxMode))
}

func (s *Service) ParseRequest(r *http.Request) (*Claims, error) {
	var token string
	if c, err := r.Cookie("madsan_access"); err == nil {
		token = c.Value
	} else if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		token = strings.TrimPrefix(h, "Bearer ")
	}
	if token == "" {
		return nil, errors.New("unauthorized")
	}
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		return []byte(s.cfg.JWTSecret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
