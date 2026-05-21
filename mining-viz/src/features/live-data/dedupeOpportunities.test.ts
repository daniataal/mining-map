import { describe, expect, it } from 'vitest';
import { coerceOpportunityList, dedupeOpportunities } from './dedupeOpportunities';
import { normalizeOilOpportunitiesPayload } from '../../api/oilLiveApi';
import type { OilOpportunity } from '../../api/oilLiveApi';

const opp = (partial: Partial<OilOpportunity> & Pick<OilOpportunity, 'id' | 'opportunity_type'>): OilOpportunity =>
  partial as OilOpportunity;

describe('coerceOpportunityList', () => {
  it('returns arrays unchanged', () => {
    const rows = [opp({ id: '1', opportunity_type: 'x' })];
    expect(coerceOpportunityList(rows)).toEqual(rows);
  });

  it('unwraps { opportunities: [...] }', () => {
    const rows = [opp({ id: '1', opportunity_type: 'x' })];
    expect(coerceOpportunityList({ opportunities: rows })).toEqual(rows);
  });

  it('returns [] for null, object, or non-array opportunities', () => {
    expect(coerceOpportunityList(null)).toEqual([]);
    expect(coerceOpportunityList(undefined)).toEqual([]);
    expect(coerceOpportunityList({ opportunities: {} })).toEqual([]);
    expect(coerceOpportunityList({ error: 'fail' })).toEqual([]);
  });
});

describe('normalizeOilOpportunitiesPayload', () => {
  it('matches API success shape', () => {
    const rows = [opp({ id: 'a', opportunity_type: 'storage' })];
    expect(normalizeOilOpportunitiesPayload({ opportunities: rows })).toEqual(rows);
  });

  it('accepts bare array responses', () => {
    const rows = [opp({ id: 'b', opportunity_type: 'flip' })];
    expect(normalizeOilOpportunitiesPayload(rows)).toEqual(rows);
  });
});

describe('dedupeOpportunities', () => {
  it('does not throw when input is not iterable', () => {
    expect(dedupeOpportunities(null)).toEqual([]);
    expect(dedupeOpportunities({ opportunities: null })).toEqual([]);
  });

  it('keeps highest-confidence duplicate terminal fingerprint', () => {
    const rows = [
      opp({
        id: 'low',
        opportunity_type: 'storage',
        terminal_id: 't1',
        confidence: 0.6,
      }),
      opp({
        id: 'high',
        opportunity_type: 'storage',
        terminal_id: 't1',
        confidence: 0.9,
      }),
    ];
    const out = dedupeOpportunities(rows, 10);
    expect(out.some((o) => o.id === 'high')).toBe(true);
    expect(out.some((o) => o.id === 'low')).toBe(false);
  });

  it('respects maxOut cap', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      opp({
        id: `o${i}`,
        opportunity_type: 'x',
        terminal_id: `t${i}`,
        confidence: 0.9 - i * 0.01,
      }),
    );
    expect(dedupeOpportunities(rows, 5)).toHaveLength(5);
  });
});
