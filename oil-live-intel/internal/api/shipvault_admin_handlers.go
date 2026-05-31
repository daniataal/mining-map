package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/mining-map/oil-live-intel/internal/services/shipvault"
)

type shipVaultBootstrapRequest struct {
	RefreshToken string `json:"refreshToken"`
	SessionJSON  string `json:"sessionJson"`
}

// ShipVaultBootstrap persists a Firebase refresh token (one-time setup).
// POST /api/oil-live/admin/shipvault/bootstrap
// Auth: X-Oil-Intel-Internal matching OIL_INTEL_INTERNAL_KEY, or SHIPVAULT_BOOTSTRAP_ALLOWED=true (dev).
func (s *Server) ShipVaultBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if !s.shipVaultBootstrapAllowed(r) {
		writeErr(w, http.StatusForbidden, "bootstrap not allowed")
		return
	}

	var body shipVaultBootstrapRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json body")
		return
	}

	refreshToken := strings.TrimSpace(body.RefreshToken)
	if refreshToken == "" && strings.TrimSpace(body.SessionJSON) != "" {
		sess, err := shipvault.ParseSessionJSON(body.SessionJSON)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		refreshToken = sess.RefreshToken
	}
	if refreshToken == "" {
		writeErr(w, http.StatusBadRequest, "refreshToken or sessionJson with refreshToken required")
		return
	}

	if err := shipvault.SaveRefreshToken(r.Context(), s.Pool, refreshToken); err != nil {
		s.Log.Warn().Err(err).Msg("shipvault bootstrap save failed")
		writeErr(w, http.StatusInternalServerError, "failed to persist credentials")
		return
	}

	if s.ShipVaultSvc != nil {
		if err := s.ShipVaultSvc.BootstrapRefreshToken(r.Context(), refreshToken); err != nil {
			s.Log.Warn().Err(err).Msg("shipvault bootstrap token exchange failed")
			writeErr(w, http.StatusBadGateway, "refresh token rejected by Firebase")
			return
		}
	} else if _, err := s.InitShipVault(r.Context()); err != nil {
		s.Log.Warn().Err(err).Msg("shipvault bootstrap init failed")
		writeErr(w, http.StatusBadGateway, "ShipVault init failed after persist")
		return
	} else if s.ShipVaultSvc == nil {
		writeErr(w, http.StatusServiceUnavailable, "ShipVault service could not start")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "ShipVault refresh token saved. Remove SHIPVAULT_REFRESH_TOKEN from .env if set.",
	})
}

func (s *Server) shipVaultBootstrapAllowed(r *http.Request) bool {
	if s.Config.ShipVaultBootstrapAllowed {
		return true
	}
	if s.Config.InternalBroadcastKey == "" {
		return false
	}
	return r.Header.Get("X-Oil-Intel-Internal") == s.Config.InternalBroadcastKey
}
