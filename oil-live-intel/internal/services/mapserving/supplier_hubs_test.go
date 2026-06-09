package mapserving

import "testing"

func TestSupplierHubRowJSON(t *testing.T) {
	raw := HubMetadataJSON(SupplierHubRow{
		Locode:        "SGSIN",
		HubName:       "Singapore",
		Country:       "Singapore",
		SupplierCount: 39,
	})
	if len(raw) == 0 {
		t.Fatal("expected json")
	}
}
