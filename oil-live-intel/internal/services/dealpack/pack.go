package dealpack

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mining-map/oil-live-intel/internal/services/economics"
)

type checklistItem struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Status  string `json:"status"` // green | amber | red
	Weight  int    `json:"weight"`
	Detail  string `json:"detail,omitempty"`
	Action  string `json:"action,omitempty"`
}

// Pack is the aggregated Deal Execution Pack for an opportunity.
type Pack struct {
	OpportunityID     string           `json:"opportunity_id"`
	Title             string           `json:"title"`
	Hypothesis        string           `json:"hypothesis,omitempty"`
	ReadinessScore    float64          `json:"readiness_score"`
	ReadinessPct      int              `json:"readiness_pct"`
	Checklist         []checklistItem  `json:"checklist"`
	CargoRecords      []map[string]any `json:"cargo_records"`
	PortCall          map[string]any   `json:"port_call,omitempty"`
	Terminal          map[string]any   `json:"terminal,omitempty"`
	Economics         map[string]any   `json:"economics,omitempty"`
	ProfitChecklist   []string         `json:"profit_checklist,omitempty"`
	Disclaimer        string           `json:"disclaimer"`
}

// Build aggregates opportunity context into a deal execution pack.
func Build(ctx context.Context, pool *pgxpool.Pool, opportunityID uuid.UUID) (Pack, error) {
	var pack Pack
	var title, hypothesis string
	var terminalID, portCallID *uuid.UUID
	var mmsi *int64
	var profitPC []byte
	var evidence []byte
	err := pool.QueryRow(ctx, `
		SELECT title, hypothesis, terminal_id, port_call_id, mmsi, profit_checklist, evidence
		FROM oil_opportunities WHERE id = $1 AND status = 'open'
	`, opportunityID).Scan(&title, &hypothesis, &terminalID, &portCallID, &mmsi, &profitPC, &evidence)
	if err != nil {
		return pack, fmt.Errorf("opportunity not found")
	}
	pack.OpportunityID = opportunityID.String()
	pack.Title = title
	pack.Hypothesis = hypothesis
	_ = json.Unmarshal(profitPC, &pack.ProfitChecklist)
	pack.Disclaimer = "Deal readiness from inferred public data only — not confirmed transactions or legal BOLs."

	checklist := defaultChecklist()
	if portCallID != nil {
		var pc map[string]any
		_ = pool.QueryRow(ctx, `
			SELECT json_build_object(
				'id', id, 'event_type', event_type, 'confidence', confidence,
				'estimated_volume_barrels', estimated_volume_barrels
			) FROM oil_port_calls WHERE id = $1
		`, *portCallID).Scan(&pc)
		pack.PortCall = pc
		checklist[0].Status = "green"
		checklist[0].Detail = "Port call linked"
	} else {
		checklist[0].Status = "red"
		checklist[0].Action = "watch_map"
	}

	if terminalID != nil {
		var term map[string]any
		_ = pool.QueryRow(ctx, `
			SELECT json_build_object('id', id, 'name', name, 'country', country, 'operator_name', operator_name)
			FROM oil_terminals WHERE id = $1
		`, *terminalID).Scan(&term)
		pack.Terminal = term
		if term != nil {
			checklist[2].Status = "amber"
			checklist[2].Detail = "Terminal context available"
		}
	}

	var companyName *string
	if terminalID != nil {
		_ = pool.QueryRow(ctx, `
			SELECT name FROM oil_companies c
			JOIN oil_terminals t ON t.operator_name ILIKE '%' || c.name || '%'
			WHERE t.id = $1 LIMIT 1
		`, *terminalID).Scan(&companyName)
	}
	if companyName != nil {
		checklist[1].Status = "green"
		checklist[1].Detail = *companyName
	} else {
		checklist[1].Status = "amber"
		checklist[1].Action = "open_dossier"
	}

	bundle, econErr := economics.Get(ctx, pool, opportunityID)
	if econErr == nil {
		pack.Economics = map[string]any{
			"sheet": bundle.Sheet, "result": bundle.Result,
		}
		if bundle.Result.Complete {
			checklist[3].Status = "green"
			checklist[3].Detail = "Economics sheet complete"
		} else {
			checklist[3].Status = "amber"
			checklist[3].Action = "calc_margin"
		}
	} else {
		checklist[3].Status = "red"
		checklist[3].Action = "calc_margin"
	}

	rows, _ := pool.Query(ctx, `
		SELECT id, synthetic_bol_id, commodity_family, confidence, triangulation_score,
			shipper_name, consignee_name, volume_best_estimate
		FROM meridian_cargo_records
		WHERE opportunity_id = $1 OR port_call_id = $2
		ORDER BY confidence DESC LIMIT 5
	`, opportunityID, portCallID)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var id uuid.UUID
			var bolID, family string
			var shipper, consignee *string
			var conf float64
			var tri int
			var vol *float64
			_ = rows.Scan(&id, &bolID, &family, &conf, &tri, &shipper, &consignee, &vol)
			pack.CargoRecords = append(pack.CargoRecords, map[string]any{
				"id": id.String(), "synthetic_bol_id": bolID, "commodity_family": family,
				"confidence": conf, "triangulation_score": tri,
				"shipper_name": shipper, "consignee_name": consignee, "volume_best_estimate": vol,
			})
		}
	}
	if len(pack.CargoRecords) > 0 {
		checklist[0].Status = "green"
	}

	var contactCount int
	if terminalID != nil {
		_ = pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM oil_company_contacts cc
			JOIN oil_companies c ON c.id = cc.company_id
			JOIN oil_terminals t ON t.id = $1
			WHERE t.operator_name ILIKE '%' || c.name || '%'
		`, *terminalID).Scan(&contactCount)
	}
	if contactCount > 0 {
		checklist[5].Status = "green"
		checklist[5].Detail = fmt.Sprintf("%d contact(s) on file", contactCount)
	} else {
		checklist[5].Status = "amber"
		checklist[5].Action = "run_contact_agent"
	}

	checklist[4].Status = "amber"
	checklist[4].Action = "open_route_planner"
	checklist[6].Status = "amber"
	checklist[6].Action = "save_supplier"

	pack.Checklist = checklist
	pack.ReadinessScore, pack.ReadinessPct = scoreChecklist(checklist)
	_, _ = pool.Exec(ctx, `
		UPDATE oil_opportunities SET deal_execution_pack = $2, updated_at = now() WHERE id = $1
	`, opportunityID, mustJSON(pack))
	return pack, nil
}

func defaultChecklist() []checklistItem {
	return []checklistItem{
		{ID: "movement", Label: "Movement evidenced", Weight: 20, Status: "red"},
		{ID: "counterparty", Label: "Counterparty identified", Weight: 15, Status: "red"},
		{ID: "macro_trade", Label: "Macro trade context reviewed", Weight: 10, Status: "amber"},
		{ID: "margin", Label: "Indicative margin entered", Weight: 20, Status: "red"},
		{ID: "logistics", Label: "Logistics path drafted", Weight: 10, Status: "red"},
		{ID: "contacts", Label: "Contact path available", Weight: 15, Status: "red"},
		{ID: "internal", Label: "Internal record (Suppliers / Deal Room)", Weight: 10, Status: "red"},
	}
}

func scoreChecklist(items []checklistItem) (float64, int) {
	var earned, total float64
	for _, it := range items {
		w := float64(it.Weight)
		total += w
		switch it.Status {
		case "green":
			earned += w
		case "amber":
			earned += w * 0.5
		}
	}
	if total == 0 {
		return 0, 0
	}
	pct := int((earned / total) * 100)
	return earned / total, pct
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
