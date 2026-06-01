package shipvault

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestMapEnrichmentError(t *testing.T) {
	t.Parallel()
	cases := []struct {
		err    error
		status int
		substr string
	}{
		{fmt.Errorf("shipvault vessel lookup: shipvault 404: vessel/company not found"), http.StatusNotFound, "No ShipVault registry match"},
		{errors.New("no ShipVault token — set SHIPVAULT_BEARER_TOKEN"), http.StatusServiceUnavailable, "ShipVault not configured"},
		{fmt.Errorf("shipvault auth: shipvault 401: manual token expired"), http.StatusUnauthorized, "ShipVault authentication failed"},
		{errors.New("shipvault http: connection reset"), http.StatusServiceUnavailable, "ShipVault upstream unavailable"},
		{fmt.Errorf("shipvault vessel lookup: shipvault upstream unavailable: dial tcp: lookup shipvaultapi"), http.StatusServiceUnavailable, "ShipVault upstream unavailable"},
	}
	for _, tc := range cases {
		status, msg := MapEnrichmentError(tc.err)
		if status != tc.status {
			t.Fatalf("status = %d, want %d for %v", status, tc.status, tc.err)
		}
		if !strings.Contains(msg, tc.substr) {
			t.Fatalf("message = %q, want substring %q", msg, tc.substr)
		}
	}
}
