package graphsync

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MirrorPortCallsResult mirrors the Python port_calls step payload.
type MirrorPortCallsResult struct {
	Events int `json:"events"`
}

type portCallRow struct {
	ID            string
	MMSI          *int
	VesselName    *string
	TerminalID    *string
	TerminalName  *string
	Country       *string
	EventType     *string
	ProductFamily *string
	Confidence    *float64
	Occurred      *time.Time
}

// MirrorPortCalls mirrors recent oil_port_calls into oil_commercial_events.
func MirrorPortCalls(ctx context.Context, pool *pgxpool.Pool) (MirrorPortCallsResult, error) {
	exists, err := TableExists(ctx, pool, "oil_port_calls")
	if err != nil {
		return MirrorPortCallsResult{}, err
	}
	if !exists {
		return MirrorPortCallsResult{}, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT pc.id::text, pc.mmsi, pc.vessel_name, pc.terminal_id::text, t.name, t.country,
		  pc.event_type, pc.product_family_inferred, pc.confidence,
		  COALESCE(pc.departure_ts, pc.arrival_ts) AS occurred
		FROM oil_port_calls pc
		LEFT JOIN oil_terminals t ON t.id = pc.terminal_id
		ORDER BY COALESCE(pc.departure_ts, pc.arrival_ts) DESC NULLS LAST
		LIMIT 2000
	`)
	if err != nil {
		return MirrorPortCallsResult{}, err
	}
	defer rows.Close()

	result := MirrorPortCallsResult{}
	nowISO := time.Now().UTC().Format(time.RFC3339)

	for rows.Next() {
		var row portCallRow
		if err := rows.Scan(
			&row.ID, &row.MMSI, &row.VesselName, &row.TerminalID, &row.TerminalName, &row.Country,
			&row.EventType, &row.ProductFamily, &row.Confidence, &row.Occurred,
		); err != nil {
			return result, err
		}

		confidence := 0.5
		if row.Confidence != nil {
			confidence = *row.Confidence
		}

		vessel := stringPtr(row.VesselName)
		if vessel == "" && row.MMSI != nil {
			vessel = fmt.Sprintf("%d", *row.MMSI)
		}
		terminalName := stringPtr(row.TerminalName)
		if terminalName == "" {
			terminalName = "terminal"
		}
		event := stringPtr(row.EventType)
		if event == "" {
			event = "visit"
		}

		var occurredAt *time.Time
		if row.Occurred != nil {
			t := row.Occurred.UTC()
			occurredAt = &t
		}

		written, err := UpsertCommercialEvent(ctx, pool, CommercialEventInput{
			EventType:       "inferred_port_call",
			Fingerprint:     fmt.Sprintf("port_call:%s", row.ID),
			Title:           fmt.Sprintf("%s @ %s", vessel, terminalName),
			Summary:         fmt.Sprintf("AIS-derived %s", event),
			Country:         stringPtr(row.Country),
			CommodityFamily: stringPtr(row.ProductFamily),
			MMSI:            row.MMSI,
			TerminalID:      row.TerminalID,
			PortCallID:      &row.ID,
			Confidence:      confidence,
			Sources: []map[string]any{
				{"name": "ais_port_call", "fetched_at": nowISO},
			},
			Evidence: []string{
				fmt.Sprintf("Event: %s", event),
				"Inferred from public AIS",
			},
			Raw:        map[string]any{"vessel_name": stringPtr(row.VesselName)},
			OccurredAt: occurredAt,
		})
		if err != nil {
			return result, err
		}
		if written {
			result.Events++
		}
	}
	return result, rows.Err()
}
