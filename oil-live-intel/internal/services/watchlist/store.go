package watchlist

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Item struct {
	ID            string  `json:"id"`
	UserID        string  `json:"user_id"`
	WatchType     string  `json:"watch_type"`
	WatchRef      string  `json:"watch_ref"`
	Label         string  `json:"label,omitempty"`
	MinConfidence float64 `json:"min_confidence"`
	CreatedAt     string  `json:"created_at,omitempty"`
}

var allowedTypes = map[string]bool{
	"terminal": true, "mmsi": true, "company": true,
	"opportunity_type": true, "product_family": true,
}

func List(ctx context.Context, pool *pgxpool.Pool, userID string) ([]Item, error) {
	if userID == "" {
		userID = "default"
	}
	rows, err := pool.Query(ctx, `
		SELECT id::text, user_id, watch_type, watch_ref, COALESCE(label,''), min_confidence, created_at::text
		FROM oil_watchlists WHERE user_id = $1 ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Item
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.UserID, &it.WatchType, &it.WatchRef, &it.Label, &it.MinConfidence, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func Add(ctx context.Context, pool *pgxpool.Pool, userID, watchType, watchRef, label string, minConf float64) (Item, error) {
	if userID == "" {
		userID = "default"
	}
	if !allowedTypes[watchType] {
		return Item{}, fmt.Errorf("invalid watch_type")
	}
	if watchRef == "" {
		return Item{}, fmt.Errorf("watch_ref required")
	}
	if minConf <= 0 {
		minConf = 0.6
	}
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO oil_watchlists (user_id, watch_type, watch_ref, label, min_confidence)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id, watch_type, watch_ref) DO UPDATE SET
			label = COALESCE(NULLIF(EXCLUDED.label,''), oil_watchlists.label),
			min_confidence = EXCLUDED.min_confidence
		RETURNING id
	`, userID, watchType, watchRef, label, minConf).Scan(&id)
	if err != nil {
		return Item{}, err
	}
	items, err := List(ctx, pool, userID)
	if err != nil {
		return Item{ID: id.String(), UserID: userID, WatchType: watchType, WatchRef: watchRef, Label: label, MinConfidence: minConf}, nil
	}
	for _, it := range items {
		if it.ID == id.String() {
			return it, nil
		}
	}
	return Item{ID: id.String(), UserID: userID, WatchType: watchType, WatchRef: watchRef, Label: label, MinConfidence: minConf}, nil
}

func Remove(ctx context.Context, pool *pgxpool.Pool, userID, id string) error {
	if userID == "" {
		userID = "default"
	}
	res, err := pool.Exec(ctx, `DELETE FROM oil_watchlists WHERE id::text=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("watchlist not found")
	}
	return nil
}
