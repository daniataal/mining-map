package economics

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Bundle struct {
	OpportunityID string `json:"opportunity_id"`
	Sheet         Sheet  `json:"sheet"`
	Result        Result `json:"result"`
	PublicContext []map[string]any `json:"public_context,omitempty"`
	Disclaimer    string `json:"disclaimer"`
}

func Get(ctx context.Context, pool *pgxpool.Pool, oppID uuid.UUID) (Bundle, error) {
	var exists int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_opportunities WHERE id=$1`, oppID).Scan(&exists); err != nil || exists == 0 {
		return Bundle{}, fmt.Errorf("opportunity not found")
	}
	sheet := Sheet{}
	err := pool.QueryRow(ctx, `
		SELECT volume_bbl, buy_price_usd_per_bbl, sell_price_usd_per_bbl,
		       freight_usd, storage_usd, other_costs_usd, COALESCE(notes,''), COALESCE(updated_by,'')
		FROM oil_opportunity_economics WHERE opportunity_id=$1
	`, oppID).Scan(
		&sheet.VolumeBBL, &sheet.BuyPriceUSDPerBBL, &sheet.SellPriceUSDPerBBL,
		&sheet.FreightUSD, &sheet.StorageUSD, &sheet.OtherCostsUSD, &sheet.Notes, &sheet.UpdatedBy,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Bundle{}, err
	}
	pub := publicContext(ctx, pool, oppID)
	return Bundle{
		OpportunityID: oppID.String(),
		Sheet:         sheet,
		Result:        Compute(sheet),
		PublicContext: pub,
		Disclaimer:    "Indicative margin from your inputs only — not a market quote, offer, or confirmed trade.",
	}, nil
}

func Save(ctx context.Context, pool *pgxpool.Pool, oppID uuid.UUID, sheet Sheet) (Bundle, error) {
	var exists int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_opportunities WHERE id=$1`, oppID).Scan(&exists); err != nil || exists == 0 {
		return Bundle{}, fmt.Errorf("opportunity not found")
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO oil_opportunity_economics (
			opportunity_id, volume_bbl, buy_price_usd_per_bbl, sell_price_usd_per_bbl,
			freight_usd, storage_usd, other_costs_usd, notes, updated_by, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
		ON CONFLICT (opportunity_id) DO UPDATE SET
			volume_bbl=EXCLUDED.volume_bbl,
			buy_price_usd_per_bbl=EXCLUDED.buy_price_usd_per_bbl,
			sell_price_usd_per_bbl=EXCLUDED.sell_price_usd_per_bbl,
			freight_usd=EXCLUDED.freight_usd,
			storage_usd=EXCLUDED.storage_usd,
			other_costs_usd=EXCLUDED.other_costs_usd,
			notes=EXCLUDED.notes,
			updated_by=EXCLUDED.updated_by,
			updated_at=now()
	`, oppID, sheet.VolumeBBL, sheet.BuyPriceUSDPerBBL, sheet.SellPriceUSDPerBBL,
		sheet.FreightUSD, sheet.StorageUSD, sheet.OtherCostsUSD, nullStr(sheet.Notes), nullStr(sheet.UpdatedBy))
	if err != nil {
		return Bundle{}, err
	}
	return Get(ctx, pool, oppID)
}

func publicContext(ctx context.Context, pool *pgxpool.Pool, oppID uuid.UUID) []map[string]any {
	var country *string
	_ = pool.QueryRow(ctx, `
		SELECT t.country FROM oil_opportunities o
		LEFT JOIN oil_terminals t ON t.id = o.terminal_id
		WHERE o.id=$1
	`, oppID).Scan(&country)
	if country == nil || *country == "" {
		return []map[string]any{{
			"source": "note",
			"label":  "Public price context",
			"detail": "Enter your own buy/sell assumptions. Macro trade rows (Comtrade/EIA) sync via Phase 10 when enabled.",
		}}
	}
	rows, err := pool.Query(ctx, `
		SELECT reporter_country, partner_country, hs_code, flow, trade_value_usd, period
		FROM oil_trade_flows
		WHERE reporter_country ILIKE $1 OR partner_country ILIKE $1
		ORDER BY created_at DESC LIMIT 3
	`, *country)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var rep, partner, hs, flow, period string
		var val *float64
		if err := rows.Scan(&rep, &partner, &hs, &flow, &val, &period); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"source": "oil_trade_flows", "reporter": rep, "partner": partner,
			"hs_code": hs, "flow": flow, "value_usd": val, "period": period,
		})
	}
	if len(out) == 0 {
		out = append(out, map[string]any{
			"source": "note",
			"label":  "Macro context",
			"detail": fmt.Sprintf("No trade flow rows for %s yet — full EIA/Comtrade sync pending.", *country),
		})
	}
	return out
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
