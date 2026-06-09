package markets

import (
	"encoding/json"
	"net/http"
	"time"
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

type Handler struct{}

func NewHandler() *Handler { return &Handler{} }

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	up := func(v float64) *float64 { return &v }
	quotes := []Quote{
		{
			Symbol: "BRENT", Label: "Brent", Price: 82.45, Currency: "USD", Unit: "/bbl",
			ChangePct: up(0.4), Tier: "reference_stub",
			Disclaimer: "Dev reference — not live exchange feed", ObservedAt: now,
		},
		{
			Symbol: "VLSFO_SG", Label: "VLSFO SG", Price: 612.0, Currency: "USD", Unit: "/MT",
			ChangePct: up(-0.2), Tier: "reference_stub",
			Disclaimer: "Dev reference — bunker benchmark placeholder", ObservedAt: now,
		},
		{
			Symbol: "GOLD", Label: "Gold spot", Price: 2348.5, Currency: "USD", Unit: "/oz",
			ChangePct: up(0.1), Tier: "reference_stub",
			Disclaimer: "Dev reference — metals desk placeholder", ObservedAt: now,
		},
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"tier":        "reference_stub",
		"disclaimer":  "Benchmark quotes for UI only — wire EIA/ICE when approved",
		"observed_at": now.Format(time.RFC3339),
		"quotes":      quotes,
	})
}
