package graphsync

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MirrorTradeFlowsResult mirrors the Python trade_flows step payload.
type MirrorTradeFlowsResult struct {
	Events int `json:"events"`
}

type tradeFlowRow struct {
	ID          string
	Reporter    string
	Partner     string
	HSCode      *string
	Year        *int
	FlowType    *string
	TradeValue  *float64
	NetWeightKg *float64
	DataSource  *string
	IngestedAt  *time.Time
}

// MirrorTradeFlows mirrors recent oil_trade_flows rows into oil_commercial_events.
func MirrorTradeFlows(ctx context.Context, pool *pgxpool.Pool) (MirrorTradeFlowsResult, error) {
	exists, err := TableExists(ctx, pool, "oil_trade_flows")
	if err != nil {
		return MirrorTradeFlowsResult{}, err
	}
	if !exists {
		return MirrorTradeFlowsResult{}, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT id::text,
		  COALESCE(reporter, reporter_country, ''),
		  COALESCE(partner, partner_country, ''),
		  hs_code, year, flow_type,
		  trade_value_usd, net_weight_kg, data_source, ingested_at
		FROM oil_trade_flows
		ORDER BY ingested_at DESC NULLS LAST
		LIMIT 5000
	`)
	if err != nil {
		return MirrorTradeFlowsResult{}, err
	}
	defer rows.Close()

	result := MirrorTradeFlowsResult{}
	nowISO := time.Now().UTC().Format(time.RFC3339)

	for rows.Next() {
		var row tradeFlowRow
		if err := rows.Scan(
			&row.ID, &row.Reporter, &row.Partner, &row.HSCode, &row.Year, &row.FlowType,
			&row.TradeValue, &row.NetWeightKg, &row.DataSource, &row.IngestedAt,
		); err != nil {
			return result, err
		}

		hs := stringPtr(row.HSCode)
		if !IsPetroleumHS(hs) {
			continue
		}

		family := CommodityFamilyFromHS(hs)
		flowLabel := "import"
		if strings.ToUpper(stringPtr(row.FlowType)) == "X" {
			flowLabel = "export"
		}

		title := fmt.Sprintf("%s %s ↔ %s HS%s (%v)", flowLabel, row.Reporter, row.Partner, hs, intPtr(row.Year))

		var occurredAt *time.Time
		if row.IngestedAt != nil {
			t := row.IngestedAt.UTC()
			occurredAt = &t
		}

		dataSrc := stringPtr(row.DataSource)
		if dataSrc == "" {
			dataSrc = "comtrade"
		}

		written, err := UpsertCommercialEvent(ctx, pool, CommercialEventInput{
			EventType:       "macro_trade_flow",
			Fingerprint:     fmt.Sprintf("trade:%s", row.ID),
			Title:           title,
			Summary:         fmt.Sprintf("Macro trade %v — not vessel-level", intPtr(row.Year)),
			Country:         row.Reporter,
			PartnerCountry:  row.Partner,
			CommodityFamily: family,
			HSCode:          hs,
			Confidence:      0.45,
			Sources: []map[string]any{
				{"name": dataSrc, "fetched_at": nowISO},
			},
			Evidence:   []string{"UN Comtrade / EIA macro flow"},
			OccurredAt: occurredAt,
			Raw: map[string]any{
				"trade_value_usd": floatPtr(row.TradeValue),
				"net_weight_kg":   floatPtr(row.NetWeightKg),
				"year":            intPtr(row.Year),
				"flow_type":       stringPtr(row.FlowType),
			},
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

func intPtr(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}

func floatPtr(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}
