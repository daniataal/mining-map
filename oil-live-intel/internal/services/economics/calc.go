package economics

import "math"

// Sheet holds user-entered deal assumptions (not market quotes).
type Sheet struct {
	VolumeBBL          *float64 `json:"volume_bbl,omitempty"`
	BuyPriceUSDPerBBL  *float64 `json:"buy_price_usd_per_bbl,omitempty"`
	SellPriceUSDPerBBL *float64 `json:"sell_price_usd_per_bbl,omitempty"`
	FreightUSD         *float64 `json:"freight_usd,omitempty"`
	StorageUSD         *float64 `json:"storage_usd,omitempty"`
	OtherCostsUSD      *float64 `json:"other_costs_usd,omitempty"`
	Notes              string   `json:"notes,omitempty"`
	UpdatedBy          string   `json:"updated_by,omitempty"`
}

// Result is indicative margin from the sheet — not a market offer.
type Result struct {
	GrossRevenueUSD   *float64 `json:"gross_revenue_usd,omitempty"`
	TotalCostsUSD     *float64 `json:"total_costs_usd,omitempty"`
	IndicativeMarginUSD *float64 `json:"indicative_margin_usd,omitempty"`
	MarginPerBBLUSD   *float64 `json:"margin_per_bbl_usd,omitempty"`
	MarginPct         *float64 `json:"margin_pct,omitempty"`
	Complete          bool     `json:"complete"`
	MissingFields     []string `json:"missing_fields,omitempty"`
}

func Compute(s Sheet) Result {
	var missing []string
	vol := deref(s.VolumeBBL)
	buy := deref(s.BuyPriceUSDPerBBL)
	sell := deref(s.SellPriceUSDPerBBL)
	if vol <= 0 {
		missing = append(missing, "volume_bbl")
	}
	if buy <= 0 {
		missing = append(missing, "buy_price_usd_per_bbl")
	}
	if sell <= 0 {
		missing = append(missing, "sell_price_usd_per_bbl")
	}
	freight := deref(s.FreightUSD)
	storage := deref(s.StorageUSD)
	other := deref(s.OtherCostsUSD)

	if len(missing) > 0 {
		return Result{Complete: false, MissingFields: missing}
	}

	gross := vol * sell
	cogs := vol * buy
	totalCosts := cogs + freight + storage + other
	margin := gross - totalCosts
	perBBL := margin / vol
	var pct *float64
	if gross > 0 {
		p := (margin / gross) * 100
		pct = &p
	}

	return Result{
		GrossRevenueUSD:     fptr(gross),
		TotalCostsUSD:       fptr(totalCosts),
		IndicativeMarginUSD: fptr(margin),
		MarginPerBBLUSD:     fptr(perBBL),
		MarginPct:           pct,
		Complete:            true,
	}
}

func deref(p *float64) float64 {
	if p == nil || math.IsNaN(*p) {
		return 0
	}
	return *p
}

func fptr(v float64) *float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}
