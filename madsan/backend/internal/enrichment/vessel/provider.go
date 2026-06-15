package vessel

import (
	"context"
	"errors"
	"time"

	sv "github.com/madsan/intelligence/internal/enrichment/vessel/shipvault"
)

// Provider enriches a vessel from an external or legacy cache source.
type Provider interface {
	Name() string
	Enrich(ctx context.Context, mmsi, imo, name string) (Enrichment, error)
}

// ErrNotFound means no enrichment exists for this vessel at this provider.
var ErrNotFound = errors.New("vessel enrichment not found")

// Chain tries providers in order until one returns attributable data or a non-not-found result.
type Chain struct {
	providers []Provider
}

func NewChain(providers ...Provider) *Chain {
	return &Chain{providers: providers}
}

func (c *Chain) Name() string { return "chain" }

func (c *Chain) Enrich(ctx context.Context, mmsi, imo, name string) (Enrichment, error) {
	var last Enrichment
	var lastErr error
	for _, p := range c.providers {
		if p == nil {
			continue
		}
		res, err := p.Enrich(ctx, mmsi, imo, name)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				lastErr = err
				continue
			}
			return Enrichment{}, err
		}
		if res.Implemented() {
			return res, nil
		}
		last = res
	}
	if last.Tier != "" {
		return last, nil
	}
	if lastErr != nil {
		return NotImplemented(mmsi, imo), lastErr
	}
	return NotImplemented(mmsi, imo), nil
}

// Options configures the default provider chain for the ingestion worker.
type Options struct {
	ShipVaultService  *sv.Service
	StaleDays         int
	NotImplementedTTL time.Duration
}

// DefaultChain builds ShipVault (live) → honest not_implemented when disabled.
func DefaultChain(opts Options) Provider {
	var providers []Provider
	if opts.ShipVaultService != nil {
		providers = append(providers, &ShipVaultProvider{
			Service:   opts.ShipVaultService,
			StaleDays: opts.StaleDays,
		})
	}
	providers = append(providers, &NotImplementedProvider{
		StaleAfter: notImplementedStale(opts.NotImplementedTTL),
	})
	return NewChain(providers...)
}

func notImplementedStale(d time.Duration) time.Duration {
	if d <= 0 {
		return 7 * 24 * time.Hour
	}
	return d
}

// NotImplemented returns an honest placeholder enrichment when no provider is wired.
func NotImplemented(mmsi, imo string) Enrichment {
	now := time.Now().UTC()
	return Enrichment{
		MMSI:       mmsi,
		IMO:        imo,
		Source:     "not_implemented",
		Tier:       "not_implemented",
		Confidence: 0,
		FetchedAt:  now,
		StaleAfter: now.Add(7 * 24 * time.Hour),
		Limitations: []string{
			"Owner/operator enrichment pending — run vessel-enrich with ShipVault credentials",
			"Set MADSAN_SHIPVAULT_ENABLED=true and SHIPVAULT_REFRESH_TOKEN or SHIPVAULT_BEARER_TOKEN",
		},
		RawPayload: map[string]any{"status": "not_implemented"},
	}
}

// StaleAfterFromTier picks cache TTL by enrichment tier.
func StaleAfterFromTier(tier string, observedDays, notImplementedDays int) time.Time {
	now := time.Now().UTC()
	if tier == "not_implemented" {
		if notImplementedDays <= 0 {
			notImplementedDays = 7
		}
		return now.Add(time.Duration(notImplementedDays) * 24 * time.Hour)
	}
	if observedDays <= 0 {
		observedDays = 120
	}
	return now.Add(time.Duration(observedDays) * 24 * time.Hour)
}

// NeedsEnrichment reports whether a vessel should be selected for the enrichment job.
func NeedsEnrichment(hasRow bool, staleAfter *time.Time, now time.Time) bool {
	if !hasRow {
		return true
	}
	if staleAfter == nil {
		return true
	}
	return staleAfter.Before(now)
}

// SelectVesselsSQL is the prioritized batch query used by the ingestion job.
func SelectVesselsSQL(force bool) string {
	staleClause := "AND (e.mmsi IS NULL OR e.stale_after < now())"
	if force {
		staleClause = ""
	}
	return `
		SELECT v.id, COALESCE(v.mmsi,''), COALESCE(v.imo,''), COALESCE(v.name,''), v.last_seen_at,
		       (e.mmsi IS NOT NULL) AS has_enrichment, e.stale_after
		FROM vessels v
		LEFT JOIN vessel_enrichment e ON e.mmsi = v.mmsi
		WHERE v.mmsi IS NOT NULL AND v.mmsi <> ''
		  AND NULLIF(TRIM(v.imo), '') IS NOT NULL
		  ` + staleClause + `
		ORDER BY v.last_seen_at DESC NULLS LAST, v.updated_at DESC
		LIMIT $1`
}

// SelectVesselByIMOSQL returns one vessel row for a single-IMO enrichment run.
func SelectVesselByIMOSQL() string {
	return `
		SELECT v.id, COALESCE(v.mmsi,''), COALESCE(v.imo,''), COALESCE(v.name,''), v.last_seen_at,
		       (e.mmsi IS NOT NULL) AS has_enrichment, e.stale_after
		FROM vessels v
		LEFT JOIN vessel_enrichment e ON e.mmsi = v.mmsi
		WHERE TRIM(v.imo) = TRIM($1)
		LIMIT 1`
}
