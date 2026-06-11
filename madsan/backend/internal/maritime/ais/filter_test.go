package ais_test

import (
	"testing"

	"github.com/madsan/intelligence/internal/maritime/ais"
)

func TestTankerClassCrudeCode(t *testing.T) {
	if got := ais.TankerClass(81, "", ""); got != "crude" {
		t.Fatalf("got %q want crude", got)
	}
}

func TestIsRelevantVesselTankerKeyword(t *testing.T) {
	if !ais.IsRelevantVessel(0, "", "MT CRUDE STAR", false) {
		t.Fatal("expected relevant")
	}
}

func TestParseMessagePositionReport(t *testing.T) {
	raw := []byte(`{
		"MessageType":"PositionReport",
		"MetaData":{"MMSI":123456789,"ShipName":"TEST TANKER"},
		"Message":{"PositionReport":{"UserID":123456789,"Latitude":25.5,"Longitude":55.3,"Sog":10.2,"Cog":180,"TrueHeading":175}}
	}`)
	u, ok := ais.ParseMessage(raw)
	if !ok {
		t.Fatal("parse failed")
	}
	if u.MMSI != 123456789 || u.Lat != 25.5 || u.Name != "TEST TANKER" {
		t.Fatalf("unexpected update: %+v", u)
	}
	if !u.HasKinematics {
		t.Fatal("PositionReport should carry kinematics")
	}
}
