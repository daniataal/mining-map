package ais

import (
	"regexp"
	"strconv"
	"testing"
)

// PostgreSQL requires every $N up to max(N) to appear in a typed context; a skipped
// index (e.g. $12 missing while $13 is used) yields SQLSTATE 42P18.
func TestUpsertVesselSQLPlaceholdersSequential(t *testing.T) {
	const probe = `
		INSERT INTO vessels (
			name, imo, mmsi, vessel_type, latitude, longitude, geom,
			course, heading, speed_knots, destination, last_seen_at,
			callsign, last_position_source,
			confidence_score, data_quality_status
		) VALUES (
			$1, NULLIF($2,''), $3, $4,
			CASE WHEN $12::bool THEN $5::double precision END,
			CASE WHEN $12::bool THEN $6::double precision END,
			CASE WHEN $12::bool AND $5::double precision IS NOT NULL AND $6::double precision IS NOT NULL
				THEN ST_SetSRID(ST_MakePoint($6::double precision, $5::double precision), 4326)::geography END,
			$7::double precision, $8::double precision, $9::double precision, NULLIF($10,''),
			CASE WHEN $12::bool THEN $11::timestamptz END,
			NULLIF($13,''), $14,
			70, 'observed'
		)
		ON CONFLICT (mmsi) DO UPDATE SET updated_at = now()
		RETURNING id, ($12::bool AND last_seen_at = $11::timestamptz) AS position_fresh
	`
	re := regexp.MustCompile(`\$(\d+)`)
	max := 0
	for _, m := range re.FindAllStringSubmatch(probe, -1) {
		n, err := strconv.Atoi(m[1])
		if err != nil {
			t.Fatal(err)
		}
		if n > max {
			max = n
		}
	}
	if max != 14 {
		t.Fatalf("expected 14 bind parameters, max placeholder $%d", max)
	}
}
