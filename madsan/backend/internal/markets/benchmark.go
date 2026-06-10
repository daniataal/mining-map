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
	case strings.Contains(c, "vlsfo"), strings.Contains(c, "hsfo"), strings.Contains(c, "mgo"),
		strings.Contains(c, "en590"), strings.Contains(c, "diesel"),
		strings.Contains(c, "jet"), strings.Contains(c, "aviation"):
		return "VLSFO_SG"
	case strings.Contains(c, "brent"), strings.Contains(c, "crude"), strings.Contains(c, "fuel oil"),
		strings.Contains(c, "petroleum"), strings.Contains(c, "oil"):
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
	case "VLSFO_SG":
		return u == "mt" || u == "ton" || u == "tonnes" || strings.Contains(c, "mt")
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
