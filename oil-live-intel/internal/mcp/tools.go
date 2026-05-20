package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/services/confidence"
	"github.com/mining-map/oil-live-intel/internal/services/contacts"
	"github.com/mining-map/oil-live-intel/internal/services/opportunity"
	"github.com/mining-map/oil-live-intel/internal/services/supplier"
)

// ToolHandler executes an MCP tool by name.
type ToolHandler struct {
	Pool   *pgxpool.Pool
	Config config.Config
}

func (h *ToolHandler) Call(ctx context.Context, name string, args map[string]any) (string, error) {
	switch name {
	case "oil_live_map_snapshot":
		return h.mapSnapshot(ctx, args)
	case "oil_live_explain_event":
		return h.explainEvent(ctx, args)
	case "oil_live_list_opportunities":
		return h.listOpportunities(ctx, args)
	case "oil_live_company_profile":
		return h.companyProfile(ctx, args)
	case "oil_live_draft_outreach":
		return h.draftOutreach(ctx, args)
	case "oil_live_logistics_hint":
		return h.logisticsHint(ctx, args)
	case "oil_live_company_contacts":
		return h.companyContacts(ctx, args)
	default:
		return "", fmt.Errorf("unknown tool: %s", name)
	}
}

func (h *ToolHandler) mapSnapshot(ctx context.Context, args map[string]any) (string, error) {
	limit := 100
	rows, err := h.Pool.Query(ctx, `
		SELECT id, name, country, operator_name, products,
			ST_Y(geom::geometry), ST_X(geom::geometry), confidence
		FROM oil_terminals WHERE geom IS NOT NULL LIMIT $1
	`, limit)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var terminals []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var name, country, op string
		var products []string
		var lat, lon, conf float64
		if err := rows.Scan(&id, &name, &country, &op, &products, &lat, &lon, &conf); err != nil {
			return "", err
		}
		terminals = append(terminals, map[string]any{
			"id": id.String(), "name": name, "country": country,
			"operator": op, "products": products, "lat": lat, "lng": lon, "confidence": conf,
		})
	}
	cards, _ := opportunity.List(ctx, h.Pool, 0.5, 20)
	out := map[string]any{"terminals": terminals, "opportunities": cards}
	b, _ := json.MarshalIndent(out, "", "  ")
	return string(b), nil
}

func (h *ToolHandler) explainEvent(ctx context.Context, args map[string]any) (string, error) {
	id, _ := args["port_call_id"].(string)
	if id == "" {
		return "", fmt.Errorf("port_call_id required")
	}
	var eventType string
	var dur, din, dout, conf float64
	var evidence []byte
	var tname, vessel *string
	err := h.Pool.QueryRow(ctx, `
		SELECT pc.event_type, pc.duration_hours, COALESCE(pc.draft_in,0), COALESCE(pc.draft_out,0),
			pc.confidence, pc.evidence, t.name, pc.vessel_name
		FROM oil_port_calls pc
		LEFT JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.id::text = $1
	`, id).Scan(&eventType, &dur, &din, &dout, &conf, &evidence, &tname, &vessel)
	if err != nil {
		return "", err
	}
	breakdown := map[string]any{
		"event_type":       eventType,
		"confidence":       conf,
		"duration_hours":   dur,
		"draft_in":         din,
		"draft_out":        dout,
		"terminal":         tname,
		"vessel":           vessel,
		"scoring_note":     "Weights: inside terminal +0.25, duration +0.15/+0.10, draft +0.25, tanker +0.10, destination +0.10, product match +0.05; short stay -0.15",
		"example_max_score": confidence.ScorePortCall(confidence.Input{
			InsideTerminal: true, DurationHours: 24, DraftDeltaAbs: 2,
			KnownTanker: true, DestinationKnown: true, MatchingProductTerminal: true,
		}),
		"disclaimer": "Inferred from public AIS — not a confirmed private transaction.",
	}
	var ev []any
	_ = json.Unmarshal(evidence, &ev)
	breakdown["evidence"] = ev
	b, _ := json.MarshalIndent(breakdown, "", "  ")
	return string(b), nil
}

func (h *ToolHandler) listOpportunities(ctx context.Context, args map[string]any) (string, error) {
	minConf := 0.55
	if v, ok := args["min_confidence"].(float64); ok {
		minConf = v
	}
	items, err := opportunity.List(ctx, h.Pool, minConf, 50)
	if err != nil {
		return "", err
	}
	b, _ := json.MarshalIndent(items, "", "  ")
	return string(b), nil
}

func (h *ToolHandler) companyProfile(ctx context.Context, args map[string]any) (string, error) {
	id, _ := args["company_id"].(string)
	if id == "" {
		return "", fmt.Errorf("company_id required")
	}
	var name, ctype, country, website, status string
	var conf float64
	var supplierID *string
	err := h.Pool.QueryRow(ctx, `
		SELECT name, company_type, country, website, confidence, supplier_status, supplier_id
		FROM oil_companies WHERE id::text = $1
	`, id).Scan(&name, &ctype, &country, &website, &conf, &status, &supplierID)
	if err != nil {
		return "", err
	}
	rows, _ := h.Pool.Query(ctx, `
		SELECT name, port, products FROM oil_terminals
		WHERE operator_name ILIKE '%' || $1 || '%' LIMIT 10
	`, name)
	var terminals []map[string]any
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var tn, port string
			var products []string
			_ = rows.Scan(&tn, &port, &products)
			terminals = append(terminals, map[string]any{"name": tn, "port": port, "products": products})
		}
	}
	out := map[string]any{
		"id": id, "name": name, "company_type": ctype, "country": country,
		"website": website, "confidence": conf, "supplier_status": status,
		"supplier_id": supplierID, "related_terminals": terminals,
	}
	b, _ := json.MarshalIndent(out, "", "  ")
	return string(b), nil
}

