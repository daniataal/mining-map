package ais

import "testing"

func TestValidHeading(t *testing.T) {
	if _, ok := ValidHeading(511, 0); ok {
		t.Fatal("511 should be invalid")
	}
	if _, ok := ValidHeading(0, 0); ok {
		t.Fatal("heading 0 with zero SOG should be invalid (N/A placeholder)")
	}
	if h, ok := ValidHeading(0, 5); !ok || h != 0 {
		t.Fatalf("north heading while moving should be valid, got %v %v", h, ok)
	}
	if h, ok := ValidHeading(135, 0); !ok || h != 135 {
		t.Fatalf("135° bow heading at anchor should be valid, got %v %v", h, ok)
	}
	if h, ok := ValidHeading(270, 0.05); !ok || h != 270 {
		t.Fatalf("270 should be valid at low SOG, got %v %v", h, ok)
	}
}

func TestValidCourse(t *testing.T) {
	if _, ok := ValidCourse(90, 0); ok {
		t.Fatal("course with zero speed should be invalid")
	}
	if c, ok := ValidCourse(0, 5); !ok || c != 0 {
		t.Fatalf("north COG while moving should be valid, got %v %v", c, ok)
	}
}

func TestParseMessageShipStaticDataNoKinematics(t *testing.T) {
	raw := []byte(`{
		"MessageType":"ShipStaticData",
		"MetaData":{"MMSI":209048000,"ShipName":"CARMELIA","latitude":32.88,"longitude":35.01},
		"Message":{"ShipStaticData":{"UserID":209048000,"Destination":"IL HFA"}}
	}`)
	u, ok := ParseMessage(raw)
	if !ok {
		t.Fatal("parse failed")
	}
	if u.HasKinematics {
		t.Fatal("ShipStaticData should not carry kinematics")
	}
	if u.Lat != 0 || u.Lon != 0 {
		t.Fatalf("ShipStaticData must not use MetaData coords, got lat=%v lon=%v", u.Lat, u.Lon)
	}
	if u.Destination != "IL HFA" {
		t.Fatalf("expected destination IL HFA, got %q", u.Destination)
	}
	if u.Course != 0 || u.Heading != 0 {
		t.Fatalf("expected zero kinematics, got course=%v heading=%v", u.Course, u.Heading)
	}
}

func TestParseMessageShipStaticDataAxelStaleMeta(t *testing.T) {
	raw := []byte(`{
		"MessageType":"ShipStaticData",
		"MetaData":{"MMSI":354671000,"ShipName":"AXEL","latitude":32.88491,"longitude":35.02406},
		"Message":{"ShipStaticData":{"UserID":354671000,"ImoNumber":9495137,"Destination":"OPL PORT SAID"}}
	}`)
	u, ok := ParseMessage(raw)
	if !ok {
		t.Fatal("parse failed")
	}
	if u.Lat != 0 || u.Lon != 0 {
		t.Fatalf("stale MetaData must be ignored, got lat=%v lon=%v", u.Lat, u.Lon)
	}
	if u.IMO != "9495137" || u.Destination != "OPL PORT SAID" {
		t.Fatalf("unexpected identity/voyage: imo=%q dest=%q", u.IMO, u.Destination)
	}
}
