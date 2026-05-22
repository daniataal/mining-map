import { describe, expect, it } from 'vitest';
import { normalizeLicenseViewportBounds, wrapLongitude } from './licenseViewportBounds';

describe('normalizeLicenseViewportBounds', () => {
  it('wraps multi-world longitudes from Leaflet', () => {
    const b = normalizeLicenseViewportBounds({
      south: -89.75,
      west: -1254.25,
      north: 90,
      east: 500.75,
    });
    expect(b.west).toBeGreaterThanOrEqual(-180);
    expect(b.west).toBeLessThanOrEqual(180);
    expect(b.east).toBeGreaterThanOrEqual(-180);
    expect(b.east).toBeLessThanOrEqual(180);
    expect(b.east - b.west).toBeLessThanOrEqual(360);
  });

  it('rejects -1254 as min_lng after normalization', () => {
    const b = normalizeLicenseViewportBounds({
      south: 10,
      west: -1254.25,
      north: 20,
      east: -1250,
    });
    expect(b.west).not.toBe(-1254.25);
    expect(wrapLongitude(-1254.25)).toBeGreaterThanOrEqual(-180);
    expect(wrapLongitude(-1254.25)).toBeLessThanOrEqual(180);
  });
});
