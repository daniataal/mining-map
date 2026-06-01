package opportunity

import (
	"sort"
	"strings"
)

const defaultListMaxDiverse = 40

func opportunityFingerprint(item map[string]any) string {
	otype, _ := item["opportunity_type"].(string)
	if tid, ok := item["terminal_id"].(string); ok && tid != "" {
		return otype + "|terminal:" + tid
	}
	title, _ := item["title"].(string)
	return otype + "|title:" + normalizeTitle(title)
}

func normalizeTitle(s string) string {
	return strings.TrimSpace(strings.ToLower(s))
}

func floatVal(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	default:
		return 0
	}
}

func itemID(item map[string]any) string {
	id, _ := item["id"].(string)
	return id
}

func containsID(items []map[string]any, id string) bool {
	for _, it := range items {
		if itemID(it) == id {
			return true
		}
	}
	return false
}

// DedupeAndDiversify collapses duplicate hypotheses (same type + terminal or title),
// keeps highest confidence per fingerprint, then returns up to maxOut rows favoring
// distinct terminals and countries.
func DedupeAndDiversify(items []map[string]any, maxOut int) []map[string]any {
	if maxOut <= 0 {
		maxOut = defaultListMaxDiverse
	}
	if len(items) == 0 {
		return items
	}

	best := make(map[string]map[string]any, len(items))
	for _, it := range items {
		fp := opportunityFingerprint(it)
		if prev, ok := best[fp]; !ok || floatVal(prev["confidence"]) < floatVal(it["confidence"]) {
			best[fp] = it
		}
	}

	deduped := make([]map[string]any, 0, len(best))
	for _, v := range best {
		deduped = append(deduped, v)
	}
	sort.Slice(deduped, func(i, j int) bool {
		return floatVal(deduped[i]["confidence"]) > floatVal(deduped[j]["confidence"])
	})

	var out []map[string]any
	seenTerm := make(map[string]bool)
	seenCountry := make(map[string]bool)

	appendIfRoom := func(it map[string]any) {
		if len(out) >= maxOut || containsID(out, itemID(it)) {
			return
		}
		out = append(out, it)
	}

	for _, it := range deduped {
		tid, _ := it["terminal_id"].(string)
		if tid == "" || seenTerm[tid] {
			continue
		}
		appendIfRoom(it)
		seenTerm[tid] = true
		if c, _ := it["terminal_country"].(string); c != "" {
			seenCountry[c] = true
		}
	}

	for _, it := range deduped {
		if containsID(out, itemID(it)) {
			continue
		}
		c, _ := it["terminal_country"].(string)
		if c == "" || seenCountry[c] {
			continue
		}
		appendIfRoom(it)
		seenCountry[c] = true
	}

	for _, it := range deduped {
		appendIfRoom(it)
		if len(out) >= maxOut {
			break
		}
	}
	return out
}
