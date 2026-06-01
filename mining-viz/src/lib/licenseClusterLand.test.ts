import { describe, expect, it } from 'vitest';
import { countryLandBBox, refineClusterLandPosition } from './licenseClusterLand';

describe('licenseClusterLand', () => {
  it('snaps Gulf of Guinea grid center onto Ghana land', () => {
    const { lat, lng } = refineClusterLandPosition(4.0, 0.0, 'Ghana');
    const bbox = countryLandBBox('Ghana')!;
    expect(lat).toBeGreaterThanOrEqual(bbox.south);
    expect(lat).toBeLessThanOrEqual(bbox.north);
    expect(lng).toBeGreaterThanOrEqual(bbox.west);
    expect(lng).toBeLessThanOrEqual(bbox.east);
    expect(lat).toBeCloseTo(8, 0);
    expect(lng).toBeCloseTo(-1, 0);
  });

  it('keeps onshore Ghana coordinates', () => {
    expect(refineClusterLandPosition(7.0, -1.0, 'Ghana')).toEqual({ lat: 7, lng: -1 });
  });
});
