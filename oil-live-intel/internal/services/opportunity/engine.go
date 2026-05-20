package opportunity

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	TypeTermLead       = "possible_term_contract_lead"
	TypeCargoFlip      = "possible_cargo_flip"
	TypeStorageArb     = "possible_storage_arbitrage"
	TypeDistressIdle   = "possible_distress_slow_steaming"
)

var defaultProfitChecklist = []string{
	"Confirm cargo grade and volume with operator (not inferred AIS alone)",
	"Obtain indicative buy and sell prices",
	"Quote freight or demurrage if relevant",
	"Validate storage or terminal slot availability and tariff",
	"Run counterparty credit and sanctions screening",
}

// ScanRecentPortCalls creates opportunities from closed port calls (repeat visits, flips).
func ScanRecentPortCalls(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	created := 0
	n, err := scanTermLeads(ctx, pool)
	created += n
	if err != nil {
		return created, err
	}
	n, err = scanCargoFlip(ctx, pool)
	created += n
	return created, err
}

func scanTermLeads(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT pc.terminal_id, t.name, t.operator_name, pc.mmsi, COUNT(*)::int
		FROM oil_port_calls pc
		JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.status='closed' AND pc.arrival_ts > now() - interval '90 days'
		GROUP BY pc.terminal_id, t.name, t.operator_name, pc.mmsi
		HAVING COUNT(*) >= 3
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var tid uuid.UUID
		var tname, op string
		var mmsi int64
		var cnt int
		if err := rows.Scan(&tid, &tname, &op, &mmsi, &cnt); err != nil {
			return n, err
		}
		title := fmt.Sprintf("Possible term relationship at %s", tname)
		hyp := fmt.Sprintf("MMSI %d visited %s %d times in 90 days — possible recurring commercial relationship (inferred).", mmsi, tname, cnt)
		ev, _ := json.Marshal([]string{
			fmt.Sprintf("Repeat visits: %d in 90 days", cnt),
			"Operator: " + op,
			"Inferred from public AIS — not a confirmed contract",
		})
		pc, _ := json.Marshal(defaultProfitChecklist)
		if inserted, _ := insertOpportunity(ctx, pool, TypeTermLead, mmsi, tid, title, hyp, 0.72, ev, pc); inserted {
			n++
		}
	}
	return n, rows.Err()
}

func scanCargoFlip(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT pc.id, pc.mmsi, pc.vessel_name, pc.terminal_id, t.name, pc.event_type,
			pc.duration_hours, pc.confidence, pc.draft_delta
		FROM oil_port_calls pc
		JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.status='closed'
		  AND pc.event_type='possible_loading'
		  AND pc.duration_hours < 48
		  AND pc.arrival_ts > now() - interval '14 days'
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var pcID, tid uuid.UUID
		var mmsi int64
		var vessel, tname, event string
		var dur, conf, ddelta float64
		if err := rows.Scan(&pcID, &mmsi, &vessel, &tid, &tname, &event, &dur, &conf, &ddelta); err != nil {
			return n, err
		}
		title := fmt.Sprintf("Possible short-haul flip at %s", tname)
		hyp := fmt.Sprintf("%s may have loaded at %s with short dwell (%.1fh) — possible repositioning/flip candidate, not listed for sale.", vessel, tname, dur)
		ev, _ := json.Marshal([]string{
			"Short dwell after possible loading",
			fmt.Sprintf("Draft delta: %.1fm", ddelta),
			"Trading hub / storage terminal context",
			"Inferred only — verify cargo terms with counterparty",
		})
		pcJSON, _ := json.Marshal(defaultProfitChecklist)
		if inserted, _ := insertOpportunity(ctx, pool, TypeCargoFlip, mmsi, tid, title, hyp, conf*0.9, ev, pcJSON); inserted {
			_, _ = pool.Exec(ctx, `UPDATE oil_opportunities SET port_call_id=$2 WHERE opportunity_type=$1 AND mmsi=$3 AND terminal_id=$4 AND status='open'`,
				TypeCargoFlip, pcID, mmsi, tid)
			n++
		}
	}
	return n, rows.Err()
}

func insertOpportunity(ctx context.Context, pool *pgxpool.Pool, otype string, mmsi int64, tid uuid.UUID, title, hypothesis string, conf float64, evidence, checklist []byte) (bool, error) {
	var exists int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM oil_opportunities
		WHERE opportunity_type=$1 AND mmsi=$2 AND terminal_id=$3 AND status='open'
	`, otype, mmsi, tid).Scan(&exists)
	if exists > 0 {
		return false, nil
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO oil_opportunities (opportunity_type, mmsi, terminal_id, title, hypothesis, confidence, evidence, profit_checklist, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + interval '30 days')
	`, otype, mmsi, tid, title, hypothesis, conf, evidence, checklist)
	return err == nil, err
}

// List returns open opportunities.
func List(ctx context.Context, pool *pgxpool.Pool, minConf float64, limit int) ([]map[string]any, error) {
	rows, err := pool.Query(ctx, `
		SELECT o.id, o.opportunity_type, o.title, o.hypothesis, o.confidence, o.evidence, o.profit_checklist,
			o.mmsi, t.name AS terminal_name, o.created_at
		FROM oil_opportunities o
		LEFT JOIN oil_terminals t ON t.id = o.terminal_id
		WHERE o.status='open' AND o.confidence >= $1
		ORDER BY o.confidence DESC, o.created_at DESC
		LIMIT $2
	`, minConf, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var otype, title, hyp string
		var conf float64
		var ev, pc []byte
		var mmsi *int64
		var tname *string
		var created time.Time
		if err := rows.Scan(&id, &otype, &title, &hyp, &conf, &ev, &pc, &mmsi, &tname, &created); err != nil {
			return nil, err
		}
		var evA, pcA []any
		_ = json.Unmarshal(ev, &evA)
		_ = json.Unmarshal(pc, &pcA)
		out = append(out, map[string]any{
			"id": id.String(), "opportunity_type": otype, "title": title, "hypothesis": hyp,
			"confidence": conf, "evidence": evA, "profit_checklist": pcA,
			"mmsi": mmsi, "terminal_name": tname, "created_at": created,
			"disclaimer": "Hypothesis from public data — not a confirmed transaction or listing.",
		})
	}
	return out, rows.Err()
}
