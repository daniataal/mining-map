import { describe, expect, it } from 'vitest';
import { isGhanaCountry, isGhanaGoldEntity, isGoldCommodity } from './goldbodEligibility';

describe('goldbodEligibility', () => {
  it('detects Ghana', () => {
    expect(isGhanaCountry('Ghana')).toBe(true);
    expect(isGhanaCountry('GH')).toBe(true);
    expect(isGhanaCountry('Peru')).toBe(false);
  });

  it('detects gold commodities', () => {
    expect(isGoldCommodity('Gold')).toBe(true);
    expect(isGoldCommodity('gold concentrate')).toBe(true);
    expect(isGoldCommodity('Bauxite')).toBe(false);
  });

  it('scopes Ghana gold entities', () => {
    expect(isGhanaGoldEntity('Ghana', 'Gold')).toBe(true);
    expect(isGhanaGoldEntity('Ghana', 'Bauxite')).toBe(false);
    expect(isGhanaGoldEntity('Chile', 'Gold')).toBe(false);
  });
});
