package shipvault

import "testing"

func TestCredentialConstants(t *testing.T) {
	t.Parallel()
	if credentialProviderShipVault != "shipvault" || credentialKeyRefreshToken != "refresh_token" {
		t.Fatalf("unexpected credential keys: %s/%s", credentialProviderShipVault, credentialKeyRefreshToken)
	}
}
