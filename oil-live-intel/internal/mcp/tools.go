package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

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
	case "oil_live_list_cargo_records":
		return h.listCargoRecords(ctx, args)
	case "oil_live_get_cargo_record":
		return h.getCargoRecord(ctx, args)
	case "oil_live_get_sync_status":
		return h.getSyncStatus(ctx, args)
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

func (h *ToolHandler) listCargoRecords(ctx context.Context, args map[string]any) (string, error) {
	minConf := 0.55
	if v, ok := args["min_confidence"].(float64); ok {
		minConf = v
	}
	limit := 50
	if v, ok := args["limit"].(float64); ok && int(v) > 0 {
		limit = int(v)
	}
	commodity := strVal(args, "commodity")
	country := strVal(args, "country")
	mmsi := strVal(args, "mmsi")

	q := `
		SELECT id, synthetic_bol_id, recipe, commodity_family, confidence, triangulation_score,
			shipper_name, consignee_name, vessel_name, mmsi, load_port_name, load_country,
			discharge_hint, volume_best_estimate, volume_unit, event_date,
			corridor_load_lat, corridor_load_lng, corridor_discharge_lat, corridor_discharge_lng
		FROM meridian_cargo_records WHERE confidence >= $1`
	qArgs := []any{minConf}
	n := 2
	if commodity != "" {
		q += fmt.Sprintf(` AND commodity_family = $%d`, n)
		qArgs = append(qArgs, commodity)
		n++
	}
	if country != "" {
		q += fmt.Sprintf(` AND (load_country ILIKE $%d OR discharge_country ILIKE $%d)`, n, n)
		qArgs = append(qArgs, "%"+country+"%")
		n++
	}
	if mmsi != "" {
		q += fmt.Sprintf(` AND mmsi::text = $%d`, n)
		qArgs = append(qArgs, mmsi)
		n++
	}
	q += fmt.Sprintf(` ORDER BY event_date DESC NULLS LAST, confidence DESC LIMIT $%d`, n)
	qArgs = append(qArgs, limit)

	rows, err := h.Pool.Query(ctx, q, qArgs...)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var bolID, recipe, family string
		var shipper, consignee, vessel, loadPort, loadCountry, discharge *string
		var mmsiVal *int64
		var conf float64
		var tri int
		var vol *float64
		var volUnit *string
		var eventDate *time.Time
		var loadLat, loadLng, discLat, discLng *float64
		if err := rows.Scan(&id, &bolID, &recipe, &family, &conf, &tri,
			&shipper, &consignee, &vessel, &mmsiVal, &loadPort, &loadCountry, &discharge, &vol, &volUnit, &eventDate,
			&loadLat, &loadLng, &discLat, &discLng); err != nil {
			return "", err
		}
		items = append(items, map[string]any{
			"id": id.String(), "synthetic_bol_id": bolID, "recipe": recipe,
			"commodity_family": family, "confidence": conf, "triangulation_score": tri,
			"shipper_name": shipper, "consignee_name": consignee, "vessel_name": vessel,
			"mmsi": mmsiVal, "load_port_name": loadPort, "load_country": loadCountry,
			"discharge_hint": discharge, "volume_best_estimate": vol, "volume_unit": volUnit,
			"event_date": formatTimePtr(eventDate),
			"corridor_load_lat": loadLat, "corridor_load_lng": loadLng,
			"corridor_discharge_lat": discLat, "corridor_discharge_lng": discLng,
		})
	}
	out := map[string]any{"cargo_records": items, "count": len(items)}
	b, _ := json.MarshalIndent(out, "", "  ")
	return string(b), nil
}