func (h *ToolHandler) draftOutreach(ctx context.Context, args map[string]any) (string, error) {
	id, _ := args["company_id"].(string)
	prof, err := h.companyProfile(ctx, map[string]any{"company_id": id})
	if err != nil {
		return "", err
	}
	var data map[string]any
	_ = json.Unmarshal([]byte(prof), &data)
	name, _ := data["name"].(string)
	country, _ := data["country"].(string)
	draft := fmt.Sprintf(`Subject: Introduction — petroleum logistics partnership inquiry

Dear %s team,

We are mapping terminal and vessel activity in %s using public AIS and terminal intelligence. Our platform flagged your organization as a relevant operator in the region.

We would welcome a brief call to explore storage, throughput, or supply-chain collaboration. We do not represent confirmed cargo or private transaction data — only inferred public signals we are happy to walk through with evidence.

Best regards,
[Your name]
[Company]

---
Disclaimer: This draft uses public/inferred data only. Edit before sending. Not legal or trading advice.`,
		name, country)
	return draft, nil
}

func (h *ToolHandler) logisticsHint(ctx context.Context, args map[string]any) (string, error) {
	id, _ := args["terminal_id"].(string)
	if id == "" {
		return "", fmt.Errorf("terminal_id required")
	}
	var name, country string
	var lat, lon float64
	err := h.Pool.QueryRow(ctx, `
		SELECT name, country, ST_Y(geom::geometry), ST_X(geom::geometry)
		FROM oil_terminals WHERE id::text = $1
	`, id).Scan(&name, &country, &lat, &lon)
	if err != nil {
		return "", err
	}
	out := map[string]any{
		"terminal": name, "country": country, "lat": lat, "lng": lon,
		"nearest_pipeline_km": nil,
		"note":                "Pipeline distance requires OSM segment import (Phase 16 full). Use Route Planner for sea/inland corridor.",
		"route_planner_prefill": map[string]any{
			"origin": map[string]any{"name": name, "lat": lat, "lng": lon, "kind": "terminal"},
			"preferred_methods": []string{"sea", "pipeline"},
		},
		"disclaimer": "Indicative logistics hint — validate tie-in and tariffs with terminal operator.",
	}
	b, _ := json.MarshalIndent(out, "", "  ")
	return string(b), nil
}

func (h *ToolHandler) companyContacts(ctx context.Context, args map[string]any) (string, error) {
	id := strVal(args, "company_id")
	if id == "" {
		return "", fmt.Errorf("company_id required")
	}
	cid, err := uuid.Parse(id)
	if err != nil {
		return "", err
	}
	bundle, err := contacts.List(ctx, h.Pool, cid)
	if err != nil {
		return "", err
	}
	b, _ := json.MarshalIndent(bundle, "", "  ")
	return string(b), nil
}

// ListToolDefs returns MCP tool metadata.
func ListToolDefs() []map[string]any {
	names := []struct{ name, desc string }{
		{"oil_live_map_snapshot", "Terminals and open opportunities snapshot"},
		{"oil_live_explain_event", "Port call evidence and confidence breakdown (port_call_id)"},
		{"oil_live_list_opportunities", "List open trade opportunities with profit checklist"},
		{"oil_live_company_profile", "Company profile with related terminals (company_id)"},
		{"oil_live_company_contacts", "Contacts + TED procurement matches (company_id)"},
		{"oil_live_draft_outreach", "Draft outreach email from public facts (company_id)"},
		{"oil_live_logistics_hint", "Logistics / route planner prefill for terminal (terminal_id)"},
		{"oil_live_save_to_suppliers", "Save company to Suppliers map via license+annotation (company_id, auth_token)"},
	}
	var tools []map[string]any
	for _, t := range names {
		tools = append(tools, map[string]any{
			"name":        t.name,
			"description": t.desc,
			"inputSchema": map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		})
	}
	return tools
}

// SaveToSuppliersTool is exposed separately when auth token provided in args.
func (h *ToolHandler) SaveToSuppliers(ctx context.Context, companyID, auth string) (string, error) {
	cid, err := uuid.Parse(companyID)
	if err != nil {
		return "", err
	}
	var c supplier.Company
	var website *string
	err = h.Pool.QueryRow(ctx, `
		SELECT id, name, company_type, country, website, confidence, metadata
		FROM oil_companies WHERE id=$1
	`, cid).Scan(&c.ID, &c.Name, &c.CompanyType, &c.Country, &website, &c.Confidence, &c.Metadata)
	if err != nil {
		return "", err
	}
	if website != nil {
		c.Website = *website
	}
	res, err := supplier.SaveToSuppliers(ctx, h.Pool, h.Config.ExistingBackendURL, h.Config.SupplierCreateEndpoint, c, auth, nil)
	if err != nil {
		return "", err
	}
	b, _ := json.Marshal(res)
	return string(b), nil
}

func strVal(args map[string]any, key string) string {
	if v, ok := args[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}
