package deals

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/compliance"
	"github.com/madsan/intelligence/internal/markets"
)

type partyEvidence struct {
	ClaimType string `json:"claim_type"`
	Source    string `json:"source_name"`
	Tier      string `json:"tier,omitempty"`
}

type partyProfile struct {
	Role       string          `json:"role"`
	Name       string          `json:"name"`
	Country    string          `json:"country_code,omitempty"`
	RegistryID string          `json:"registry_id,omitempty"`
	Confidence float64         `json:"confidence_score,omitempty"`
	Evidence   []partyEvidence `json:"evidence,omitempty"`
}

// BuildPack assembles a structured due-diligence export for a verified deal.
func (s *Service) BuildPack(ctx context.Context, id string) (map[string]any, error) {
	var (
		title, commodity, status, location, seller, buyer, incoterm, currency string
		quantity, price, score                                              *float64
		quantityUnit                                                        *string
		resultJSON                                                          []byte
		createdAt                                                           time.Time
	)
	err := s.pool.QueryRow(ctx, `
		SELECT title, commodity, status, location_name, seller_name, buyer_name, incoterm,
		       quantity, quantity_unit, price, currency, verification_score, verification_result, created_at
		FROM deals WHERE id = $1
	`, id).Scan(&title, &commodity, &status, &location, &seller, &buyer, &incoterm,
		&quantity, &quantityUnit, &price, &currency, &score, &resultJSON, &createdAt)
	if err != nil {
		return nil, err
	}

	var verification map[string]any
	if len(resultJSON) > 0 {
		_ = json.Unmarshal(resultJSON, &verification)
	}

	parties := []partyProfile{}
	if seller != "" {
		parties = append(parties, s.partyProfile(ctx, "seller", seller))
	}
	if buyer != "" {
		parties = append(parties, s.partyProfile(ctx, "buyer", buyer))
	}

	graph := s.buildRelationshipGraph(ctx, seller, buyer, verification)

	vertical := "energy"
	if compliance.CommodityFamily(commodity) == "mining" {
		vertical = "metals"
	}
	priceCtx := s.buildPriceContext(commodity, quantityUnit, price, currency)

	pack := map[string]any{
		"pack_version":  "1.1",
		"generated_at":  time.Now().UTC().Format(time.RFC3339),
		"platform":      "MadSan Intelligence",
		"vertical":      vertical,
		"deal_id":       id,
		"title":         title,
		"status":        status,
		"created_at":    createdAt.UTC().Format(time.RFC3339),
		"deal_summary": map[string]any{
			"commodity":     commodity,
			"quantity":      derefFloat(quantity),
			"quantity_unit": derefStr(quantityUnit),
			"location":      location,
			"incoterm":      incoterm,
			"price":         derefFloat(price),
			"currency":      currency,
		},
		"price_context":        priceCtx,
		"parties":              parties,
		"relationship_graph":   graph,
		"verification":         verification,
		"sections": map[string]any{
			"confidence_score":      pickFloat(verification, "confidence_score", score),
			"confidence_status":     verification["confidence_status"],
			"dd_recommendation":     verification["dd_recommendation"],
			"positive_evidence":     verification["positive_evidence"],
			"warnings":              verification["warnings"],
			"red_flags":             verification["red_flags"],
			"missing_documents":     verification["missing_documents"],
			"recommended_questions": verification["recommended_questions"],
			"dd_checks":             verification["dd_checks"],
			"sanctions_screening":   verification["sanctions_screening"],
		},
		"limitations": verification["limitations"],
		"disclaimer":  packDisclaimer(vertical),
	}
	return pack, nil
}

func packDisclaimer(vertical string) string {
	if vertical == "metals" {
		return "Metals intelligence pack for due diligence — not legal, compliance, or trading advice. Assay and license claims require independent verification; OpenSanctions matches are leads for review."
	}
	return "Intelligence pack for due diligence — not legal, compliance, or trading advice. OpenSanctions and corridor hits require human review before any transaction."
}

