package markets

import (
	"encoding/json"
	"net/http"
	"os"
	"time"
)

const (
	tierEIAOpenData   = "eia_open_data"
	tierReferenceStub = "reference_stub"
)

type Quote struct {
	Symbol     string    `json:"symbol"`
	Label      string    `json:"label"`
	Price      float64   `json:"price"`
	Currency   string    `json:"currency"`
	Unit       string    `json:"unit"`
	ChangePct  *float64  `json:"change_pct,omitempty"`
	Tier       string    `json:"tier"`
	Disclaimer string    `json:"disclaimer"`
	ObservedAt time.Time `json:"observed_at"`
}

type Handler struct {
	eiaKey string
	cache  *eiaCache
	client *http.Client
}

func NewHandler(eiaKey string) *Handler {
	if eiaKey == "" {
		eiaKey = os.Getenv("EIA_API_KEY")
	}
	return &Handler{
		eiaKey: eiaKey,
		cache:  newEIACache(),
		client: &http.Client{Timeout: eiaHTTPTimeout},
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	quotes, topTier, disclaimer := h.buildQuotes(now)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=900")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"tier":        topTier,
		"disclaimer":  disclaimer,
		"observed_at": now.Format(time.RFC3339),
		"quotes":      quotes,
	})
}

func (h *Handler) buildQuotes(now time.Time) ([]Quote, string, string) {
	up := func(v float64) *float64 { return &v }
	stubEnergy := []Quote{
		{
			Symbol: "WTI", Label: "WTI Cushing", Price: 82.45, Currency: "USD", Unit: "/bbl",
			ChangePct: up(0.4), Tier: tierReferenceStub,
			Disclaimer: "Dev reference — not live exchange feed", ObservedAt: now,
		},
		{
			Symbol: "BRENT", Label: "Brent Europe", Price: 82.45, Currency: "USD", Unit: "/bbl",
			ChangePct: up(0.4), Tier: tierReferenceStub,
			Disclaimer: "Dev reference — not live exchange feed", ObservedAt: now,
		},
	}

	var quotes []Quote
	eiaUsed := false

	if h.eiaKey != "" {
		spots, err := h.cache.get(h.eiaKey, h.client)
		if err == nil && len(spots) > 0 {
			for series, meta := range eiaSpotSeries {
				spot, ok := spots[series]
				if !ok {
					continue
				}
				observed := spot.Period
				if observed.IsZero() {
					observed = now
				}
				quotes = append(quotes, Quote{
					Symbol: meta.Symbol, Label: meta.Label, Price: spot.Price,
					Currency: "USD", Unit: "/bbl", ChangePct: spot.ChangePct,
					Tier:       tierEIAOpenData,
					Disclaimer: "EIA published daily spot — not live exchange; typical 1-day lag",
					ObservedAt: observed,
				})
				eiaUsed = true
			}
		}
	}

	if !eiaUsed {
		quotes = append(quotes, stubEnergy...)
	} else {
		// Preserve stable Brent/WTI ordering when only one series returns.
		order := []string{"WTI", "BRENT"}
		bySymbol := map[string]Quote{}
		for _, q := range quotes {
			bySymbol[q.Symbol] = q
		}
		quotes = quotes[:0]
		for _, sym := range order {
			if q, ok := bySymbol[sym]; ok {
				quotes = append(quotes, q)
			}
		}
	}

	quotes = append(quotes,
		Quote{
			Symbol: "VLSFO_SG", Label: "VLSFO SG", Price: 612.0, Currency: "USD", Unit: "/MT",
			ChangePct: up(-0.2), Tier: tierReferenceStub,
			Disclaimer: "Dev reference — bunker benchmark placeholder", ObservedAt: now,
		},
		Quote{
			Symbol: "GOLD", Label: "Gold spot", Price: 2348.5, Currency: "USD", Unit: "/oz",
			ChangePct: up(0.1), Tier: tierReferenceStub,
			Disclaimer: "Dev reference — metals desk placeholder", ObservedAt: now,
		},
	)

	topTier := tierReferenceStub
	disclaimer := "Reference placeholders — set EIA_API_KEY for EIA daily crude spot (WTI/Brent)"
	if eiaUsed {
		topTier = tierEIAOpenData
		disclaimer = "Crude from EIA open data (daily spot, not exchange tick); VLSFO/Gold remain reference stubs"
	} else if h.eiaKey != "" {
		disclaimer = "EIA fetch unavailable — showing reference placeholders; not live exchange prices"
	}

	return quotes, topTier, disclaimer
}
