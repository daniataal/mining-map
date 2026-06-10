package ais

import "github.com/madsan/intelligence/internal/maritime/portcall"

func toPortCallPosition(u *Update) portcall.Position {
	return portcall.Position{
		MMSI:        u.MMSI,
		Name:        u.Name,
		Lat:         u.Lat,
		Lon:         u.Lon,
		Destination: u.Destination,
		DraftM:      u.DraftM,
		HasDraft:    u.HasDraft,
		Timestamp:   u.Timestamp,
	}
}
