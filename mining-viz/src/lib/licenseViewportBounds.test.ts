import { describe, expect, it } from 'vitest';
import {
  intersectLicenseViewportBounds,
  normalizeLicenseViewportBounds,
  quantizeLicenseViewportBounds,
  unionLicenseViewportBounds,
} from './licenseViewportBounds';

describe('intersectLicenseViewportBounds', () => {
  const ghana = { south: 4, west: -4, north: 12, east: 2 };
  const viewport = { south: 5, west: -2, north: 9, east: 0 };

  it('returns overlap of country and viewport boxes', () => {
    expect(intersectLicenseViewportBounds(ghana, viewport)).toEqual({
      south: 5,
      west: -2,
      north: 9,
      east: 0,
    });
  });

  it('returns null for disjoint boxes', () => {
    expect(
      intersectLicenseViewportBounds(
        { south: 0, west: 0, north: 1, east: 1 },
        { south: 10, west: 10, north: 11, east: 11 },
      ),
    ).toBeNull();
  });
});

describe('normalizeLicenseViewportBounds', () => {
  it('expands zero-width longitude span so map API bbox is valid', () => {
    const b = normalizeLicenseViewportBounds({
      south: 5,
      north: 8,
      west: -10,
      east: -10,
    });
    expect(b.east - b.west).toBeGreaterThan(0);
    expect(b.west).toBeLessThan(-10);
    expect(b.east).toBeGreaterThan(-10);
  });
});

describe('unionLicenseViewportBounds', () => {
  it('returns the enclosing box of two viewports', () => {
    expect(
      unionLicenseViewportBounds(
        { south: 7, west: -1, north: 8, east: 0 },
        { south: 5, west: -3, north: 9, east: 1 },
      ),
    ).toEqual({ south: 5, west: -3, north: 9, east: 1 });
  });
});

describe('quantizeLicenseViewportBounds', () => {
  it('normalizes wrapped longitudes before quantizing', () => {
    const q = quantizeLicenseViewportBounds({
      south: 5.01,
      north: 8.99,
      west: -2.01,
      east: 0.99,
    });
    expect(q.south).toBeLessThanOrEqual(5.01);
    expect(q.north).toBeGreaterThanOrEqual(8.99);
    expect(normalizeLicenseViewportBounds(q).west).toBeGreaterThanOrEqual(-180);
  });
});
