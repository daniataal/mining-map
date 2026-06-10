package vessel

import (
	"strings"

	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/config"
	sv "github.com/madsan/intelligence/internal/enrichment/vessel/shipvault"
)

// NewShipVaultService builds a live ShipVault client from madsan config.
func NewShipVaultService(cfg config.Config, log zerolog.Logger) (*sv.Service, error) {
	opts := sv.ServiceOptions{
		BaseURL:          cfg.ShipVaultBaseURL,
		CacheTTLDays:     cfg.ShipVaultCacheTTLDays,
		BearerToken:      cfg.ShipVaultBearerToken,
		RefreshToken:     cfg.ShipVaultRefreshToken,
		SessionJSON:      cfg.ShipVaultSessionJSON,
		Email:            cfg.ShipVaultEmail,
		Password:         cfg.ShipVaultPassword,
		FirebaseAPIKey:   cfg.ShipVaultFirebaseAPIKey,
		AppOriginURL:     cfg.ShipVaultAppOriginURL,
	}
	svc, mode, err := sv.NewService(opts, log)
	if err != nil {
		return nil, err
	}
	if mode == sv.AuthDisabled {
		return nil, nil
	}
	return svc, nil
}

// ShipVaultConfigured reports whether ShipVault credentials are present.
func ShipVaultConfigured(cfg config.Config) bool {
	if cfg.ShipVaultEnabled {
		return true
	}
	return strings.TrimSpace(cfg.ShipVaultBearerToken) != "" ||
		strings.TrimSpace(cfg.ShipVaultRefreshToken) != "" ||
		strings.TrimSpace(cfg.ShipVaultSessionJSON) != "" ||
		(strings.TrimSpace(cfg.ShipVaultEmail) != "" && strings.TrimSpace(cfg.ShipVaultPassword) != "")
}
