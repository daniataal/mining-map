package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mining-map/oil-live-intel/internal/mcp"
	"github.com/mining-map/oil-live-intel/internal/services/confidence"
	"github.com/mining-map/oil-live-intel/internal/services/contacts"
	"github.com/mining-map/oil-live-intel/internal/services/economics"
	"github.com/mining-map/oil-live-intel/internal/services/opportunity"
)

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
	items, err := opportunity.List(r.Context(), s.Pool, minConf, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
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
		SELECT reporter_country, partner_country, hs_code, flow, trade_value_usd, period
		FROM oil_trade_flows WHERE reporter_country ILIKE $1 OR partner_country ILIKE $1
		ORDER BY created_at DESC LIMIT 5
	`, country)
	var flows []map[string]any
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var rep, partner, hs, flow, period string
			var val *float64
			_ = rows.Scan(&rep, &partner, &hs, &flow, &val, &period)
			flows = append(flows, map[string]any{
				"reporter": rep, "partner": partner, "hs_code": hs,
				"flow": flow, "value_usd": val, "period": period,
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
