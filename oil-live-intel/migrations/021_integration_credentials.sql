-- Durable integration secrets (e.g. ShipVault Firebase refresh tokens).
-- Dev: values stored as plain text. Production: encrypt at rest (KMS/Vault) before insert;
-- application layer should decrypt on read — see docs in .env.example.

CREATE TABLE IF NOT EXISTS integration_credentials (
  provider          TEXT        NOT NULL,
  credential_key    TEXT        NOT NULL,
  credential_value  TEXT        NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, credential_key)
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_provider
  ON integration_credentials (provider);

COMMENT ON TABLE integration_credentials IS
  'Provider API credentials persisted across restarts. ShipVault uses provider=shipvault, credential_key=refresh_token.';
