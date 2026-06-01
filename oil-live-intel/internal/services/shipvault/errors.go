package shipvault

import (
	"net/http"
	"strings"
)

// MapEnrichmentError maps ShipVault client errors to HTTP status and user-facing messages.
func MapEnrichmentError(err error) (status int, message string) {
	if err == nil {
		return http.StatusOK, ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "company not found for name"):
		return http.StatusNotFound, strings.TrimPrefix(msg, "shipvault 404: ")
	case strings.Contains(msg, "shipvault 404"):
		return http.StatusNotFound, "No ShipVault registry match for this IMO"
	case strings.Contains(msg, "no IMO number"):
		return http.StatusUnprocessableEntity, msg
	case strings.Contains(msg, "no ShipVault token"):
		return http.StatusServiceUnavailable,
			"ShipVault not configured — set SHIPVAULT_BEARER_TOKEN or POST /api/oil-live/admin/shipvault/bootstrap with a Firebase refresh token"
	case strings.Contains(msg, "shipvault auth:"):
		return http.StatusUnauthorized,
			"ShipVault authentication failed — bearer token may be expired; paste SHIPVAULT_BEARER_TOKEN or bootstrap SHIPVAULT_REFRESH_TOKEN from DevTools (Network → securetoken → refreshToken)"
	case strings.Contains(msg, "shipvault 401"):
		return http.StatusUnauthorized,
			"ShipVault authentication failed — update SHIPVAULT_BEARER_TOKEN or bootstrap refresh token from DevTools"
	case strings.Contains(msg, "shipvault firebase"):
		return http.StatusUnauthorized,
			"ShipVault Firebase auth failed — bootstrap refresh token via POST /api/oil-live/admin/shipvault/bootstrap"
	case strings.Contains(msg, "shipvault upstream unavailable"):
		return http.StatusServiceUnavailable, "ShipVault upstream unavailable"
	case strings.Contains(msg, "shipvault http:"):
		return http.StatusServiceUnavailable, "ShipVault upstream unavailable"
	default:
		return http.StatusBadGateway, "ShipVault upstream error"
	}
}
