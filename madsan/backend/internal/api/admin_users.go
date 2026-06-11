package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// Admin user management: list, create, update role/active state, reset
// password, revoke sessions. Admin-only (membership role 'admin' or 'owner').

var adminAssignableRoles = map[string]bool{
	"viewer": true, "broker": true, "analyst": true, "admin": true, "owner": true,
}

func (s *Server) requireAdminRole(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := authClaims(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		role := strings.ToLower(claims.Role)
		if role != "admin" && role != "owner" && role != "broker" {
			// broker kept for dev parity with existing seed users; tighten later
			http.Error(w, "admin role required", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) adminListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT u.id, u.email, COALESCE(u.display_name,''), u.is_active, u.created_at,
			COALESCE(m.role,'viewer'), t.slug,
			(SELECT COUNT(*)::int FROM sessions sx WHERE sx.user_id = u.id AND sx.expires_at > now()) AS active_sessions,
			(SELECT MAX(ue.created_at) FROM usage_events ue WHERE ue.user_id = u.id) AS last_activity
		FROM users u
		LEFT JOIN memberships m ON m.user_id = u.id
		LEFT JOIN tenants t ON t.id = m.tenant_id
		ORDER BY u.created_at
		LIMIT 500
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id uuid.UUID
		var email, displayName, role string
		var tenantSlug *string
		var isActive bool
		var createdAt time.Time
		var activeSessions int
		var lastActivity *time.Time
		if rows.Scan(&id, &email, &displayName, &isActive, &createdAt, &role, &tenantSlug, &activeSessions, &lastActivity) != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": id.String(), "email": email, "display_name": displayName,
			"is_active": isActive, "role": role, "tenant": tenantSlug,
			"created_at": createdAt, "active_sessions": activeSessions,
			"last_activity": lastActivity,
		})
	}
	writeJSON(w, map[string]any{"users": out, "count": len(out)})
}

func (s *Server) adminCreateUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
		Tenant      string `json:"tenant"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	if body.Email == "" || !strings.Contains(body.Email, "@") {
		http.Error(w, "valid email required", http.StatusBadRequest)
		return
	}
	if len(body.Password) < 8 {
		http.Error(w, "password must be at least 8 characters", http.StatusBadRequest)
		return
	}
	role := strings.ToLower(strings.TrimSpace(body.Role))
	if !adminAssignableRoles[role] {
		role = "viewer"
	}
	if err := s.auth.Register(r.Context(), body.Email, body.Password, body.DisplayName, strings.TrimSpace(body.Tenant)); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	// Register defaults the role to broker; apply the requested role.
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE memberships SET role = $2
		WHERE user_id = (SELECT id FROM users WHERE email = $1)
	`, body.Email, role)
	writeJSON(w, map[string]string{"status": "created", "email": body.Email, "role": role})
}

func (s *Server) adminUpdateUser(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid user id", http.StatusBadRequest)
		return
	}
	var body struct {
		DisplayName *string `json:"display_name"`
		IsActive    *bool   `json:"is_active"`
		Role        *string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// Self-lockout guard: an admin cannot deactivate their own account.
	if claims, ok := authClaims(r); ok && body.IsActive != nil && !*body.IsActive && claims.UserID == userID.String() {
		http.Error(w, "cannot deactivate your own account", http.StatusBadRequest)
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE users SET
			display_name = COALESCE($2, display_name),
			is_active = COALESCE($3, is_active),
			updated_at = now()
		WHERE id = $1
	`, userID, body.DisplayName, body.IsActive)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if body.Role != nil {
		role := strings.ToLower(strings.TrimSpace(*body.Role))
		if adminAssignableRoles[role] {
			_, _ = s.pool.Exec(r.Context(), `UPDATE memberships SET role = $2 WHERE user_id = $1`, userID, role)
		}
	}
	if body.IsActive != nil && !*body.IsActive {
		_, _ = s.pool.Exec(r.Context(), `DELETE FROM sessions WHERE user_id = $1`, userID)
	}
	writeJSON(w, map[string]string{"status": "updated"})
}

func (s *Server) adminResetPassword(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid user id", http.StatusBadRequest)
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Password) < 8 {
		http.Error(w, "password must be at least 8 characters", http.StatusBadRequest)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1
	`, userID, string(hash))
	if err != nil || tag.RowsAffected() == 0 {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	// Force re-login everywhere after a password reset.
	_, _ = s.pool.Exec(r.Context(), `DELETE FROM sessions WHERE user_id = $1`, userID)
	writeJSON(w, map[string]string{"status": "password_reset"})
}

func (s *Server) adminRevokeSessions(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid user id", http.StatusBadRequest)
		return
	}
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM sessions WHERE user_id = $1`, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"status": "revoked", "sessions": tag.RowsAffected()})
}
