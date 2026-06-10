package vessel

import (
	"context"
	"time"
)

// NotImplementedProvider is the terminal honest fallback when no upstream provider matched.
type NotImplementedProvider struct {
	StaleAfter time.Duration
}

func (p *NotImplementedProvider) Name() string { return "not_implemented" }

func (p *NotImplementedProvider) Enrich(ctx context.Context, mmsi, imo, name string) (Enrichment, error) {
	res := NotImplemented(mmsi, imo)
	res.StaleAfter = StaleAfterFromTier("not_implemented", 120, int(notImplementedStale(p.StaleAfter).Hours()/24))
	return res, nil
}
