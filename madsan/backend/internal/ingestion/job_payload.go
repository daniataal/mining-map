package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

func (s *Service) loadJobPayload(ctx context.Context, jobID uuid.UUID) map[string]any {
	var raw []byte
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(payload, '{}'::jsonb) FROM ingestion_jobs WHERE id = $1
	`, jobID).Scan(&raw)
	if err != nil {
		return map[string]any{}
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return map[string]any{}
	}
	return m
}

func payloadString(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	default:
		return strings.TrimSpace(fmt.Sprint(x))
	}
}

func payloadBool(m map[string]any, key string) bool {
	v, ok := m[key]
	if !ok || v == nil {
		return false
	}
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return x == "true" || x == "1"
	default:
		return false
	}
}

// EnqueueEntityEnrichmentRefresh queues a targeted vessel or asset enrichment job.
func (s *Service) EnqueueEntityEnrichmentRefresh(ctx context.Context, entityType, entityID string, payload map[string]any) (uuid.UUID, error) {
	entityType = strings.TrimSpace(entityType)
	entityID = strings.TrimSpace(entityID)
	if payload == nil {
		payload = map[string]any{}
	}
	payload["force"] = true

	var jobType string
	switch entityType {
	case "vessel":
		jobType = vesselEnrichmentJobType
		payload["entity_id"] = entityID
	case "asset":
		jobType = "terminal_enrichment"
		payload["asset_id"] = entityID
	default:
		return uuid.Nil, fmt.Errorf("unsupported entity type %q", entityType)
	}
	sourceSlug := fmt.Sprintf("refresh_%s_%s", entityType, entityID)
	id, err := s.EnqueueDeduped(ctx, jobType, sourceSlug, payload)
	if err == ErrJobAlreadyQueued {
		return id, nil
	}
	return id, err
}
