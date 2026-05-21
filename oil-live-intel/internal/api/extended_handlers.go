package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mining-map/oil-live-intel/internal/mcp"
	"github.com/mining-map/oil-live-intel/internal/services/confidence"
	"github.com/mining-map/oil-live-intel/internal/services/contacts"
	"github.com/mining-map/oil-live-intel/internal/services/economics"
	"github.com/mining-map/oil-live-intel/internal/services/opportunity"
	"github.com/mining-map/oil-live-intel/internal/services/trade"
)

func (s *Server) ListTradeManifests(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := queryInt(r, "limit", 50)
	if limit > 500 {
		limit = 500
	}
	sql := `
		SELECT id::text, data_source, bol_tier, source_record_url,
			importer_name, exporter_name, partner_country, reporter_country,
			hs_code, commodity_family, product_description, period_year, value_usd
		FROM trade_manifest_rows WHERE 1=1
	`
	args := []any{}
	n := 1
	if q != "" {
		sql += fmt.Sprintf(` AND (
			importer_name ILIKE $%d OR exporter_name ILIKE $%d
			OR partner_country ILIKE $%d OR product_description ILIKE $%d
		)`, n, n, n, n)
		args = append(args, "%"+q+"%")
		n++
	}
	sql += fmt.Sprintf(` ORDER BY ingested_at DESC NULLS LAST LIMIT $%d`, n)
	args = append(args, limit)

	rows, err := s.Pool.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, src, tier, url, imp, exp, partner, reporter, hs, family, product *string
		var year *int
		var val *float64
		_ = rows.Scan(&id, &src, &tier, &url, &imp, &exp, &partner, &reporter, &hs, &family, &product, &year, &val)
		out = append(out, map[string]any{
			"id": id, "data_source": src, "bol_tier": tier, "source_record_url": url,
			"importer_name": imp, "exporter_name": exp, "partner_country": partner,
			"reporter_country": reporter, "hs_code": hs, "commodity_family": family,
			"product_description": product, "period_year": year, "value_usd": val,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"manifests": out,
		"count":     len(out),
		"disclaimer": "Open customs / user_upload / macro rows — verify tier and source URL.",
	})
}

func (s *Server) ListTradeFlows(w http.ResponseWriter, r *http.Request) {
	country := r.URL.Query().Get("country")
	hs := r.URL.Query().Get("hs_code")
	limit := queryInt(r, "limit", 30)
	q := `
		SELECT data_source, reporter, partner, hs_code, year::text, flow_type,
			trade_value_usd, net_weight_kg
		FROM oil_trade_flows WHERE 1=1
	`
	args := []any{}
	n := 1
	if country != "" {
		q += fmt.Sprintf(` AND (reporter ILIKE $%d OR partner ILIKE $%d)`, n, n)
		args = append(args, "%"+country+"%")
		n++
	}
	if hs != "" {
		q += fmt.Sprintf(` AND hs_code = $%d`, n)
		args = append(args, hs)
		n++
	}
	q += fmt.Sprintf(` ORDER BY ingested_at DESC NULLS LAST LIMIT $%d`, n)
	args = append(args, limit)

	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var flows []map[string]any
	for rows.Next() {
		var src, rep, partner, code, yr, flowType string
		var val, wgt *float64
		_ = rows.Scan(&src, &rep, &partner, &code, &yr, &flowType, &val, &wgt)
		flow := "Import"
		if flowType == "X" {
			flow = "Export"
		}
		flows = append(flows, map[string]any{
			"source": src, "reporter": rep, "partner": partner,
			"hs_code": code, "period": yr, "flow": flow,
			"trade_value_usd": val, "net_weight_kg": wgt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"flows": flows, "disclaimer": "Macro trade data — not vessel-level transactions."})
}

func (s *Server) TriggerTradeSync(w http.ResponseWriter, r *http.Request) {
	if s.Config.InternalBroadcastKey == "" || r.Header.Get("X-Oil-Intel-Internal") != s.Config.InternalBroadcastKey {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	res, err := trade.RunSync(r.Context(), s.Pool, s.Config, s.Log)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) OpportunityEconomics(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	oid, err := uuid.Parse(id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid opportunity id")
		return
	}
	switch r.Method {
	case http.MethodGet:
		bundle, err := economics.Get(r.Context(), s.Pool, oid)
		if err != nil {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, bundle)
	case http.MethodPut:
		var sheet economics.Sheet
		if err := json.NewDecoder(r.Body).Decode(&sheet); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid json")
			return
		}
		bundle, err := economics.Save(r.Context(), s.Pool, oid, sheet)
		if err != nil {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, bundle)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "GET or PUT only")
	}
}

func (s *Server) ListOpportunities(w http.ResponseWriter, r *http.Request) {
	minConf := queryFloat(r, "min_confidence", 0.55)
	limit := queryInt(r, "limit", 50)
	excludeDemo := queryBool(r, "exclude_demo", s.Config.DisableDemoSeed)
	fetchLimit := limit * 4
	if fetchLimit < 120 {
		fetchLimit = 120
	}
	if fetchLimit > 500 {
		fetchLimit = 500
	}
	items, err := opportunity.List(r.Context(), s.Pool, minConf, fetchLimit, excludeDemo)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	items = opportunity.DedupeAndDiversify(items, limit)
	writeJSON(w, http.StatusOK, map[string]any{"opportunities": items})
}

