package api

import (
	"fmt"
	"strings"
)

// commodityFilterValues expands UI/scenario filters to DB commodity_family values.
// Crisis scenario product_filter=crude must match synthetic BOL rows tagged crude_oil.
func commodityFilterValues(filter string) []string {
	f := strings.TrimSpace(strings.ToLower(filter))
	if f == "" {
		return nil
	}
	switch f {
	case "crude":
		return []string{"crude", "crude_oil"}
	case "crude_oil":
		return []string{"crude_oil", "crude"}
	default:
		return []string{f}
	}
}

// appendCommodityFamilyFilter adds `AND commodity_family = ANY($n)` when filter is non-empty.
func appendCommodityFamilyFilter(sql *string, filter string, argPos int, args *[]any) int {
	vals := commodityFilterValues(filter)
	if len(vals) == 0 {
		return argPos
	}
	*sql += fmt.Sprintf(" AND commodity_family = ANY($%d)", argPos)
	*args = append(*args, vals)
	return argPos + 1
}