func (s *Service) buildPriceContext(commodity string, quantityUnit *string, price *float64, currency string) map[string]any {
	out := map[string]any{"comparable": false}
	ticker := markets.NewHandler(s.eiaKey)
	now := time.Now().UTC()
	q, ok := ticker.LookupBenchmark(commodity, now)
	if !ok {
		out["message"] = "No benchmark mapped for commodity"
		return out
	}
	out["benchmark_symbol"] = q.Symbol
	out["benchmark_label"] = q.Label
	out["benchmark_price"] = q.Price
	out["benchmark_unit"] = q.Unit
	out["benchmark_tier"] = q.Tier
	out["benchmark_as_of"] = q.ObservedAt.UTC().Format(time.RFC3339)
	unit := derefStr(quantityUnit)
	if price != nil && *price > 0 && markets.PriceComparable(commodity, unit) {
		delta := pctDelta(*price, q.Price)
		out["comparable"] = true
		out["claimed_price"] = *price
		out["claimed_currency"] = currency
		out["delta_pct"] = delta
	} else if price != nil && *price > 0 {
		out["claimed_price"] = *price
		out["claimed_currency"] = currency
		out["message"] = "Claimed price unit not comparable to benchmark — showing reference quote only"
	}
	return out
}

func (s *Service) partyProfile(ctx context.Context, role, name string) partyProfile {
	var id uuid.UUID
	var country *string
	var conf *float64
	err := s.pool.QueryRow(ctx, `
		SELECT id, country_code, confidence_score FROM companies
		WHERE name ILIKE $1 OR normalized_name ILIKE lower($1)
		ORDER BY confidence_score DESC NULLS LAST LIMIT 1
	`, "%"+name+"%").Scan(&id, &country, &conf)
	p := partyProfile{Role: role, Name: name}
	if country != nil {
		p.Country = *country
	}
	if conf != nil {
		p.Confidence = *conf
	}
	if err != nil {
		return p
	}
	p.RegistryID = id.String()
	rows, err := s.pool.Query(ctx, `
		SELECT e.claim_type, s.source_name, COALESCE(e.tier,'')
		FROM evidence e JOIN sources s ON s.id = e.source_id
		WHERE e.entity_type = 'company' AND e.entity_id = $1
		ORDER BY e.confidence_score DESC LIMIT 8
	`, id)
	if err != nil {
		return p
	}
	defer rows.Close()
	for rows.Next() {
		var pe partyEvidence
		if err := rows.Scan(&pe.ClaimType, &pe.Source, &pe.Tier); err == nil {
			p.Evidence = append(p.Evidence, pe)
		}
	}
	return p
}

