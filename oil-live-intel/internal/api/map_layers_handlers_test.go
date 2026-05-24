package api

import "testing"

func TestParseMapLayerSetDefaultsToDealLayers(t *testing.T) {
	layers := parseMapLayerSet("")
	for _, key := range []string{"terminals", "vessels", "corridors", "opportunities", "trade_flows"} {
		if !layers[key] {
			t.Fatalf("expected default layer %q to be enabled: %#v", key, layers)
		}
	}
}

func TestParseMapLayerSetHonorsRequestedSubset(t *testing.T) {
	layers := parseMapLayerSet("terminals, trade_flows")
	if !layers["terminals"] || !layers["trade_flows"] {
		t.Fatalf("expected requested layers enabled: %#v", layers)
	}
	if layers["vessels"] {
		t.Fatalf("did not expect unrequested vessel layer: %#v", layers)
	}
}