func (h *ToolHandler) getCargoRecord(ctx context.Context, args map[string]any) (string, error) {
	id := strVal(args, "id")
	if id == "" {
		id = strVal(args, "cargo_record_id")
	}
	if id == "" {
		return "", fmt.Errorf("id or cargo_record_id required")
	}
	rows, err := h.Pool.Query(ctx, `
		SELECT id, synthetic_bol_id, fingerprint, recipe, commodity_family, confidence, triangulation_score,
			bol_tier, shipper_name, consignee_name, vessel_name, mmsi, load_port_name, load_country,
			discharge_hint, discharge_country, commodity_description,
			volume_low, volume_high, volume_best_estimate, volume_method, volume_unit,
			event_date, evidence_chain, sources
		FROM meridian_cargo_records WHERE id::text = $1 OR synthetic_bol_id = $1
		LIMIT 1
	`, id)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	if !rows.Next() {
		return "", fmt.Errorf("cargo record not found")
	}
	var rid, bolID, fingerprint, recipe, family, tier string
	var shipper, consignee, vessel, loadPort, loadCountry, discharge, dischargeCountry, desc, volMethod, volUnit *string
	var mmsi *int64
	var conf float64
	var tri int
	var volLo, volHi, volBest *float64
	var eventDate *time.Time
	var evidence, sources []byte
	if err := rows.Scan(&rid, &bolID, &fingerprint, &recipe, &family, &conf, &tri, &tier,
		&shipper, &consignee, &vessel, &mmsi, &loadPort, &loadCountry, &discharge, &dischargeCountry, &desc,
		&volLo, &volHi, &volBest, &volMethod, &volUnit, &eventDate, &evidence, &sources); err != nil {
		return "", err
	}
	var evChain, srcList any
	_ = json.Unmarshal(evidence, &evChain)
	_ = json.Unmarshal(sources, &srcList)
	out := map[string]any{
		"id": rid, "synthetic_bol_id": bolID, "fingerprint": fingerprint,
		"recipe": recipe, "commodity_family": family, "confidence": conf,
		"triangulation_score": tri, "bol_tier": tier,
		"shipper_name": shipper, "consignee_name": consignee, "vessel_name": vessel, "mmsi": mmsi,
		"load_port_name": loadPort, "load_country": loadCountry,
		"discharge_hint": discharge, "discharge_country": dischargeCountry,
		"commodity_description": desc,
		"volume_low": volLo, "volume_high": volHi, "volume_best_estimate": volBest,
		"volume_method": volMethod, "volume_unit": volUnit, "event_date": formatTimePtr(eventDate),
		"evidence_chain": evChain, "sources": srcList,
		"disclaimer": "Synthetic cargo record — inferred from public sources, not a legal Bill of Lading.",
	}
	b, _ := json.MarshalIndent(out, "", "  ")
	return string(b), nil
}

func (h *ToolHandler) getSyncStatus(ctx context.Context, _ map[string]any) (string, error) {
	var terminalCount, cargoCount, portCallCount int
	var lastGraphSync, lastCargoAt *time.Time
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_terminals`).Scan(&terminalCount)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_port_calls`).Scan(&portCallCount)
	_ = h.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM meridian_cargo_records`).Scan(&cargoCount)
	_ = h.Pool.QueryRow(ctx, `
		SELECT MAX(GREATEST(created_at, COALESCE(event_date, created_at)))
		FROM meridian_cargo_records
	`).Scan(&lastCargoAt)
	_ = h.Pool.QueryRow(ctx, `
		SELECT value FROM oil_live_sync_state WHERE key = 'last_graph_sync_at'
	`).Scan(&lastGraphSync)

	formatTime := func(t *time.Time) any {
		if t == nil || t.IsZero() {
			return nil
		}
		return t.UTC().Format(time.RFC3339)
	}
	out := map[string]any{
		"terminal_count":     terminalCount,
		"cargo_record_count": cargoCount,
		"port_call_count":    portCallCount,
		"last_graph_sync_at": formatTime(lastGraphSync),
		"last_cargo_at":      formatTime(lastCargoAt),
		"disclaimer":         "Counts from Meridian DB — inferred tiers where noted.",
	}
	b, _ := json.MarshalIndent(out, "", "  ")
	return string(b), nil
}

func formatTimePtr(t *time.Time) any {
	if t == nil || t.IsZero() {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
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
		{"oil_live_list_cargo_records", "Synthetic Meridian cargo records (commodity, country, min_confidence, limit)"},
		{"oil_live_get_cargo_record", "Full synthetic cargo record with evidence (id or cargo_record_id)"},
		{"oil_live_get_sync_status", "Meridian DB coverage counts and last graph-sync timestamp"},
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
