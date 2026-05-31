package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

type ArcGISProbesSync struct {
	Pool *pgxpool.Pool
}

func (a *ArcGISProbesSync) RunOnce(ctx context.Context) error {
	enabled := strings.ToLower(strings.TrimSpace(os.Getenv("PROBE_SYNC_ENABLED")))
	if enabled == "0" || enabled == "false" || enabled == "no" {
		log.Info().Msg("[arcgis-probe-worker] idle: PROBE_SYNC_ENABLED is false")
		return nil
	}

	log.Info().Msg("[arcgis-probe-worker] running KZ + PH probes…")

	kzResult := a.probeKazakhstan()
	phResult := a.probePhilippines()

	return a.upsertProbeResult(ctx, []map[string]any{kzResult, phResult})
}

func (a *ArcGISProbesSync) probeKazakhstan() map[string]any {
	target := os.Getenv("KZ_ARCGIS_PROBE_URL")
	if target == "" {
		target = "https://arcgis.gis-center.kz/server/rest/services?f=json"
	}

	start := time.Now()
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", target, nil)
	if err != nil {
		return map[string]any{
			"probe_key":  "kazakhstan_arcgis_hub",
			"url":        target,
			"reachable":  false,
			"status":     "client_error",
			"elapsed_ms": time.Since(start).Milliseconds(),
			"message":    err.Error(),
		}
	}
	req.Header.Set("User-Agent", "meridian-platform/1.0 (Mining Map Backend)")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		return map[string]any{
			"probe_key":  "kazakhstan_arcgis_hub",
			"url":        target,
			"reachable":  false,
			"status":     "http_error",
			"elapsed_ms": elapsed,
			"message":    err.Error(),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return map[string]any{
			"probe_key":   "kazakhstan_arcgis_hub",
			"url":         target,
			"reachable":   false,
			"status":      "http_error",
			"elapsed_ms":  elapsed,
			"http_status": resp.StatusCode,
			"message":     fmt.Sprintf("HTTP %d from ArcGIS hub", resp.StatusCode),
		}
	}

	body, _ := io.ReadAll(resp.Body)
	var payload struct {
		Services []map[string]any `json:"services"`
	}

	if err := json.Unmarshal(body, &payload); err != nil {
		return map[string]any{
			"probe_key":  "kazakhstan_arcgis_hub",
			"url":        target,
			"reachable":  false,
			"status":     "json_error",
			"elapsed_ms": elapsed,
			"message":    "Failed to parse JSON",
		}
	}

	svcCount := len(payload.Services)
	hydrocarbons := 0
	for _, svc := range payload.Services {
		name := strings.ToLower(fmt.Sprintf("%v", svc["name"]))
		typ := strings.ToLower(fmt.Sprintf("%v", svc["type"]))
		combined := name + " " + typ
		if strings.Contains(combined, "oil") || strings.Contains(combined, "gas") || strings.Contains(combined, "petrol") || strings.Contains(combined, "hydrocarbon") {
			hydrocarbons++
		}
	}

	return map[string]any{
		"probe_key":  "kazakhstan_arcgis_hub",
		"url":        target,
		"reachable":  true,
		"status":     "reachable",
		"elapsed_ms": elapsed,
		"message":    fmt.Sprintf("ArcGIS REST catalog responded in %dms (%d services listed); %d possible hydrocarbon service(s)", elapsed, svcCount, hydrocarbons),
		"payload": map[string]any{
			"service_count":               svcCount,
			"hydrocarbon_candidate_count": hydrocarbons,
		},
	}
}