func pickFloat(v map[string]any, key string, fallback *float64) any {
	if v == nil {
		if fallback != nil {
			return *fallback
		}
		return nil
	}
	if x, ok := v[key]; ok {
		return x
	}
	if fallback != nil {
		return *fallback
	}
	return nil
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefFloat(f *float64) any {
	if f == nil {
		return nil
	}
	return fmt.Sprintf("%.2f", *f)
}

// PackToMarkdown renders a broker-readable DD report.
func PackToMarkdown(pack map[string]any) string {
	var b strings.Builder
	write := func(format string, args ...any) { _, _ = fmt.Fprintf(&b, format, args...) }

	vertical, _ := pack["vertical"].(string)
	if vertical == "metals" {
		b.WriteString("# MadSan Metals Deal Due Diligence Pack\n\n")
	} else {
		b.WriteString("# MadSan Deal Due Diligence Pack\n\n")
	}
	write("**Deal ID:** %s  \n", pack["deal_id"])
	write("**Title:** %s  \n", pack["title"])
	write("**Generated:** %s  \n\n", pack["generated_at"])

	if sum, ok := pack["deal_summary"].(map[string]any); ok {
		write("## Deal summary\n\n")
		write("| Field | Value |\n|-------|-------|\n")
		for _, k := range []string{"commodity", "quantity", "quantity_unit", "location", "incoterm", "price", "currency"} {
			if v := sum[k]; v != nil && fmt.Sprint(v) != "" {
				write("| %s | %v |\n", strings.ReplaceAll(k, "_", " "), v)
			}
		}
		write("\n")
	}

	if pc, ok := pack["price_context"].(map[string]any); ok && len(pc) > 0 {
		write("## Price context\n\n")
		if sym, ok := pc["benchmark_symbol"].(string); ok && sym != "" {
			write("- **Benchmark:** %s (%v)\n", pc["benchmark_label"], sym)
			write("- **Reference:** %.2f USD%v (%v tier)\n", pc["benchmark_price"], pc["benchmark_unit"], pc["benchmark_tier"])
		}
		if comparable, _ := pc["comparable"].(bool); comparable {
			write("- **Claimed vs benchmark:** %.2f %v → Δ %+.2f%%\n", pc["claimed_price"], pc["claimed_currency"], pc["delta_pct"])
		} else if msg, ok := pc["message"].(string); ok && msg != "" {
			write("- %s\n", msg)
		}
		write("\n")
	}

	if parties, ok := pack["parties"].([]partyProfile); ok && len(parties) > 0 {
		write("## Parties\n\n")
		for _, p := range parties {
			write("### %s — %s\n\n", strings.Title(p.Role), p.Name)
			if p.Country != "" {
				write("- Country: %s\n", p.Country)
			}
			if p.Confidence > 0 {
				write("- Registry confidence: %.0f\n", p.Confidence)
			}
			if p.RegistryID != "" {
				write("- Registry ID: %s\n", p.RegistryID)
			}
			if len(p.Evidence) > 0 {
				write("\n**Evidence chain:**\n")
				for _, e := range p.Evidence {
					write("- %s (%s", e.ClaimType, e.Source)
					if e.Tier != "" {
						write(", %s", e.Tier)
					}
					write(")\n")
				}
			}
			write("\n")
		}
	}

	if g, ok := pack["relationship_graph"].(map[string]any); ok {
		if nodes, ok := g["nodes"].([]graphNode); ok && len(nodes) > 0 {
			write("## Relationship graph\n\n")
			write("| Entity | Type | Role |\n|--------|------|------|\n")
			for _, n := range nodes {
				role := n.Role
				if role == "" {
					role = n.AssetType
				}
				write("| %s | %s | %s |\n", n.Name, n.EntityType, role)
			}
			write("\n")
			if edges, ok := g["edges"].([]graphEdge); ok && len(edges) > 0 {
				write("**Links:**\n")
				for _, e := range edges {
					write("- %s → %s (%s", e.From, e.To, e.Type)
					if e.Detail != "" {
						write("; %s", e.Detail)
					}
					write(")\n")
				}
				write("\n")
			}
		}
	}

	if sec, ok := pack["sections"].(map[string]any); ok {
		write("## Verification\n\n")
		write("- **Score:** %v\n", sec["confidence_score"])
		write("- **Status:** %v\n", sec["confidence_status"])
		write("- **DD recommendation:** %v\n\n", sec["dd_recommendation"])

		mdList(&b, "Positive evidence", sec["positive_evidence"])
		mdList(&b, "Warnings", sec["warnings"])
		mdList(&b, "Red flags", sec["red_flags"])
		mdList(&b, "Missing documents", sec["missing_documents"])
		mdList(&b, "Recommended questions", sec["recommended_questions"])

		if checks, ok := sec["dd_checks"].([]any); ok && len(checks) > 0 {
			write("### Compliance checks\n\n")
			for _, c := range checks {
				if m, ok := c.(map[string]any); ok {
					write("- [%v] %v: %v (%v)\n", m["status"], m["dimension"], m["message"], m["tier"])
				}
			}
			write("\n")
		}
	}

	write("## Limitations\n\n")
	mdList(&b, "", pack["limitations"])
	write("\n## Disclaimer\n\n%s\n", pack["disclaimer"])
	return b.String()
}

func mdList(b *strings.Builder, heading string, items any) {
	arr, ok := items.([]any)
	if !ok {
		if ss, ok := items.([]string); ok {
			arr = make([]any, len(ss))
			for i, s := range ss {
				arr[i] = s
			}
		} else {
			return
		}
	}
	if len(arr) == 0 {
		return
	}
	if heading != "" {
		_, _ = fmt.Fprintf(b, "### %s\n\n", heading)
	}
	for _, item := range arr {
		_, _ = fmt.Fprintf(b, "- %v\n", item)
	}
	_, _ = fmt.Fprintln(b)
}

// PackToHTML renders a printable HTML report.
func PackToHTML(pack map[string]any) string {
	md := PackToMarkdown(pack)
	escaped := strings.ReplaceAll(md, "&", "&amp;")
	escaped = strings.ReplaceAll(escaped, "<", "&lt;")
	body := strings.ReplaceAll(escaped, "\n", "<br>\n")
	return fmt.Sprintf(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>MadSan Deal Pack</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#111}
h1{font-size:1.4rem}strong{color:#333}</style></head>
<body>%s</body></html>`, body)
}
