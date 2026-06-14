package api

import "testing"

func TestDecodeAISDestinationLocode(t *testing.T) {
	decoded := decodeAISDestination("NLRTM")
	if decoded == nil {
		t.Fatal("expected decoded destination")
	}
	if decoded["port_name"] != "Rotterdam" || decoded["country_name"] != "Netherlands" || decoded["locode"] != "NLRTM" {
		t.Fatalf("unexpected decoded destination: %#v", decoded)
	}
}

func TestDecodeAISDestinationNameCountry(t *testing.T) {
	decoded := decodeAISDestination("ZHOUSHAN.CN")
	if decoded == nil {
		t.Fatal("expected decoded destination")
	}
	if decoded["port_name"] != "Zhoushan" || decoded["country_code"] != "CN" {
		t.Fatalf("unexpected decoded destination: %#v", decoded)
	}
}

func TestDecodeAISDestinationPartialRouteDoesNotPromoteOrigin(t *testing.T) {
	decoded := decodeAISDestination("NLVLI>GBHPT")
	if decoded == nil {
		t.Fatal("expected partial decoded destination")
	}
	if decoded["port_name"] != nil {
		t.Fatalf("should not promote decoded origin as destination: %#v", decoded)
	}
	if decoded["unresolved_destination"] != "GBHPT" {
		t.Fatalf("expected unresolved final destination, got %#v", decoded)
	}
}

func TestDecodeAISDestinationIgnoresGenericOrders(t *testing.T) {
	if decoded := decodeAISDestination("FOR ORDERS"); decoded != nil {
		t.Fatalf("expected generic orders to be ignored, got %#v", decoded)
	}
}
