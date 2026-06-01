import { describe, expect, it } from 'vitest';
import { countryCentroid, US_IMPORT_HUB } from './countryCentroids';

describe('countryCentroids', () => {
  it('resolves Saudi Arabia', () => {
    const c = countryCentroid('SAUDI ARABIA');
    expect(c?.lat).toBeGreaterThan(0);
    expect(c?.lng).toBeDefined();
  });

  it('exposes US Gulf import hub', () => {
    expect(US_IMPORT_HUB.lat).toBeCloseTo(29.76, 1);
    expect(US_IMPORT_HUB.lng).toBeLessThan(0);
  });
});
