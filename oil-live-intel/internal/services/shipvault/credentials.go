package shipvault

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	credentialProviderShipVault = "shipvault"
	credentialKeyRefreshToken   = "refresh_token"
)

// LoadRefreshToken reads the persisted ShipVault Firebase refresh token, if any.
func LoadRefreshToken(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	if pool == nil {
		return "", nil
	}
	var value string
	err := pool.QueryRow(ctx, `
		SELECT credential_value
		FROM integration_credentials
		WHERE provider = $1 AND credential_key = $2
	`, credentialProviderShipVault, credentialKeyRefreshToken).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

// SaveRefreshToken upserts the ShipVault refresh token for set-and-forget restarts.
func SaveRefreshToken(ctx context.Context, pool *pgxpool.Pool, refreshToken string) error {
	refreshToken = strings.TrimSpace(refreshToken)
	if pool == nil || refreshToken == "" {
		return nil
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO integration_credentials (provider, credential_key, credential_value, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (provider, credential_key) DO UPDATE SET
			credential_value = EXCLUDED.credential_value,
			updated_at = now()
	`, credentialProviderShipVault, credentialKeyRefreshToken, refreshToken)
	return err
}

// HasPersistedRefreshToken reports whether a non-empty refresh token exists in Postgres.
func HasPersistedRefreshToken(ctx context.Context, pool *pgxpool.Pool) (bool, error) {
	rt, err := LoadRefreshToken(ctx, pool)
	if err != nil {
		return false, err
	}
	return rt != "", nil
}
