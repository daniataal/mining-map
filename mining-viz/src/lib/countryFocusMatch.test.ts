import { describe, expect, it } from 'vitest';
import {
  resolveCountryFocusToken,
  suggestCountriesForFocus,
  tryParseCountryColonQuery,
  matchExactCountryFocusQuery,
} from './countryFocusMatch';

describe('tryParseCountryColonQuery', () => {
  it('extracts payload after country:', () => {
    expect(tryParseCountryColonQuery('country:UAE')).toBe('UAE');
    expect(tryParseCountryColonQuery('  COUNTRY:  United Arab Emirates  ')).toBe('United Arab Emirates');
  });

  it('returns null when not a country-prefixed query', () => {
    expect(tryParseCountryColonQuery('Acme Mining')).toBeNull();
    expect(tryParseCountryColonQuery('country:')).toBeNull();
  });
});

describe('resolveCountryFocusToken', () => {
  it('resolves aliases', () => {
    expect(resolveCountryFocusToken('UAE', [])).toBe('United Arab Emirates');
    expect(resolveCountryFocusToken('usa', [])).toBe('United States of America');
    expect(resolveCountryFocusToken('UK', [])).toBe('United Kingdom');
  });

  it('resolves exact list names case-insensitively', () => {
    expect(resolveCountryFocusToken('canada', [])).toBe('Canada');
    expect(resolveCountryFocusToken('UNITED ARAB EMIRATES', [])).toBe('United Arab Emirates');
  });

  it('prefers data spelling when exact key matches', () => {
    expect(resolveCountryFocusToken('Testland', ['Testland'])).toBe('Testland');
  });

  it('returns null when ambiguous prefix', () => {
    expect(resolveCountryFocusToken('Uni', [])).toBeNull();
  });
});

describe('matchExactCountryFocusQuery', () => {
  it('returns canonical name only when query equals resolved name', () => {
    expect(matchExactCountryFocusQuery('Canada', [])).toBe('Canada');
    expect(matchExactCountryFocusQuery('canada', [])).toBe('Canada');
    expect(matchExactCountryFocusQuery('Canad', [])).toBeNull();
  });
});

describe('suggestCountriesForFocus', () => {
  it('returns empty for very short query', () => {
    expect(suggestCountriesForFocus('u', [])).toEqual([]);
  });

  it('ranks prefix and substring matches', () => {
    const s = suggestCountriesForFocus('unit', []);
    expect(s.some((n) => n.includes('United'))).toBe(true);
    expect(s[0]?.toLowerCase().startsWith('unit')).toBe(true);
  });
});
