package api

import (
	"context"
	"strings"

	"github.com/mining-map/oil-live-intel/internal/services/shipvault"
)

// InitShipVault builds the ShipVault client using env + persisted credentials.
func (s *Server) InitShipVault(ctx context.Context) (*shipvault.Service, error) {
	cfg := s.Config
	dbRefresh, err := shipvault.LoadRefreshToken(ctx, s.Pool)
	if err != nil {
		return nil, err
	}

	refreshToken := strings.TrimSpace(cfg.ShipVaultRefreshToken)
	if refreshToken == "" {
		refreshToken = dbRefresh
	}
	sessionJSON := strings.TrimSpace(cfg.ShipVaultSessionJSON)

	opts := shipvault.ServiceOptions{
		BaseURL:        cfg.ShipVaultBaseURL,
		CacheTTLDays:   cfg.ShipVaultCacheTTLDays,
		BearerToken:    cfg.ShipVaultBearerToken,
		RefreshToken:   refreshToken,
		SessionJSON:    sessionJSON,
		Email:          cfg.ShipVaultEmail,
		Password:       cfg.ShipVaultPassword,
		FirebaseAPIKey: cfg.ShipVaultFirebaseAPIKey,
		AppOriginURL:   cfg.ShipVaultAppOriginURL,
		PersistRefreshToken: func(pctx context.Context, rt string) error {
			return shipvault.SaveRefreshToken(pctx, s.Pool, rt)
		},
	}

	svc, mode, err := shipvault.NewService(opts, s.Log)
	if err != nil {
		return nil, err
	}
	s.ShipVaultSvc = svc
	s.Log.Info().Str("auth", mode.String()).Msg("ShipVault vessel enrichment enabled")
	return svc, nil
}
