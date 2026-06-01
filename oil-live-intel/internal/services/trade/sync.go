package trade

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/config"
)

type SyncResult struct {
	RowsUpserted int            `json:"RowsUpserted"`
	Sources      map[string]int `json:"Sources"`
	Errors       []string       `json:"Errors"`
}

// RunSync pulls Comtrade (public/keyed), EIA, and seed into oil_trade_flows.
func RunSync(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) (SyncResult, error) {
	year := syncYear()
	res := SyncResult{Sources: map[string]int{}}

	runID, err := startRun(ctx, pool)
	if err != nil {
		return res, err
	}

	if n, _ := CountRows(ctx, pool); n == 0 {
		for _, exp := range Exporters {
			for _, hs := range HSCodes {
				if seed := SeedRows(exp, hs); len(seed) > 0 {
					w, _ := upsertBatch(ctx, pool, exp, hs, seed)
					res.RowsUpserted += w
					res.Sources["seed/static"] += w
				}
			}
		}
		log.Info().Int("seed_rows", res.RowsUpserted).Msg("trade seed bootstrap")
	}

	sleep := 1200 * time.Millisecond
	for _, exp := range Exporters {
		for _, hs := range HSCodes {
			var rows []FlowRow
			source := ""

			if cfg.EnableComtrade {
				flows, src, err := FetchComtrade(exp.M49, hs, year, cfg.ComtradeAPIKey)
				if err != nil {
					res.Errors = append(res.Errors, fmt.Sprintf("%s/%s comtrade: %v", exp.Name, hs, err))
				} else if len(flows) > 0 {
					for i := range flows {
						flows[i].ReporterM49 = exp.M49
						flows[i].ReporterISO2 = exp.ISO2
					}
					rows = flows
					source = src
				}
			}

			if len(rows) == 0 {
				if seed := SeedRows(exp, hs); len(seed) > 0 {
					rows = seed
					source = "seed/static"
				}
			}

			if cfg.EnableEIA && cfg.EIAAPIKey != "" {
				eiaRows, err := FetchEIA(exp.ISO2, hs, year, cfg.EIAAPIKey)
				if err != nil {
					res.Errors = append(res.Errors, fmt.Sprintf("%s/%s eia: %v", exp.Name, hs, err))
				} else {
					for i := range eiaRows {
						eiaRows[i].ReporterM49 = exp.M49
					}
					rows = append(rows, eiaRows...)
					if len(eiaRows) > 0 {
						res.Sources["eia_international"] += len(eiaRows)
					}
				}
			}

			if len(rows) == 0 {
				time.Sleep(sleep / 2)
				continue
			}

			n, err := upsertBatch(ctx, pool, exp, hs, rows)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s/%s upsert: %v", exp.Name, hs, err))
			} else {
				res.RowsUpserted += n
				if source != "" {
					res.Sources[source] += n
				}
			}
			time.Sleep(sleep)
		}
	}

	status := "completed"
	if len(res.Errors) > 0 {
		status = "completed_with_errors"
	}
	_ = finishRun(ctx, pool, runID, status, res)
	log.Info().
		Int("rows", res.RowsUpserted).
		Interface("sources", res.Sources).
		Int("errors", len(res.Errors)).
		Msg("trade sync finished")
	return res, nil
}

func syncYear() int {
	y := time.Now().UTC().Year() - 2
	if y < 2020 {
		y = 2022
	}
	return y
}

func upsertBatch(ctx context.Context, pool *pgxpool.Pool, exp Exporter, hs string, rows []FlowRow) (int, error) {
	n := 0
	for _, r := range rows {
		if r.Reporter == "" {
			r.Reporter = exp.Name
		}
		if r.ReporterM49 == "" {
			r.ReporterM49 = exp.M49
		}
		if r.ReporterISO2 == "" {
			r.ReporterISO2 = exp.ISO2
		}
		if r.Partner == "" {
			r.Partner = "World"
		}
		if r.DataSource == "" {
			r.DataSource = "oil-live-intel"
		}
		_, err := pool.Exec(ctx, `
			INSERT INTO oil_trade_flows (
				reporter, reporter_m49, reporter_iso2, partner, partner_m49,
				hs_code, hs_description, flow_type, year,
				trade_value_usd, net_weight_kg, data_source
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			ON CONFLICT (reporter_m49, partner_m49, hs_code, flow_type, year, data_source)
			DO UPDATE SET
				trade_value_usd = EXCLUDED.trade_value_usd,
				net_weight_kg = EXCLUDED.net_weight_kg,
				data_source = EXCLUDED.data_source,
				ingested_at = CURRENT_TIMESTAMP
		`, r.Reporter, r.ReporterM49, r.ReporterISO2, r.Partner, r.PartnerM49,
			r.HSCode, r.HSDescription, r.FlowType, r.Year,
			r.TradeValueUSD, r.NetWeightKg, r.DataSource)
		if err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func startRun(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	var id int
	err := pool.QueryRow(ctx, `
		INSERT INTO oil_trade_sync_runs (status) VALUES ('running') RETURNING id
	`).Scan(&id)
	return id, err
}

func finishRun(ctx context.Context, pool *pgxpool.Pool, id int, status string, res SyncResult) error {
	src, _ := json.Marshal(res.Sources)
	errs, _ := json.Marshal(res.Errors)
	_, err := pool.Exec(ctx, `
		UPDATE oil_trade_sync_runs SET finished_at=now(), status=$2, rows_upserted=$3,
			source_summary=$4, errors=$5 WHERE id=$1
	`, id, status, res.RowsUpserted, src, errs)
	return err
}

func CountRows(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	var n int
	err := pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_trade_flows`).Scan(&n)
	return n, err
}