func (a *ArcGISProbesSync) probePhilippines() map[string]any {
	target := os.Getenv("PH_MGB_ARCGIS_PROBE_URL")
	if target == "" {
		target = "https://controlmap.mgb.gov.ph/arcgis/rest/services/Tenement_Map/MapServer/0"
	}
	token := os.Getenv("PH_MGB_ARCGIS_TOKEN")

	start := time.Now()
	client := &http.Client{Timeout: 30 * time.Second}

	attempt := func(withToken string) (map[string]any, int, error) {
		q := url.Values{}
		q.Set("f", "json")
		q.Set("returnCountOnly", "true")
		q.Set("where", "1=1")
		if withToken != "" {
			q.Set("token", withToken)
		}
		u := target + "/query?" + q.Encode()

		req, err := http.NewRequest("GET", u, nil)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("User-Agent", "meridian-platform/1.0 (Mining Map Backend)")
		req.Header.Set("Accept", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			return nil, 0, err
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		var payload map[string]any
		json.Unmarshal(body, &payload)
		return payload, resp.StatusCode, nil
	}

	payload, status, err := attempt("")
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		return map[string]any{
			"probe_key":  "philippines_mgb_arcgis",
			"url":        target,
			"reachable":  false,
			"status":     "http_error",
			"elapsed_ms": elapsed,
			"message":    err.Error(),
		}
	}

	if countVal, ok := payload["count"]; ok {
		return map[string]any{
			"probe_key":  "philippines_mgb_arcgis",
			"url":        target,
			"reachable":  true,
			"status":     "reachable",
			"elapsed_ms": elapsed,
			"message":    fmt.Sprintf("MGB mining tenement layer responded without token (%v features)", countVal),
			"payload": map[string]any{
				"feature_count": countVal,
			},
		}
	}

	if token != "" {
		payload2, _, err2 := attempt(token)
		elapsed = time.Since(start).Milliseconds()
		if err2 == nil {
			if countVal, ok := payload2["count"]; ok {
				return map[string]any{
					"probe_key":  "philippines_mgb_arcgis",
					"url":        target,
					"reachable":  true,
					"status":     "reachable_with_token",
					"elapsed_ms": elapsed,
					"message":    fmt.Sprintf("MGB layer reachable with token (%v features)", countVal),
					"payload": map[string]any{
						"feature_count": countVal,
					},
				}
			}
		}
	}

	return map[string]any{
		"probe_key":   "philippines_mgb_arcgis",
		"url":         target,
		"reachable":   false,
		"status":      "token_required",
		"elapsed_ms":  elapsed,
		"http_status": status,
		"message":     "HTTP response from MGB ControlMap requires token or unverified",
	}
}

func (a *ArcGISProbesSync) upsertProbeResult(ctx context.Context, results []map[string]any) error {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	sql := `
        INSERT INTO open_data_probe_results (
            probe_key, checked_at, reachable, status, elapsed_ms, payload
        ) VALUES (
            $1, $2, $3, $4, $5, $6
        ) ON CONFLICT (probe_key) DO UPDATE SET
            checked_at = EXCLUDED.checked_at,
            reachable = EXCLUDED.reachable,
            status = EXCLUDED.status,
            elapsed_ms = EXCLUDED.elapsed_ms,
            payload = EXCLUDED.payload
    `

	now := time.Now()
	for _, rec := range results {
		var payloadStr string
		if p, ok := rec["payload"]; ok {
			b, _ := json.Marshal(p)
			payloadStr = string(b)
		} else {
			payloadStr = "{}"
		}

		_, err := tx.Exec(ctx, sql,
			rec["probe_key"], now, rec["reachable"], rec["status"], rec["elapsed_ms"], payloadStr,
		)
		if err != nil {
			log.Error().Err(err).Msg("failed to upsert probe result")
		}
	}

	return tx.Commit(ctx)
}

func StartArcGISProbesSyncLoop(ctx context.Context, pool *pgxpool.Pool) {
	worker := &ArcGISProbesSync{Pool: pool}
	interval := 604800 // 7 days
	if envInt := os.Getenv("PROBE_SYNC_INTERVAL_SECONDS"); envInt != "" {
		if v, err := strconv.Atoi(envInt); err == nil {
			interval = v
		}
	}
	backoff := 3600
	if envBackoff := os.Getenv("PROBE_SYNC_BACKOFF_SECONDS"); envBackoff != "" {
		if v, err := strconv.Atoi(envBackoff); err == nil {
			backoff = v
		}
	}

	for {
		err := worker.RunOnce(ctx)
		if err != nil {
			log.Error().Err(err).Msg("[arcgis-probe-worker] failed")
			time.Sleep(time.Duration(backoff) * time.Second)
		} else {
			time.Sleep(time.Duration(interval) * time.Second)
		}
	}
}
