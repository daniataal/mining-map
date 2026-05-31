import type { EntityRelationship, MaritimeContextResponse } from '../types';

function asOptionalString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === '<nil>') return null;
  return s;
}

function asString(value: unknown, fallback = ''): string {
  return asOptionalString(value) ?? fallback;
}

function asOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalize snake_case API rows and drop empty relationship targets. */
export function normalizeEntityRelationship(
  raw: Record<string, unknown>,
): EntityRelationship | null {
  const targetName = asString(raw.targetName ?? raw.target_name);
  if (!targetName) return null;

  return {
    id: asString(raw.id, `rel-${targetName}`),
    sourceEntityKind: asString(raw.sourceEntityKind ?? raw.source_entity_kind, 'unknown'),
    sourceEntityRef: asString(raw.sourceEntityRef ?? raw.source_entity_ref),
    targetEntityKind: asOptionalString(raw.targetEntityKind ?? raw.target_entity_kind),
    targetEntityRef: asOptionalString(raw.targetEntityRef ?? raw.target_entity_ref),
    targetName,
    relationshipType: asString(raw.relationshipType ?? raw.relationship_type, 'unknown'),
    relationshipLabel: asOptionalString(raw.relationshipLabel ?? raw.relationship_label),
    ownershipPct: asOptionalNumber(raw.ownershipPct ?? raw.ownership_pct),
    effectiveDate: asOptionalString(raw.effectiveDate ?? raw.effective_date),
    sourceName: asOptionalString(raw.sourceName ?? raw.source_name),
    sourceUrl: asOptionalString(raw.sourceUrl ?? raw.source_url),
    sourceType: asOptionalString(raw.sourceType ?? raw.source_type),
    confidenceScore: asOptionalNumber(raw.confidenceScore ?? raw.confidence_score),
    rawPayload: (raw.rawPayload ?? raw.raw_payload) as Record<string, unknown> | null | undefined,
    extractedFrom: asOptionalString(raw.extractedFrom ?? raw.extracted_from),
    verifiedAt: asOptionalString(raw.verifiedAt ?? raw.verified_at),
    lastSeenAt: asOptionalString(raw.lastSeenAt ?? raw.last_seen_at),
  };
}

/** Coerce nullable API array fields to [] so drawer sections never crash on null. */
export function normalizeMaritimeContextResponse(
  data: MaritimeContextResponse,
): MaritimeContextResponse {
  const rawRelationships = (data.relationships ?? []) as unknown as Record<string, unknown>[];
  const relationships = rawRelationships
    .map(normalizeEntityRelationship)
    .filter((rel): rel is EntityRelationship => rel != null);

  return {
    ...data,
    source_labels: data.source_labels ?? [],
    company_links: data.company_links ?? [],
    nearest_ports: data.nearest_ports ?? [],
    evidence: data.evidence ?? [],
    relationships,
    counterparty_proxies: data.counterparty_proxies ?? [],
    limitations: data.limitations ?? [],
    bol_coverage_note: data.bol_coverage_note ?? '',
    data_as_of: data.data_as_of ?? '',
  };
}
