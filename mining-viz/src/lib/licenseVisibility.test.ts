import { describe, expect, it } from 'vitest';
import type { MiningLicense } from '../types';
import {
  excludeHiddenFallbackPlaceholders,
  isHiddenFallbackPlaceholder,
  isUnknownLicenseName,
} from './licenseVisibility';

describe('licenseVisibility', () => {
  it('detects unknown placeholder names', () => {
    expect(isUnknownLicenseName('')).toBe(true);
    expect(isUnknownLicenseName('  Unknown  ')).toBe(true);
    expect(isUnknownLicenseName('Unknown License')).toBe(true);
    expect(isUnknownLicenseName('Ghawar Field')).toBe(false);
  });

  it('hides global-fallback-only rows with unknown names', () => {
    const placeholder = {
      id: 'x',
      company: 'Unknown',
      country: 'Global',
      recordOrigin: 'global_open_fallback',
      coverageState: 'global_fallback_only',
    } as MiningLicense;
    const namedFallback = {
      id: 'y',
      company: 'Ghawar Field',
      country: 'Saudi Arabia',
      recordOrigin: 'global_open_fallback',
      coverageState: 'global_fallback_only',
    } as MiningLicense;
    const official = {
      id: 'z',
      company: 'Unknown',
      country: 'Ghana',
      recordOrigin: 'open_data',
    } as MiningLicense;

    expect(isHiddenFallbackPlaceholder(placeholder)).toBe(true);
    expect(isHiddenFallbackPlaceholder(namedFallback)).toBe(false);
    expect(isHiddenFallbackPlaceholder(official)).toBe(false);

    const visible = excludeHiddenFallbackPlaceholders([placeholder, namedFallback, official]);
    expect(visible.map((item) => item.id)).toEqual(['y', 'z']);
  });
});
