package api

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/auth"
)

type contextKey string

const claimsContextKey contextKey = "authClaims"

const (
	featureDealVerification = "deal_verification"
	featureDealPackExport   = "deal_pack_export"
)

func authClaims(r *http.Request) (*auth.Claims, bool) {
	claims, ok := r.Context().Value(claimsContextKey).(*auth.Claims)
	return claims, ok && claims != nil
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, err := s.auth.ParseRequest(r)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), claimsContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) requireEntitlement(featureKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := authClaims(r)
			if !ok {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			tid, _ := uuid.Parse(claims.TenantID)
			uid, _ := uuid.Parse(claims.UserID)
			allowed, err := s.ent.Can(r.Context(), &tid, &uid, featureKey)
			if err != nil {
				http.Error(w, "entitlement check failed", http.StatusInternalServerError)
				return
			}
			if !allowed {
				http.Error(w, "feature not entitled", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
