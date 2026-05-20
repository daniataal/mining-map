package alerts

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mining-map/oil-live-intel/internal/broadcast"
	"github.com/mining-map/oil-live-intel/internal/config"
)

type Alert struct {
	ID        string         `json:"id"`
	UserID    string         `json:"user_id"`
	AlertType string         `json:"alert_type"`
	Title     string         `json:"title"`
	Body      string         `json:"body,omitempty"`
	Severity  string         `json:"severity"`
	RefType   string         `json:"ref_type,omitempty"`
	RefID     string         `json:"ref_id,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
	ReadAt    *string        `json:"read_at,omitempty"`
	CreatedAt string         `json:"created_at,omitempty"`
	AssignedTo string        `json:"assigned_to,omitempty"`
	Status    string         `json:"status,omitempty"`
}

type watchRow struct {
	id, userID, watchType, watchRef string
	minConf                         float64
}

// ScanRecent matches new opportunities and intelligence cards against watchlists.
func ScanRecent(ctx context.Context, pool *pgxpool.Pool, cfg config.Config) (int, error) {
	watches, err := loadWatches(ctx, pool)
	if err != nil {
		return 0, err
	}
	if len(watches) == 0 {
		return 0, nil
	}
	n := 0
	c, err := matchOpportunities(ctx, pool, cfg, watches)
	n += c
	if err != nil {
		return n, err
	}
	c, err = matchIntelligence(ctx, pool, cfg, watches)
	return n + c, err
}

func loadWatches(ctx context.Context, pool *pgxpool.Pool) ([]watchRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text, user_id, watch_type, watch_ref, min_confidence FROM oil_watchlists
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []watchRow
	for rows.Next() {
		var w watchRow
		if err := rows.Scan(&w.id, &w.userID, &w.watchType, &w.watchRef, &w.minConf); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func matchOpportunities(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, watches []watchRow) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT o.id::text, o.opportunity_type, o.title, o.hypothesis, o.confidence, o.mmsi,
			o.terminal_id::text, t.name
		FROM oil_opportunities o
		LEFT JOIN oil_terminals t ON t.id = o.terminal_id
		WHERE o.status='open' AND o.created_at > now() - interval '2 hours'
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id, otype, title, hyp string
		var conf float64
		var mmsi *int64
		var tid, tname *string
		if err := rows.Scan(&id, &otype, &title, &hyp, &conf, &mmsi, &tid, &tname); err != nil {
			return n, err
		}
		vals := map[string]string{
			"terminal": deref(tid), "mmsi": fmtMMSI(mmsi), "opportunity_type": otype,
		}
		body := hyp
		if tname != nil {
			body = fmt.Sprintf("%s @ %s", hyp, *tname)
		}
		for _, w := range watches {
			if conf < w.minConf || !matchesWatch(w.watchType, w.watchRef, vals) {
				continue
			}
			if fired, a, err := insertAlert(ctx, pool, w.id, w.userID, "opportunity", "opportunity", id, title, body, "info", map[string]any{
				"opportunity_id": id, "confidence": conf, "terminal_name": tname,
			}); err != nil {
				return n, err
			} else if fired {
				n++
				broadcast.Post(cfg, "oil_alert", a)
			}
		}
	}
	return n, rows.Err()
}

func matchIntelligence(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, watches []watchRow) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.id::text, c.title, c.summary, c.confidence, c.event_type, c.product_family_inferred,
			c.terminal_id::text
		FROM oil_intelligence_cards c
		WHERE c.created_at > now() - interval '2 hours'
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id, title, summary, event, product string
		var conf float64
		var tid *string
		if err := rows.Scan(&id, &title, &summary, &conf, &event, &product, &tid); err != nil {
			return n, err
		}
		vals := map[string]string{
			"terminal": deref(tid), "product_family": product, "opportunity_type": event,
		}
		for _, w := range watches {
			if conf < w.minConf || !matchesWatch(w.watchType, w.watchRef, vals) {
				continue
			}
			if fired, a, err := insertAlert(ctx, pool, w.id, w.userID, "intelligence", "intelligence_card", id, title, summary, "info", map[string]any{
				"card_id": id, "confidence": conf, "event_type": event,
			}); err != nil {
				return n, err
			} else if fired {
				n++
				broadcast.Post(cfg, "oil_alert", a)
			}
		}
	}
	return n, rows.Err()
}

func matchesWatch(wtype, wref string, vals map[string]string) bool {
	v, ok := vals[wtype]
	return ok && v != "" && v == wref
}

func insertAlert(
	ctx context.Context, pool *pgxpool.Pool,
	watchID, userID, alertType, refType, refID, title, body, severity string,
	payload map[string]any,
) (bool, map[string]any, error) {
	var exists int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM oil_alerts
		WHERE watchlist_id::text = $1 AND ref_type = $2 AND ref_id = $3
	`, watchID, refType, refID).Scan(&exists)
	if exists > 0 {
		return false, nil, nil
	}
	pb, _ := json.Marshal(payload)
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO oil_alerts (watchlist_id, user_id, alert_type, ref_type, ref_id, title, body, severity, payload)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`, watchID, userID, alertType, refType, refID, title, body, severity, pb).Scan(&id)
	if err != nil {
		return false, nil, err
	}
	return true, map[string]any{
		"id": id.String(), "user_id": userID, "alert_type": alertType,
		"title": title, "body": body, "severity": severity,
		"ref_type": refType, "ref_id": refID, "payload": payload,
	}, nil
}

func List(ctx context.Context, pool *pgxpool.Pool, userID string, unreadOnly bool, limit int) ([]Alert, error) {
	if userID == "" {
		userID = "default"
	}
	if limit <= 0 {
		limit = 50
	}
	q := `
		SELECT id::text, user_id, alert_type, title, COALESCE(body,''), severity,
			COALESCE(ref_type,''), COALESCE(ref_id,''), payload, read_at::text, created_at::text,
			COALESCE(assigned_to,''), COALESCE(status,'open')
		FROM oil_alerts WHERE user_id = $1
	`
	if unreadOnly {
		q += ` AND read_at IS NULL`
	}
	q += ` ORDER BY created_at DESC LIMIT $2`
	rows, err := pool.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		var a Alert
		var payload []byte
		var readAt *string
		if err := rows.Scan(&a.ID, &a.UserID, &a.AlertType, &a.Title, &a.Body, &a.Severity,
			&a.RefType, &a.RefID, &payload, &readAt, &a.CreatedAt, &a.AssignedTo, &a.Status); err != nil {
			return nil, err
		}
		a.ReadAt = readAt
		if len(payload) > 0 {
			_ = json.Unmarshal(payload, &a.Payload)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func MarkRead(ctx context.Context, pool *pgxpool.Pool, userID, alertID string) error {
	if userID == "" {
		userID = "default"
	}
	_, err := pool.Exec(ctx, `
		UPDATE oil_alerts SET read_at = now(), status = 'acknowledged'
		WHERE id::text = $1 AND user_id = $2
	`, alertID, userID)
	return err
}

func MarkAllRead(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, error) {
	if userID == "" {
		userID = "default"
	}
	res, err := pool.Exec(ctx, `
		UPDATE oil_alerts SET read_at = now(), status = 'acknowledged'
		WHERE user_id = $1 AND read_at IS NULL
	`, userID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected(), nil
}

func Assign(ctx context.Context, pool *pgxpool.Pool, userID, alertID, assignee string) error {
	if userID == "" {
		userID = "default"
	}
	_, err := pool.Exec(ctx, `
		UPDATE oil_alerts SET assigned_to = $3, status = 'assigned'
		WHERE id::text = $1 AND user_id = $2
	`, alertID, userID, assignee)
	return err
}

func fmtMMSI(m *int64) string {
	if m == nil {
		return ""
	}
	return fmt.Sprintf("%d", *m)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
