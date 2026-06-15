package api

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type assetEnrichment struct {
	OperatorName  *string
	OwnerName     *string
	CapacityValue *float64
	CapacityUnit  *string
	Products      []byte
	OilTerminalID *string
	Source        *string
	Tier          *string
	Confidence    float64
	Limitations   []string
}

func loadAssetEnrichment(ctx context.Context, pool *pgxpool.Pool, assetID uuid.UUID) (*assetEnrichment, error) {
	var row assetEnrichment
	err := pool.QueryRow(ctx, `
		SELECT operator_name, owner_name, capacity_value, capacity_unit, products,
		       oil_terminal_id, source, tier, confidence, limitations
		FROM asset_enrichment
		WHERE asset_id = $1
	`, assetID).Scan(
		&row.OperatorName, &row.OwnerName, &row.CapacityValue, &row.CapacityUnit, &row.Products,
		&row.OilTerminalID, &row.Source, &row.Tier, &row.Confidence, &row.Limitations,
	)
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func applyAssetEnrichment(summary map[string]any, enrich *assetEnrichment) []string {
	if enrich == nil {
		return nil
	}
	if enrich.OperatorName != nil && *enrich.OperatorName != "" {
		summary["operator"] = *enrich.OperatorName
	}
	if enrich.OwnerName != nil && *enrich.OwnerName != "" {
		summary["owner"] = *enrich.OwnerName
	}
	if enrich.CapacityValue != nil {
		summary["capacity_value"] = *enrich.CapacityValue
	}
	if enrich.CapacityUnit != nil && *enrich.CapacityUnit != "" {
		summary["capacity_unit"] = *enrich.CapacityUnit
	}
	if len(enrich.Products) > 0 {
		var products any
		if json.Unmarshal(enrich.Products, &products) == nil {
			summary["products"] = products
		}
	}
	if enrich.OilTerminalID != nil && *enrich.OilTerminalID != "" {
		summary["oil_terminal_id"] = *enrich.OilTerminalID
	}
	if enrich.Source != nil && *enrich.Source != "" {
		summary["enrichment_source"] = *enrich.Source
	}
	if enrich.Tier != nil && *enrich.Tier != "" {
		summary["enrichment_tier"] = *enrich.Tier
	}
	if enrich.Confidence > 0 {
		summary["enrichment_confidence"] = enrich.Confidence
	}
	return enrich.Limitations
}
