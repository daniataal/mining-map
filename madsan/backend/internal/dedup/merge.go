package dedup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrQueueNotFound     = errors.New("review queue item not found")
	ErrQueueNotPending   = errors.New("review queue item is not pending")
	ErrInvalidAction     = errors.New("action must be merge or dismiss")
	ErrMissingCanonical  = errors.New("canonical_company_id required for merge")
	ErrInvalidCanonical  = errors.New("canonical_company_id must be a cluster member")
	ErrUnsupportedReason = errors.New("unsupported review reason for merge")
)

type MergeResult struct {
	CanonicalID   string   `json:"canonical_company_id"`
	MergedIDs     []string `json:"merged_company_ids"`
	AssetsUpdated int      `json:"assets_updated"`
	ContactsMoved int      `json:"contacts_moved"`
	Relationships int      `json:"relationships_updated"`
	EvidenceMoved int      `json:"evidence_moved"`
}

type ResolveInput struct {
	Action             string
	CanonicalCompanyID string
}

// MergeCompanies repoints FKs and polymorphic refs from duplicates into canonical, then deletes duplicates.
func MergeCompanies(ctx context.Context, pool *pgxpool.Pool, canonicalID uuid.UUID, duplicateIDs []uuid.UUID) (MergeResult, error) {
	result := MergeResult{CanonicalID: canonicalID.String()}
	if len(duplicateIDs) == 0 {
		return result, nil
	}
	dupStrs := make([]string, len(duplicateIDs))
	for i, id := range duplicateIDs {
		dupStrs[i] = id.String()
	}
	result.MergedIDs = dupStrs

	tx, err := pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE assets SET operator_company_id = $1, updated_at = now()
		WHERE operator_company_id = ANY($2)
	`, canonicalID, duplicateIDs)
	if err != nil {
		return result, err
	}
	result.AssetsUpdated += int(tag.RowsAffected())

	tag, err = tx.Exec(ctx, `
		UPDATE assets SET owner_company_id = $1, updated_at = now()
		WHERE owner_company_id = ANY($2)
	`, canonicalID, duplicateIDs)
	if err != nil {
		return result, err
	}
	result.AssetsUpdated += int(tag.RowsAffected())

	tag, err = tx.Exec(ctx, `
		UPDATE contacts SET company_id = $1, updated_at = now()
		WHERE company_id = ANY($2)
	`, canonicalID, duplicateIDs)
	if err != nil {
		return result, err
	}
	result.ContactsMoved = int(tag.RowsAffected())

	if err := repointCompanyRelationships(ctx, tx, canonicalID, duplicateIDs, &result); err != nil {
		return result, err
	}
	if err := repointCompanyEvidence(ctx, tx, canonicalID, duplicateIDs, &result); err != nil {
		return result, err
	}

	for _, table := range []string{"risk_flags", "core_signals", "documents", "feedback_events"} {
		tag, err = tx.Exec(ctx, fmt.Sprintf(`
			UPDATE %s SET entity_id = $1
			WHERE entity_type = 'company' AND entity_id = ANY($2)
		`, table), canonicalID, duplicateIDs)
		if err != nil {
			return result, err
		}
	}

	// Merge duplicate names into canonical aliases.
	_, err = tx.Exec(ctx, `
		UPDATE companies c SET
			aliases = (
				SELECT ARRAY(
					SELECT DISTINCT unnest(COALESCE(c.aliases, '{}') || COALESCE(array_agg(d.name), '{}'))
				)
			),
			updated_at = now()
		FROM companies d
		WHERE c.id = $1 AND d.id = ANY($2)
	`, canonicalID, duplicateIDs)
	if err != nil {
		return result, err
	}

	tag, err = tx.Exec(ctx, `DELETE FROM companies WHERE id = ANY($1)`, duplicateIDs)
	if err != nil {
		return result, err
	}
	if int(tag.RowsAffected()) != len(duplicateIDs) {
		return result, fmt.Errorf("expected to delete %d companies, deleted %d", len(duplicateIDs), tag.RowsAffected())
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func repointCompanyRelationships(ctx context.Context, tx pgx.Tx, canonicalID uuid.UUID, duplicateIDs []uuid.UUID, result *MergeResult) error {
	_, err := tx.Exec(ctx, `
		DELETE FROM relationships r_dup
		WHERE r_dup.from_entity_type = 'company' AND r_dup.from_entity_id = ANY($2)
		  AND EXISTS (
		    SELECT 1 FROM relationships r_can
		    WHERE r_can.from_entity_type = 'company' AND r_can.from_entity_id = $1
		      AND r_can.to_entity_type = r_dup.to_entity_type
		      AND r_can.to_entity_id = r_dup.to_entity_id
		      AND r_can.relationship_type = r_dup.relationship_type
		  )
	`, canonicalID, duplicateIDs)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		DELETE FROM relationships r_dup
		WHERE r_dup.to_entity_type = 'company' AND r_dup.to_entity_id = ANY($2)
		  AND EXISTS (
		    SELECT 1 FROM relationships r_can
		    WHERE r_can.to_entity_type = 'company' AND r_can.to_entity_id = $1
		      AND r_can.from_entity_type = r_dup.from_entity_type
		      AND r_can.from_entity_id = r_dup.from_entity_id
		      AND r_can.relationship_type = r_dup.relationship_type
		  )
	`, canonicalID, duplicateIDs)
	if err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
		UPDATE relationships SET from_entity_id = $1
		WHERE from_entity_type = 'company' AND from_entity_id = ANY($2)
	`, canonicalID, duplicateIDs)
	if err != nil {
		return err
	}
	result.Relationships += int(tag.RowsAffected())

	tag, err = tx.Exec(ctx, `
		UPDATE relationships SET to_entity_id = $1
		WHERE to_entity_type = 'company' AND to_entity_id = ANY($2)
	`, canonicalID, duplicateIDs)
	if err != nil {
		return err
	}
	result.Relationships += int(tag.RowsAffected())

	_, err = tx.Exec(ctx, `
		DELETE FROM relationships
		WHERE from_entity_type = 'company' AND to_entity_type = 'company'
		  AND from_entity_id = to_entity_id
	`)
	return err
}

func repointCompanyEvidence(ctx context.Context, tx pgx.Tx, canonicalID uuid.UUID, duplicateIDs []uuid.UUID, result *MergeResult) error {
	_, err := tx.Exec(ctx, `
		DELETE FROM evidence e_dup
		WHERE e_dup.entity_type = 'company' AND e_dup.entity_id = ANY($2)
		  AND EXISTS (
		    SELECT 1 FROM evidence e_can
		    WHERE e_can.entity_type = 'company' AND e_can.entity_id = $1
		      AND e_can.source_id = e_dup.source_id
		      AND e_can.claim_type = e_dup.claim_type
		  )
	`, canonicalID, duplicateIDs)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE evidence SET entity_id = $1
		WHERE entity_type = 'company' AND entity_id = ANY($2)
	`, canonicalID, duplicateIDs)
	if err != nil {
		return err
	}
	result.EvidenceMoved = int(tag.RowsAffected())
	return nil
}

