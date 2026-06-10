package api

import (
	"time"

	venrich "github.com/madsan/intelligence/internal/enrichment/vessel"
)

type vesselEnrichmentRow struct {
	OwnerName    string
	OperatorName string
	Source       string
	Tier         string
	Confidence   float64
	StaleAfter   *time.Time
	FetchedAt    *time.Time
	DWT          *float64
	GrossTonnage *float64
	VesselClass  string
	Flag         string
	Limitations  []string
}

func mergeVesselEnrichmentSummary(summary map[string]any, row vesselEnrichmentRow) {
	if summary == nil {
		return
	}
	if row.OwnerName != "" {
		summary["owner_name"] = row.OwnerName
	}
	if row.OperatorName != "" {
		summary["operator_name"] = row.OperatorName
	}
	if row.DWT != nil {
		summary["deadweight_tons"] = *row.DWT
	}
	if row.GrossTonnage != nil {
		summary["gross_tonnage"] = *row.GrossTonnage
	}
	if row.VesselClass != "" {
		summary["vessel_class"] = row.VesselClass
	}
	if row.Flag != "" {
		summary["registry_flag"] = row.Flag
	}
	if row.Tier == "" && row.OwnerName == "" && row.OperatorName == "" {
		return
	}
	enrichment := map[string]any{
		"tier":       row.Tier,
		"source":     row.Source,
		"confidence": row.Confidence,
	}
	if row.StaleAfter != nil {
		enrichment["stale_after"] = row.StaleAfter.UTC().Format(time.RFC3339)
		enrichment["fresh"] = time.Now().Before(*row.StaleAfter)
	}
	if row.FetchedAt != nil {
		enrichment["fetched_at"] = row.FetchedAt.UTC().Format(time.RFC3339)
	}
	summary["enrichment"] = enrichment
}

func vesselEnrichmentFromResult(res venrich.Enrichment) vesselEnrichmentRow {
	row := vesselEnrichmentRow{
		OwnerName:    res.OwnerName,
		OperatorName: res.OperatorName,
		Source:       res.Source,
		Tier:         res.Tier,
		Confidence:   res.Confidence,
		VesselClass:  res.VesselClass,
		Flag:         res.Flag,
		DWT:          res.DeadweightTons,
		GrossTonnage: res.GrossTonnage,
		Limitations:  res.Limitations,
	}
	if !res.FetchedAt.IsZero() {
		t := res.FetchedAt
		row.FetchedAt = &t
	}
	if !res.StaleAfter.IsZero() {
		t := res.StaleAfter
		row.StaleAfter = &t
	}
	return row
}

func enrichmentLimitations(row vesselEnrichmentRow) []string {
	if row.Tier == "not_implemented" {
		out := []string{"Owner/operator not yet enriched — background job will populate when a provider is available"}
		out = append(out, row.Limitations...)
		return out
	}
	if row.Tier != "" && row.Tier != "observed" {
		return append([]string(nil), row.Limitations...)
	}
	return nil
}
