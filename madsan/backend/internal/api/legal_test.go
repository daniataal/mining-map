package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/auth"
	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
)

func testLegalServer(t *testing.T) *Server {
	t.Helper()
	secret := "test-secret"
	return &Server{
		auth: auth.New(nil, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
		cfg:  config.Config{JWTSecret: secret},
	}
}

func TestLegalDisputeValidation(t *testing.T) {
	srv := testLegalServer(t)
	handler := srv.Router()

	tests := []struct {
		name       string
		body       map[string]any
		wantStatus int
		wantBody   string
	}{
		{
			name:       "missing description",
			body:       map[string]any{"contact_email": "a@b.com", "request_type": "correction"},
			wantStatus: http.StatusBadRequest,
			wantBody:   "description required",
		},
		{
			name:       "missing contact_email",
			body:       map[string]any{"description": "fix map pin", "request_type": "correction"},
			wantStatus: http.StatusBadRequest,
			wantBody:   "contact_email required",
		},
		{
			name:       "invalid request_type",
			body:       map[string]any{"description": "x", "contact_email": "a@b.com", "request_type": "invalid"},
			wantStatus: http.StatusBadRequest,
			wantBody:   "request_type must be correction, dispute, or appeal",
		},
		{
			name:       "bad json",
			body:       nil,
			wantStatus: http.StatusBadRequest,
			wantBody:   "bad request",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var req *http.Request
			if tc.body == nil {
				req = httptest.NewRequest(http.MethodPost, "/api/legal/dispute", strings.NewReader("{"))
			} else {
				raw, _ := json.Marshal(tc.body)
				req = httptest.NewRequest(http.MethodPost, "/api/legal/dispute", bytes.NewReader(raw))
			}
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d body=%q", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.wantBody) {
				t.Fatalf("body = %q, want substring %q", rec.Body.String(), tc.wantBody)
			}
		})
	}
}

func TestGDPRErasureValidation(t *testing.T) {
	srv := testLegalServer(t)
	handler := srv.Router()

	tests := []struct {
		name       string
		body       map[string]any
		wantStatus int
		wantBody   string
	}{
		{
			name:       "missing scope",
			body:       map[string]any{"contact_email": "a@b.com", "request_type": "erasure"},
			wantStatus: http.StatusBadRequest,
			wantBody:   "scope required",
		},
		{
			name:       "missing contact_email",
			body:       map[string]any{"scope": "account deletion", "request_type": "erasure"},
			wantStatus: http.StatusBadRequest,
			wantBody:   "contact_email required",
		},
		{
			name:       "invalid request_type",
			body:       map[string]any{"scope": "all", "contact_email": "a@b.com", "request_type": "access"},
			wantStatus: http.StatusBadRequest,
			wantBody:   "request_type must be erasure",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			raw, _ := json.Marshal(tc.body)
			req := httptest.NewRequest(http.MethodPost, "/api/legal/privacy/erasure", bytes.NewReader(raw))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d body=%q", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.wantBody) {
				t.Fatalf("body = %q, want substring %q", rec.Body.String(), tc.wantBody)
			}
		})
	}
}

func TestLegalRoutesOptionalAuth(t *testing.T) {
	srv := testLegalServer(t)
	handler := srv.Router()

	// Incomplete payloads stop at validation before DB access.
	disputeBody, _ := json.Marshal(map[string]any{"request_type": "correction"})
	req := httptest.NewRequest(http.MethodPost, "/api/legal/dispute", bytes.NewReader(disputeBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Fatal("legal dispute should not require auth")
	}
	if rec.Code == http.StatusNotFound {
		t.Fatal("legal dispute route not registered")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("dispute status = %d, want 400 for validation-only probe", rec.Code)
	}

	erasureBody, _ := json.Marshal(map[string]any{"request_type": "erasure"})
	req = httptest.NewRequest(http.MethodPost, "/api/legal/privacy/erasure", bytes.NewReader(erasureBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code == http.StatusUnauthorized {
		t.Fatal("gdpr erasure should not require auth")
	}
	if rec.Code == http.StatusNotFound {
		t.Fatal("gdpr erasure route not registered")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("erasure status = %d, want 400 for validation-only probe", rec.Code)
	}
}

func TestLegalEnqueueIntegration(t *testing.T) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set")
	}

	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	secret := "test-secret"
	srv := &Server{
		pool: pool,
		auth: auth.New(pool, config.Config{JWTSecret: secret}),
		log:  zerolog.Nop(),
		cfg:  config.Config{JWTSecret: secret},
	}
	handler := srv.Router()

	disputeBody, _ := json.Marshal(map[string]any{
		"request_type":  "dispute",
		"description":   "challenge sanctions flag",
		"contact_email": "legal-test@example.com",
		"entity_type":   "company",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/legal/dispute", bytes.NewReader(disputeBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("dispute status = %d, body=%q", rec.Code, rec.Body.String())
	}
	var disputeResp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &disputeResp); err != nil {
		t.Fatalf("decode dispute response: %v", err)
	}
	if disputeResp["status"] != "queued" {
		t.Fatalf("dispute status field = %q, want queued", disputeResp["status"])
	}
	if disputeResp["queue_id"] == "" {
		t.Fatal("expected queue_id in dispute response")
	}

	var entityType, reason string
	err = pool.QueryRow(ctx, `
		SELECT entity_type, reason FROM manual_review_queue WHERE id = $1::uuid
	`, disputeResp["queue_id"]).Scan(&entityType, &reason)
	if err != nil {
		t.Fatalf("fetch dispute queue row: %v", err)
	}
	if entityType != "legal_dispute" {
		t.Fatalf("entity_type = %q, want legal_dispute", entityType)
	}
	if reason != "legal_dispute_request" {
		t.Fatalf("reason = %q, want legal_dispute_request", reason)
	}

	erasureBody, _ := json.Marshal(map[string]any{
		"request_type":  "erasure",
		"contact_email": "privacy-test@example.com",
		"scope":         "delete account and submissions",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/legal/privacy/erasure", bytes.NewReader(erasureBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("erasure status = %d, body=%q", rec.Code, rec.Body.String())
	}
	var erasureResp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &erasureResp); err != nil {
		t.Fatalf("decode erasure response: %v", err)
	}
	if erasureResp["status"] != "queued" {
		t.Fatalf("erasure status field = %q, want queued", erasureResp["status"])
	}

	err = pool.QueryRow(ctx, `
		SELECT entity_type, reason FROM manual_review_queue WHERE id = $1::uuid
	`, erasureResp["queue_id"]).Scan(&entityType, &reason)
	if err != nil {
		t.Fatalf("fetch erasure queue row: %v", err)
	}
	if entityType != "gdpr_erasure_request" {
		t.Fatalf("entity_type = %q, want gdpr_erasure_request", entityType)
	}
	if reason != "gdpr_erasure_request" {
		t.Fatalf("reason = %q, want gdpr_erasure_request", reason)
	}
}
