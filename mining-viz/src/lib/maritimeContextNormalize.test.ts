import { describe, expect, it } from 'vitest';
import { normalizeEntityRelationship, normalizeMaritimeContextResponse } from './maritimeContextNormalize';
import type { MaritimeContextResponse } from '../types';

describe('normalizeMaritimeContextResponse', () => {
  it('coerces null array fields to empty arrays', () => {
    const raw = {
      source_labels: null,
      data_as_of: '2026-05-31T00:00:00Z',
      company_links: null,
      nearest_ports: null,
      evidence: null,
      identity: null,
      relationships: null,
      counterparty_proxies: null,
      bol_coverage_note: null,
      limitations: null,
    } as unknown as MaritimeContextResponse;

    const normalized = normalizeMaritimeContextResponse(raw);
    expect(normalized.evidence).toEqual([]);
    expect(normalized.company_links).toEqual([]);
    expect(normalized.nearest_ports).toEqual([]);
    expect(normalized.counterparty_proxies).toEqual([]);
    expect(normalized.limitations).toEqual([]);
    expect(normalized.source_labels).toEqual([]);
    expect(normalized.relationships).toEqual([]);
    expect(normalized.bol_coverage_note).toBe('');
  });

  it('maps snake_case relationships and drops nil targets', () => {
    const raw = {
      source_labels: [],
      data_as_of: '2026-05-31T00:00:00Z',
      company_links: [],
      nearest_ports: [],
      evidence: [],
      relationships: [
        {
          id: 'vessel:9310393:owner:<nil>',
          target_name: '<nil>',
          relationship_type: 'owner',
          source_entity_kind: 'vessel',
          source_entity_ref: '9310393',
        },
        {
          id: 'vessel:9310393:operator:Acme',
          target_name: 'Acme Shipping',
          relationship_type: 'operator',
          source_entity_kind: 'vessel',
          source_entity_ref: '9310393',
        },
      ],
      counterparty_proxies: [],
      bol_coverage_note: '',
      limitations: [],
    } as unknown as MaritimeContextResponse;

    const normalized = normalizeMaritimeContextResponse(raw);
    expect(normalized.relationships).toHaveLength(1);
    expect(normalized.relationships[0].targetName).toBe('Acme Shipping');
    expect(normalized.relationships[0].relationshipType).toBe('operator');
  });
});

describe('normalizeEntityRelationship', () => {
  it('returns null when target name is missing', () => {
    expect(normalizeEntityRelationship({ relationship_type: 'owner' })).toBeNull();
  });
});
