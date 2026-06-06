import { describe, expect, it } from 'vitest';
import {
  buildSanctionsLookup,
  normalizeSanctionsCountryKey,
  sanctionsChoroplethStyle,
  sanctionsCountryKeysMatch,
  sanctionsFlagLevelForCountry,
} from './sanctionsCountryLayer';

const screenedRow = (
  country_name: string,
  flag_level: 'clear' | 'review' | 'flagged',
  match_count: number,
) => ({
  country_name,
  coverage: 'screened' as const,
  flag_level,
  match_count,
  screened_entity_count: 3,
  flagged_count: flag_level === 'flagged' ? match_count : 0,
  review_count: flag_level === 'review' ? match_count : 0,
  clear_count: flag_level === 'clear' ? 3 : 0,
  source_tier: 'opensanctions_screening',
  fetched_at: '2026-01-01T00:00:00Z',
});

describe('sanctionsCountryLayer', () => {
  it('normalizes country keys with aliases', () => {
    expect(normalizeSanctionsCountryKey("Côte d'Ivoire")).toBe('cote d ivoire');
    expect(normalizeSanctionsCountryKey('  USA  ')).toBe('united states of america');
    expect(normalizeSanctionsCountryKey('Russian Federation')).toBe('russian federation');
    expect(normalizeSanctionsCountryKey('Russia')).toBe('russian federation');
  });

  it('matches border names to stored country rows', () => {
    const lookup = buildSanctionsLookup([screenedRow('Russia', 'flagged', 2)]);
    expect(sanctionsFlagLevelForCountry(lookup, 'Russian Federation')?.flag_level).toBe('flagged');
    expect(sanctionsFlagLevelForCountry(lookup, 'Russia')?.flag_level).toBe('flagged');
    expect(sanctionsCountryKeysMatch('US', 'United States of America')).toBe(true);
    expect(sanctionsFlagLevelForCountry(lookup, 'Brazil')).toBeUndefined();
  });

  it('returns null choropleth style for no_data / unknown countries', () => {
    expect(sanctionsChoroplethStyle(undefined, false)).toBeNull();
    expect(
      sanctionsChoroplethStyle(
        {
          country_name: 'Narnia',
          coverage: 'no_data',
          match_count: 0,
          screened_entity_count: 0,
          flagged_count: 0,
          review_count: 0,
          clear_count: 0,
          source_tier: 'opensanctions_screening',
          fetched_at: '2026-01-01T00:00:00Z',
        },
        false,
      ),
    ).toBeNull();
  });

  it('styles screened clear separately from unknown', () => {
    const style = sanctionsChoroplethStyle(screenedRow('Chile', 'clear', 0), true);
    expect(style).not.toBeNull();
    expect(style?.fillColor).toBe('#94a3b8');
  });
});
