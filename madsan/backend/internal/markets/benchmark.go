package markets

import (
	"strings"
	"time"
)

// BenchmarkSymbol maps a deal commodity label to a ticker symbol when possible.
func BenchmarkSymbol(commodity string) string {
	c := strings.ToLower(strings.TrimSpace(commodity))
	switch {
	case strings.Contains(c, "gold"), strings.Contains(c, " au"):
		return "GOLD"
	case strings.Contains(c, "wti"):
		return "WTI"
	case strings.Contains(c, "brent"), strings.Contains(c, "crude"), strings.Contains(c, "oil"),
		strings.Contains(c, "diesel"), strings.Contains(c, "vlsfo"), strings.Contains(c, "fuel"):
		return "BRENT"
	default:
		return ""
	}
}

// PriceComparable reports whether claimed deal price can be compared to the benchmark unit.
func PriceComparable(commodity, quantityUnit string) bool {
	sym := BenchmarkSymbol(commodity)
	if sym == "" {
		return false
	}
	u := strings.ToLower(strings.TrimSpace(quantityUnit))
	c := strings.ToLower(strings.TrimSpace(commodity))
	switch sym {
	case "GOLD":
		return u == "oz" || strings.Contains(c, "oz")
	case "WTI", "BRENT":
		return u == "bbl" || u == "" || strings.Contains(c, "bbl")
	default:
		return false
	}
}

// LookupBenchmark returns the best current quote for a commodity using the same tier logic as /api/core/ticker.
func (h *Handler) LookupBenchmark(commodity string, now time.Time) (Quote, bool) {
	sym := BenchmarkSymbol(commodity)
	if sym == "" {
		return Quote{}, false
	}
	quotes, _, _ := h.buildQuotes(now)
	for _, q := range quotes {
		if q.Symbol == sym {
			return q, true
		}
	}
	return Quote{}, false
}
