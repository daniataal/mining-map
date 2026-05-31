package graphsync

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CommercialEventInput mirrors backend/services/oil_live_graph_sync._upsert_commercial_event kwargs.
type CommercialEventInput struct {
	EventType       string
	Fingerprint     string
	Title           string
	Summary         string
	Country         string
	PartnerCountry  string
	CommodityFamily string
	HSCode          string
	MMSI            *int
	TerminalID      *string
	CompanyID       *string
	PortCallID      *string
	Confidence      float64
	Sources         []map[string]any
	Evidence        []string
	Raw             map[string]any
	OccurredAt      *time.Time
}

// UpsertCommercialEvent inserts or updates oil_commercial_events by fingerprint.
// Returns true when a row was written (insert or update), matching Python rowcount semantics.
func UpsertCommercialEvent(ctx context.Context, pool *pgxpool.Pool, in CommercialEventInput) (bool, error) {
	if in.Sources == nil {
		in.Sources = []map[string]any{}
	}
	if in.Evidence == nil {
		in.Evidence = []string{}
	}
	if in.Raw == nil {
		in.Raw = map[string]any{}
	}

	sourcesJSON, err := json.Marshal(in.Sources)
	if err != nil {
		return false, err
	}
	evidenceJSON, err := json.Marshal(in.Evidence)
	if err != nil {
		return false, err
	}
	rawJSON, err := json.Marshal(in.Raw)
	if err != nil {
		return false, err
	}

	tag, err := pool.Exec(ctx, `
		INSERT INTO oil_commercial_events (
		  event_type, fingerprint, title, summary, country, partner_country,
		  commodity_family, hs_code, mmsi, terminal_id, company_id, port_call_id,
		  confidence, record_tier, sources, evidence, raw, occurred_at
		) VALUES (
		  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11::uuid, $12::uuid,
		  $13, 'inferred', $14::jsonb, $15::jsonb, $16::jsonb, $17::timestamptz
		)
		ON CONFLICT (fingerprint) DO UPDATE SET
		  title = EXCLUDED.title,
		  summary = EXCLUDED.summary,
		  confidence = GREATEST(oil_commercial_events.confidence, EXCLUDED.confidence),
		  sources = EXCLUDED.sources,
		  evidence = EXCLUDED.evidence,
		  raw = EXCLUDED.raw,
		  updated_at = now()
	`,
		in.EventType,
		in.Fingerprint,
		in.Title,
		in.Summary,
		in.Country,
		in.PartnerCountry,
		in.CommodityFamily,
		in.HSCode,
		in.MMSI,
		in.TerminalID,
		in.CompanyID,
		in.PortCallID,
		in.Confidence,
		sourcesJSON,
		evidenceJSON,
		rawJSON,
		in.OccurredAt,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
