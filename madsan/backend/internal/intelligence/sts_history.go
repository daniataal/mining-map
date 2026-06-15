package intelligence

import (
	"context"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// STSHistoryRow is a scored STS event ready for dossier signal history.
type STSHistoryRow struct {
	ObservedAt       time.Time
	CounterpartyMMSI string
	CounterpartyName string
	Score            STSScoreResult
}

// LoadVesselSTSHistory reads legacy oil_sts_events for a vessel MMSI and scores each with the 6-factor model.
func LoadVesselSTSHistory(ctx context.Context, legacy *pgxpool.Pool, mmsi string, limit int) []STSHistoryRow {
	if legacy == nil || mmsi == "" {
		return nil
	}
	mmsiInt, err := strconv.ParseInt(mmsi, 10, 64)
	if err != nil || mmsiInt <= 0 {
		return nil
	}
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	rows, err := legacy.Query(ctx, `
		SELECT e.start_ts, e.end_ts, e.min_distance_m, e.avg_sog,
		       e.mmsi_a, e.mmsi_b,
		       COALESCE(z.name, ''),
		       COALESCE(va.tanker_class, ''), COALESCE(vb.tanker_class, ''),
		       COALESCE(va.name, ''), COALESCE(vb.name, '')
		FROM oil_sts_events e
		LEFT JOIN oil_sts_zones z ON z.id = e.zone_id
		LEFT JOIN oil_vessels va ON va.mmsi = e.mmsi_a
		LEFT JOIN oil_vessels vb ON vb.mmsi = e.mmsi_b
		WHERE e.mmsi_a = $1 OR e.mmsi_b = $1
		ORDER BY e.start_ts DESC
		LIMIT $2
	`, mmsiInt, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []STSHistoryRow
	for rows.Next() {
		var startTS, endTS time.Time
		var minDist, avgSOG *float64
		var mmsiA, mmsiB int64
		var zoneName, classA, classB, nameA, nameB string
		if rows.Scan(&startTS, &endTS, &minDist, &avgSOG, &mmsiA, &mmsiB, &zoneName, &classA, &classB, &nameA, &nameB) != nil {
			continue
		}
		durationH := endTS.Sub(startTS).Hours()
		minDistM := 0.0
		if minDist != nil {
			minDistM = *minDist
		}
		sog := 0.0
		if avgSOG != nil {
			sog = *avgSOG
		}
		inZone := zoneName != ""
		bothTankers := isTankerClass(classA) && isTankerClass(classB)
		score := ScoreSTS(STSScoreInput{
			MinDistanceM:    minDistM,
			DurationHours:   durationH,
			AvgSOG:          sog,
			BothTankers:     bothTankers,
			InSTSZone:       inZone,
			OutsideTerminal: true,
			ZoneName:        zoneName,
		})
		counterMMSI := strconv.FormatInt(mmsiB, 10)
		counterName := nameB
		if mmsiInt == mmsiB {
			counterMMSI = strconv.FormatInt(mmsiA, 10)
			counterName = nameA
		}
		out = append(out, STSHistoryRow{
			ObservedAt:       startTS.UTC(),
			CounterpartyMMSI: counterMMSI,
			CounterpartyName: counterName,
			Score:            score,
		})
	}
	return out
}

func isTankerClass(class string) bool {
	switch class {
	case "crude", "product", "chemical", "lng", "lpg", "tanker":
		return true
	default:
		return false
	}
}
