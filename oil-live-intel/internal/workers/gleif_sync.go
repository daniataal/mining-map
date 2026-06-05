package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/rs/zerolog"
)

// StartGleifSyncLoop starts the background worker to fetch LEI records from GLEIF API
// and enrich organizations that do not have an LEI.
func StartGleifSyncLoop(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	// You can configure this via env, here we use a fixed interval or daily.
	interval := 24 * time.Hour
	limit := 50 // Batch limit

	for {
		if err := runGleifSyncOnce(ctx, pool, cfg, limit, log); err != nil {
			log.Warn().Err(err).Msg("[gleif-sync] pass failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

type gleifCandidate struct {
	ID   string
	Name string
}

func runGleifSyncOnce(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, limit int, log zerolog.Logger) error {
	candidates, err := getGleifCandidates(ctx, pool, limit)
	if err != nil {
		return err
	}
	if len(candidates) == 0 {
		log.Info().Msg("[gleif-sync] idle: no organizations missing LEI")
		return nil
	}

	var enriched, failed int
	for _, c := range candidates {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err := enrichOrganizationWithGLEIF(ctx, pool, c.ID, c.Name); err != nil {
			failed++
			log.Debug().Err(err).Str("org_id", c.ID).Str("name", c.Name).Msg("[gleif-sync] enrichment failed")
		} else {
			enriched++
		}
		// Respect GLEIF rate limits (e.g. max 50-60 req/min depending on usage, add a small sleep)
		time.Sleep(1 * time.Second)
	}

	log.Info().
		Int("candidates", len(candidates)).
		Int("enriched", enriched).
		Int("failed", failed).
		Msg("[gleif-sync] pass complete")

	return nil
}

func getGleifCandidates(ctx context.Context, pool *pgxpool.Pool, limit int) ([]gleifCandidate, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text, name
		FROM core_organizations
		WHERE lei IS NULL
		  AND (metadata->>'gleif_sync_attempted') IS NULL
		ORDER BY updated_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []gleifCandidate
	for rows.Next() {
		var c gleifCandidate
		if err := rows.Scan(&c.ID, &c.Name); err != nil {
			return out, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func enrichOrganizationWithGLEIF(ctx context.Context, pool *pgxpool.Pool, orgID, orgName string) error {
	client := &http.Client{Timeout: 10 * time.Second}
	apiURL := fmt.Sprintf("https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=%s", url.QueryEscape(orgName))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.api+json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Mark as attempted even if failed (e.g. 404/400) to avoid infinite retry loops on bad names
		_ = markGleifAttempted(ctx, pool, orgID)
		return fmt.Errorf("gleif api returned status: %d", resp.StatusCode)
	}

	var result struct {
		Data []struct {
			Attributes struct {
				Lei    string `json:"lei"`
				Entity struct {
					LegalName struct {
						Name string `json:"name"`
					} `json:"legalName"`
				} `json:"entity"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return err
	}

	if len(result.Data) == 0 {
		return markGleifAttempted(ctx, pool, orgID)
	}

	// For simplicity, take the first match.
	// Production may want to rank by country match or exact name match.
	firstMatch := result.Data[0]
	lei := firstMatch.Attributes.Lei

	// Insert into core_source_records
	rawPayload, _ := json.Marshal(firstMatch)
	
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var recordID string
	err = tx.QueryRow(ctx, `
		INSERT INTO core_source_records (source_key, external_id, record_hash, raw_payload)
		VALUES ('gleif', $1, md5($2::text), $2)
		ON CONFLICT (source_key, record_hash) DO UPDATE SET updated_at = now()
		RETURNING id::text
	`, lei, rawPayload).Scan(&recordID)
	if err != nil {
		return err
	}

	// Update core_organizations
	_, err = tx.Exec(ctx, `
		UPDATE core_organizations
		SET lei = $1,
		    metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{gleif_sync_attempted}', 'true'::jsonb)
		WHERE id = $2
	`, lei, orgID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func markGleifAttempted(ctx context.Context, pool *pgxpool.Pool, orgID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE core_organizations
		SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{gleif_sync_attempted}', 'true'::jsonb)
		WHERE id = $1
	`, orgID)
	return err
}
