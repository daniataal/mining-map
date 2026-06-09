package api

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/database"
)

// withTenantGUC runs after requireAuth. When JWT claims carry a tenant id it
// binds a request-scoped DB transaction with SET LOCAL app.tenant_id. Postgres
// owner sessions bypass RLS today; handlers still query via the shared pool.
func (s *Server) withTenantGUC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := authClaims(r)
		if !ok || claims.TenantID == "" {
			next.ServeHTTP(w, r)
			return
		}
		tid, err := uuid.Parse(claims.TenantID)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		ctx, release, err := database.BindRequestTenantRLS(r.Context(), s.pool, tid)
		if err != nil {
			s.log.Warn().Err(err).Str("tenant_id", tid.String()).Msg("tenant rls bind failed; continuing without guc")
			ctx = database.WithTenantID(r.Context(), tid)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		defer release()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