type queueItem struct {
	ID         uuid.UUID
	Reason     string
	Status     string
	RawPayload []byte
}

// ResolveReviewQueue applies merge or dismiss to a pending manual_review_queue row.
func ResolveReviewQueue(ctx context.Context, pool *pgxpool.Pool, queueID uuid.UUID, in ResolveInput) (any, error) {
	switch in.Action {
	case "merge", "dismiss":
	default:
		return nil, ErrInvalidAction
	}

	var item queueItem
	err := pool.QueryRow(ctx, `
		SELECT id, reason, status, COALESCE(raw_payload, '{}')
		FROM manual_review_queue WHERE id = $1
	`, queueID).Scan(&item.ID, &item.Reason, &item.Status, &item.RawPayload)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrQueueNotFound
		}
		return nil, err
	}
	if item.Status != "pending" {
		return nil, ErrQueueNotPending
	}

	if in.Action == "dismiss" {
		return dismissQueueItem(ctx, pool, queueID)
	}

	if !IsMergeReviewReason(item.Reason) {
		return nil, ErrUnsupportedReason
	}
	if in.CanonicalCompanyID == "" {
		return nil, ErrMissingCanonical
	}
	canonicalID, err := uuid.Parse(in.CanonicalCompanyID)
	if err != nil {
		return nil, ErrInvalidCanonical
	}

	memberIDs, err := memberIDsFromPayload(item.RawPayload)
	if err != nil {
		return nil, err
	}
	if !containsUUID(memberIDs, canonicalID) {
		return nil, ErrInvalidCanonical
	}

	var duplicateIDs []uuid.UUID
	for _, id := range memberIDs {
		if id != canonicalID {
			duplicateIDs = append(duplicateIDs, id)
		}
	}

	mergeResult, err := MergeCompanies(ctx, pool, canonicalID, duplicateIDs)
	if err != nil {
		return nil, err
	}

	resolution, _ := json.Marshal(map[string]any{
		"action":               "merge",
		"canonical_company_id": canonicalID.String(),
		"merged_company_ids":   mergeResult.MergedIDs,
		"stats":                mergeResult,
	})
	_, err = pool.Exec(ctx, `
		UPDATE manual_review_queue
		SET status = 'resolved', reviewed_at = now(),
		    raw_payload = COALESCE(raw_payload, '{}') || jsonb_build_object('resolution', $2::jsonb)
		WHERE id = $1
	`, queueID, resolution)
	if err != nil {
		return nil, err
	}

	// Dismiss other pending duplicate_company rows for the same normalized_name cluster.
	var normName string
	var payload map[string]any
	if json.Unmarshal(item.RawPayload, &payload) == nil {
		if v, ok := payload["normalized_name"].(string); ok {
			normName = v
		}
	}
	if normName != "" {
		_, _ = pool.Exec(ctx, `
			UPDATE manual_review_queue
			SET status = 'resolved', reviewed_at = now(),
			    raw_payload = COALESCE(raw_payload, '{}') || '{"resolution":{"action":"superseded"}}'::jsonb
			WHERE status = 'pending'
			  AND (reason = 'duplicate_company' OR reason = 'dedup_merge')
			  AND id != $1 AND raw_payload->>'normalized_name' = $2
		`, queueID, normName)
	}

	return map[string]any{"status": "resolved", "action": "merge", "merge": mergeResult}, nil
}

func dismissQueueItem(ctx context.Context, pool *pgxpool.Pool, queueID uuid.UUID) (any, error) {
	resolution, _ := json.Marshal(map[string]string{"action": "dismiss"})
	_, err := pool.Exec(ctx, `
		UPDATE manual_review_queue
		SET status = 'dismissed', reviewed_at = now(),
		    raw_payload = COALESCE(raw_payload, '{}') || jsonb_build_object('resolution', $2::jsonb)
		WHERE id = $1
	`, queueID, resolution)
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": "dismissed", "action": "dismiss"}, nil
}

func memberIDsFromPayload(raw []byte) ([]uuid.UUID, error) {
	var payload struct {
		Members []CompanyMember `json:"members"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("invalid queue payload: %w", err)
	}
	if len(payload.Members) < 2 {
		return nil, fmt.Errorf("cluster must have at least 2 members")
	}
	out := make([]uuid.UUID, 0, len(payload.Members))
	for _, m := range payload.Members {
		id, err := uuid.Parse(m.ID)
		if err != nil {
			return nil, fmt.Errorf("invalid member id %q: %w", m.ID, err)
		}
		out = append(out, id)
	}
	return out, nil
}

func containsUUID(ids []uuid.UUID, target uuid.UUID) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}
