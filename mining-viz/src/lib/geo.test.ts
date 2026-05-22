import { describe, expect, it } from 'vitest';
import {
  applyCollocationJitter,
  collocatedDisplayOffset,
  spreadRadiusDeg,
} from './geo';
import type { MiningLicense } from '../types';

function license(id: string, lat: number, lng: number): MiningLicense {
  return {
    id,
    company: id,
    licenseType: 'Test',
    commodity: 'Gold',
    status: 'Active',
    date: null,
    country: 'Ghana',
    region: 'Ashanti',
    lat,
    lng,
  };
}

describe('collocated display spread', () => {
  it('spreadRadiusDeg grows with count but caps', () => {
    expect(spreadRadiusDeg(1)).toBe(0);
    expect(spreadRadiusDeg(20)).toBeCloseTo(0.00015 * Math.sqrt(20), 8);
    expect(spreadRadiusDeg(20)).toBeGreaterThan(spreadRadiusDeg(4));
    expect(spreadRadiusDeg(100_000)).toBe(0.04);
  });

  it('100 licenses at same coord get distinct display positions within cap', () => {
    const baseLat = 6.747;
    const baseLng = -1.521;
    const rows = Array.from({ length: 100 }, (_, i) =>
      license(`lic-${String(i).padStart(3, '0')}`, baseLat, baseLng),
    );
    const out = applyCollocationJitter(rows);
    const positions = new Set(
      out.map((r) => `${r._displayLat!.toFixed(6)},${r._displayLng!.toFixed(6)}`),
    );
    expect(positions.size).toBe(100);
    for (const r of out) {
      expect(r._wasJittered).toBe(true);
      expect(r._collocatedCount).toBe(100);
      expect(Math.abs(r._displayLat! - baseLat)).toBeLessThanOrEqual(0.04 + 1e-6);
      expect(Math.abs(r._displayLng! - baseLng)).toBeLessThanOrEqual(0.05);
      expect(r.lat).toBe(baseLat);
      expect(r.lng).toBe(baseLng);
    }
  });

  it('singleton rows are unchanged', () => {
    const out = applyCollocationJitter([license('solo', 5, -0.2)]);
    expect(out[0]._displayLat).toBe(5);
    expect(out[0]._displayLng).toBe(-0.2);
    expect(out[0]._wasJittered).toBe(false);
  });

  it('collocatedDisplayOffset is stable for same index', () => {
    const a = collocatedDisplayOffset(6.7, -1.5, 3, 40);
    const b = collocatedDisplayOffset(6.7, -1.5, 3, 40);
    expect(a).toEqual(b);
  });
});
