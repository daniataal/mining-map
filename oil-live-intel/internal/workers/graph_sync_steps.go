package workers

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/services/graphsync"
	"github.com/rs/zerolog/log"
)

type GraphSyncGoSteps struct {
	Pool *pgxpool.Pool
}

func graphSyncGoFlagEnabled(name string) bool {
	key := "OIL_GRAPH_SYNC_GO_" + strings.ToUpper(strings.TrimSpace(name))
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func graphSyncGoTerminalOperatorsEnabled() bool {
	return graphSyncGoFlagEnabled("TERMINAL_OPERATORS")
}

func graphSyncGoLicensesEnabled() bool {
	return graphSyncGoFlagEnabled("LICENSES")
}

func graphSyncGoTradeFlowsEnabled() bool {
	return graphSyncGoFlagEnabled("TRADE_FLOWS")
}

func graphSyncGoPortCallsEnabled() bool {
	return graphSyncGoFlagEnabled("PORT_CALLS")
}

func graphSyncGoTEDEnabled() bool {
	return graphSyncGoFlagEnabled("TED")
}

func graphSyncGoGovAwardsEnabled() bool {
	return graphSyncGoFlagEnabled("GOV_AWARDS")
}

func anyGraphSyncGoStepEnabled() bool {
	return graphSyncGoTerminalOperatorsEnabled() ||
		graphSyncGoLicensesEnabled() ||
		graphSyncGoTradeFlowsEnabled() ||
		graphSyncGoPortCallsEnabled() ||
		graphSyncGoTEDEnabled() ||
		graphSyncGoGovAwardsEnabled()
}

func (g *GraphSyncGoSteps) runStep(
	ctx context.Context,
	key string,
	run func(context.Context) (map[string]any, error),
) error {
	payload, err := run(ctx)
	if err != nil {
		step := map[string]any{"status": "error", "error": err.Error(), "implementation": "go"}
		_ = graphsync.RecordSyncStep(ctx, g.Pool, key, step)
		return err
	}
	payload["status"] = "ok"
	payload["implementation"] = "go"
	if recErr := graphsync.RecordSyncStep(ctx, g.Pool, key, payload); recErr != nil {
		log.Warn().Err(recErr).Str("step", key).Msg("[graph-sync-go] failed to record sync step")
	}
	return nil
}

func (g *GraphSyncGoSteps) RunOnce(ctx context.Context) error {
	if !anyGraphSyncGoStepEnabled() {
		log.Info().Msg("[graph-sync-go] idle: no OIL_GRAPH_SYNC_GO_* flags enabled")
		return nil
	}

	var firstErr error

	if graphSyncGoLicensesEnabled() {
		log.Info().Msg("[graph-sync-go] running licenses step…")
		err := g.runStep(ctx, "graphsync_licenses", func(ctx context.Context) (map[string]any, error) {
			result, err := graphsync.IndexLicenses(ctx, g.Pool)
			if err != nil {
				return nil, err
			}
			log.Info().
				Int("license_events", result.LicenseEvents).
				Int("license_companies", result.LicenseCompanies).
				Msg("[graph-sync-go] licenses done")
			return map[string]any{
				"license_events":        result.LicenseEvents,
				"license_companies":     result.LicenseCompanies,
				"skipped_non_petroleum": result.SkippedNonPetroleum,
			}, nil
		})
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	if graphSyncGoTerminalOperatorsEnabled() {
		log.Info().Msg("[graph-sync-go] running terminal_operators step…")
		err := g.runStep(ctx, "graphsync_terminal_operators", func(ctx context.Context) (map[string]any, error) {
			result, err := graphsync.IndexTerminalOperators(ctx, g.Pool)
			if err != nil {
				return nil, err
			}
			log.Info().Int("operators_indexed", result.OperatorsIndexed).Msg("[graph-sync-go] terminal_operators done")
			return map[string]any{"operators_indexed": result.OperatorsIndexed}, nil
		})
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	if graphSyncGoTradeFlowsEnabled() {
		log.Info().Msg("[graph-sync-go] running trade_flows step…")
		err := g.runStep(ctx, "graphsync_trade_flows", func(ctx context.Context) (map[string]any, error) {
			result, err := graphsync.MirrorTradeFlows(ctx, g.Pool)
			if err != nil {
				return nil, err
			}
			log.Info().Int("events", result.Events).Msg("[graph-sync-go] trade_flows done")
			return map[string]any{"events": result.Events}, nil
		})
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	if graphSyncGoPortCallsEnabled() {
		log.Info().Msg("[graph-sync-go] running port_calls step…")
		err := g.runStep(ctx, "graphsync_port_calls", func(ctx context.Context) (map[string]any, error) {
			result, err := graphsync.MirrorPortCalls(ctx, g.Pool)
			if err != nil {
				return nil, err
			}
			log.Info().Int("events", result.Events).Msg("[graph-sync-go] port_calls done")
			return map[string]any{"events": result.Events}, nil
		})
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	if graphSyncGoTEDEnabled() {
		log.Info().Msg("[graph-sync-go] running ted step…")
		err := g.runStep(ctx, "graphsync_ted", func(ctx context.Context) (map[string]any, error) {
			result, err := graphsync.MirrorTEDNotices(ctx, g.Pool)
			if err != nil {
				return nil, err
			}
			log.Info().Int("events", result.Events).Msg("[graph-sync-go] ted done")
			return map[string]any{"events": result.Events}, nil
		})
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	if graphSyncGoGovAwardsEnabled() {
		log.Info().Msg("[graph-sync-go] running gov_awards step…")
		err := g.runStep(ctx, "graphsync_gov_awards", func(ctx context.Context) (map[string]any, error) {
			result, err := graphsync.MirrorGovAwards(ctx, g.Pool)
			if err != nil {
				return nil, err
			}
			log.Info().Int("events", result.Events).Msg("[graph-sync-go] gov_awards done")
			return map[string]any{"events": result.Events}, nil
		})
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	return firstErr
}

// StartGraphSyncGoStepsLoop runs bounded Go graph-sync cold steps when enabled via env flags.
// Python oil-live-graph-sync-worker remains the orchestrator until cutover criteria are met.
func StartGraphSyncGoStepsLoop(ctx context.Context, pool *pgxpool.Pool) {
	worker := &GraphSyncGoSteps{Pool: pool}
	interval := 86400
	if envInterval := os.Getenv("OIL_GRAPH_SYNC_INTERVAL_SECONDS"); envInterval != "" {
		if v, err := strconv.Atoi(envInterval); err == nil && v >= 3600 {
			interval = v
		}
	}
	backoff := 3600
	if envBackoff := os.Getenv("OIL_GRAPH_SYNC_BACKOFF_SECONDS"); envBackoff != "" {
		if v, err := strconv.Atoi(envBackoff); err == nil && v >= 300 {
			backoff = v
		}
	}

	for {
		err := worker.RunOnce(ctx)
		if err != nil {
			log.Error().Err(err).Msg("[graph-sync-go] step failed")
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(backoff) * time.Second):
			}
		} else {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(interval) * time.Second):
			}
		}
	}
}
