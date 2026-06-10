package vessel

import "context"

// EquasisProvider is a scaffold for the free official Equasis registry path.
type EquasisProvider struct{}

func (p *EquasisProvider) Name() string { return "equasis" }

func (p *EquasisProvider) Enrich(ctx context.Context, mmsi, imo, name string) (Enrichment, error) {
	return Enrichment{}, ErrNotFound
}
