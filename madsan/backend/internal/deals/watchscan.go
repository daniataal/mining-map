package deals

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/madsan/intelligence/internal/markets"
)

const changeEventDedupeWindow = 6 * time.Hour

// ScanReport summarizes one deal-watch scan run.
type ScanReport struct {
	Subscriptions int `json:"subscriptions_scanned"`
	EventsInserted int `json:"events_inserted"`
	Skipped       int `json:"skipped_no_snapshot"`
	Errors        int `json:"errors"`
}

// ScanAllWatchSubscriptions diffs every active watch baseline and persists new change events.
func (s *Service) ScanAllWatchSubscriptions(ctx context.Context) (ScanReport, error) {
	report := ScanReport{}
	rows, err := s.pool.Query(ctx, `
		SELECT deal_id, user_id, last_snapshot
		FROM deal_watch_subscriptions
		WHERE last_snapshot IS NOT NULL
	`)
	if err != nil {
		return report, err
	}
	defer rows.Close()

	now := time.Now().UTC()
	for rows.Next() {
		var dealID, userID uuid.UUID
		var snapJSON []byte
		if err := rows.Scan(&dealID, &userID, &snapJSON); err != nil {
			report.Errors++
			continue
		}
		if len(snapJSON) == 0 {
			report.Skipped++
			continue
		}
		var snap watchSnapshot
		if err := json.Unmarshal(snapJSON, &snap); err != nil {
			report.Errors++
			continue
		}
		items := s.computeChangeItems(ctx, snap, now)
		inserted, err := s.persistChangeEvents(ctx, dealID, userID, items)
		if err != nil {
			report.Errors++
			continue
		}
		report.Subscriptions++
		report.EventsInserted += inserted
		_, _ = s.pool.Exec(ctx, `
			UPDATE deal_watch_subscriptions SET last_scanned_at = $3
			WHERE deal_id = $1 AND user_id = $2
		`, dealID, userID, now)
	}
	return report, rows.Err()
}

// ScanWatchSubscription runs change detection for one deal/user watch and persists events.
func (s *Service) ScanWatchSubscription(ctx context.Context, dealID, userID uuid.UUID) (int, error) {
	var snapJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT last_snapshot FROM deal_watch_subscriptions
		WHERE deal_id = $1 AND user_id = $2
	`, dealID, userID).Scan(&snapJSON)
	if err == pgx.ErrNoRows || len(snapJSON) == 0 {
		return 0, err
	}
	if err != nil {
		return 0, err
	}
	var snap watchSnapshot
	if err := json.Unmarshal(snapJSON, &snap); err != nil {
		return 0, err
	}
	now := time.Now().UTC()
	items := s.computeChangeItems(ctx, snap, now)
	inserted, err := s.persistChangeEvents(ctx, dealID, userID, items)
	if err != nil {
		return 0, err
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE deal_watch_subscriptions SET last_scanned_at = $3
		WHERE deal_id = $1 AND user_id = $2
	`, dealID, userID, now)
	return inserted, nil
}

func (s *Service) computeChangeItems(ctx context.Context, snap watchSnapshot, now time.Time) []ChangeItem {
	ticker := markets.NewHandler(s.eiaKey)
	return []ChangeItem{
		detectBenchmarkPriceDelta(snap, ticker, now),
		detectSanctionsRescreen(ctx, s.screener, snap, now),
		detectVesselLastSeenStale(ctx, s.pool, snap, now),
	}
}

func (s *Service) persistChangeEvents(ctx context.Context, dealID, userID uuid.UUID, items []ChangeItem) (int, error) {
	inserted := 0
	for _, item := range items {
		ok, err := s.insertChangeEvent(ctx, dealID, userID, item)
		if err != nil {
			return inserted, err
		}
		if ok {
			inserted++
		}
	}
	return inserted, nil
}

func (s *Service) insertChangeEvent(ctx context.Context, dealID, userID uuid.UUID, item ChangeItem) (bool, error) {
	detectedAt := time.Now().UTC()
	if item.DetectedAt != "" {
		if t, err := time.Parse(time.RFC3339, item.DetectedAt); err == nil {
			detectedAt = t.UTC()
		}
	}
	var recent bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM deal_change_events
			WHERE deal_id = $1 AND user_id = $2
			  AND change_type = $3
			  AND COALESCE(field, '') = COALESCE($4, '')
			  AND COALESCE(new_value, '') = COALESCE($5, '')
			  AND detected_at > $6
		)
	`, dealID, userID, item.Type, item.Field, item.NewValue, detectedAt.Add(-changeEventDedupeWindow)).Scan(&recent)
	if err != nil {
		return false, err
	}
	if recent {
		return false, nil
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO deal_change_events (
			deal_id, user_id, change_type, field, old_value, new_value,
			delta_pct, tier, source, message, detected_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, dealID, userID, item.Type, nullStr(item.Field), nullStr(item.OldValue), nullStr(item.NewValue),
		item.DeltaPct, item.Tier, nullStr(item.Source), nullStr(item.Message), detectedAt)
	return err == nil, err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Service) loadChangeEvents(ctx context.Context, dealID, userID uuid.UUID, limit int) ([]ChangeItem, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT change_type, COALESCE(field,''), COALESCE(old_value,''), COALESCE(new_value,''),
		       delta_pct, tier, COALESCE(source,''), COALESCE(message,''), detected_at
		FROM deal_change_events
		WHERE deal_id = $1 AND user_id = $2
		ORDER BY detected_at DESC
		LIMIT $3
	`, dealID, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChangeItem
	for rows.Next() {
		var item ChangeItem
		var field, oldVal, newVal, source, message string
		var delta *float64
		var detectedAt time.Time
		if err := rows.Scan(&item.Type, &field, &oldVal, &newVal, &delta, &item.Tier, &source, &message, &detectedAt); err != nil {
			continue
		}
		item.Field = field
		item.OldValue = oldVal
		item.NewValue = newVal
		item.Source = source
		item.Message = message
		item.DeltaPct = delta
		item.DetectedAt = detectedAt.UTC().Format(time.RFC3339)
		out = append(out, item)
	}
	return out, rows.Err()
}

func scanReportString(r ScanReport) string {
	return fmt.Sprintf("scanned=%d inserted=%d skipped=%d errors=%d",
		r.Subscriptions, r.EventsInserted, r.Skipped, r.Errors)
}