func (s *Server) ExplainPortCall(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h := &mcp.ToolHandler{Pool: s.Pool, Config: s.Config}
	text, err := h.Call(r.Context(), "oil_live_explain_event", map[string]any{"port_call_id": id})
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	var body map[string]any
	_ = json.Unmarshal([]byte(text), &body)
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) CompanyContacts(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	cid, err := uuid.Parse(id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid company id")
		return
	}
	bundle, err := contacts.List(r.Context(), s.Pool, cid)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, bundle)
}

func (s *Server) AddCompanyContact(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	cid, err := uuid.Parse(id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid company id")
		return
	}
	var body struct {
		ContactType  string `json:"contact_type"`
		ContactScope string `json:"contact_scope"`
		Label        string `json:"label"`
		Value        string `json:"value"`
		CreatedBy    string `json:"created_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	c, err := contacts.Add(r.Context(), s.Pool, cid, contacts.AddInput{
		ContactType:  body.ContactType,
		ContactScope: body.ContactScope,
		Label:        body.Label,
		Value:        body.Value,
		CreatedBy:    body.CreatedBy,
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"contact": c})
}

func (s *Server) CounterpartyHints(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var name, country string
	err := s.Pool.QueryRow(r.Context(), `SELECT name, country FROM oil_companies WHERE id::text=$1`, id).Scan(&name, &country)
	if err != nil {
		writeErr(w, http.StatusNotFound, "company not found")
		return
	}
	hints := []map[string]any{
		{
			"source": "comtrade_macro", "confidence": 0.45,
			"label":    fmt.Sprintf("Macro trade context for %s", country),
			"description": "Country-level import/export flows (HS 2709/2710/2711) — not a named buyer/seller for this vessel.",
		},
		{
			"source": "terminal_operator", "confidence": 0.55,
			"label":    "Possible seller/operator (inferred)",
			"description": "Terminal operator linked to public terminal records may indicate supply-side contact.",
		},
		{
			"source": "procurement_public", "confidence": 0.4,
			"label":       "Public procurement signals",
			"description": "See GET /companies/{id}/contacts for TED notice matches (heuristic buyer/title).",
		},
	}
	rows, _ := s.Pool.Query(r.Context(), `
		SELECT reporter, partner, hs_code, flow_type, trade_value_usd, year::text
		FROM oil_trade_flows WHERE reporter ILIKE $1 OR partner ILIKE $1
		ORDER BY ingested_at DESC LIMIT 5
	`, "%"+country+"%")
	var flows []map[string]any
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var rep, partner, hs, flowType, period string
			var val *float64
			_ = rows.Scan(&rep, &partner, &hs, &flowType, &val, &period)
			flowLabel := "Import"
			if flowType == "X" {
				flowLabel = "Export"
			}
			flows = append(flows, map[string]any{
				"reporter": rep, "partner": partner, "hs_code": hs,
				"flow": flowLabel, "value_usd": val, "period": period,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"company_id": id, "hints": hints, "trade_flows": flows,
		"disclaimer": "Counterparty hints are inferred from public macro data — not confirmed buyers or sellers.",
	})
}

func (s *Server) LogisticsHints(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h := &mcp.ToolHandler{Pool: s.Pool, Config: s.Config}
	text, err := h.Call(r.Context(), "oil_live_logistics_hint", map[string]any{"terminal_id": id})
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	var body map[string]any
	_ = json.Unmarshal([]byte(text), &body)
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) DraftOutreach(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h := &mcp.ToolHandler{Pool: s.Pool, Config: s.Config}
	text, err := h.Call(r.Context(), "oil_live_draft_outreach", map[string]any{"company_id": id})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"company_id": id, "draft": text,
		"disclaimer": "Edit before sending. Generated from public facts only.",
	})
}

func (s *Server) ConfidenceBreakdown(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	item, err := s.getPortCall(r, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "port call not found")
		return
	}
	_ = item
	maxScore := confidence.ScorePortCall(confidence.Input{
		InsideTerminal: true, DurationHours: 24, DraftDeltaAbs: 2,
		KnownTanker: true, DestinationKnown: true, MatchingProductTerminal: true,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"weights": []map[string]any{
			{"factor": "inside_terminal", "points": 0.25},
			{"factor": "duration_6h_plus", "points": 0.15},
			{"factor": "duration_18h_plus", "points": 0.10},
			{"factor": "draft_change_1m_plus", "points": 0.25},
			{"factor": "known_tanker", "points": 0.10},
			{"factor": "destination_known", "points": 0.10},
			{"factor": "product_terminal_match", "points": 0.05},
			{"factor": "short_stay_penalty", "points": -0.15},
		},
		"example_max_score": maxScore,
		"disclaimer":        "Deterministic scoring from public AIS — not confirmed transactions.",
	})
}
