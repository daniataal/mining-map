import { describe, expect, it } from 'vitest';
import {
  bezierMidpoint,
  commodityColor,
  recencyOpacity,
  tierDashArray,
  tierDoubleStroke,
  volumeToWeight,
} from './corridorGeometry';

describe('bezierMidpoint', () => {
  it('returns three points starting at load and ending at discharge', () => {
    const pts = bezierMidpoint({ lat: 0, lng: 0 }, { lat: 10, lng: 10 }, 0);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[2]).toEqual([10, 10]);
  });

  it('bends the mid point off the straight line', () => {
    const [, mid] = bezierMidpoint({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 0);
    // straight midpoint would be (0, 5); a bend should push lat away from 0.
    expect(mid[1]).toBeCloseTo(5, 5);
    expect(Math.abs(mid[0])).toBeGreaterThan(0);
  });

  it('alternates bend direction for odd vs even offsetIdx', () => {
    const [, midA] = bezierMidpoint({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 0);
    const [, midB] = bezierMidpoint({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 1);
    expect(Math.sign(midA[0])).toBe(-Math.sign(midB[0]));
  });

  it('scales bend magnitude with higher offsetIdx tiers', () => {
    const [, midTier0] = bezierMidpoint({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 0);
    const [, midTier1] = bezierMidpoint({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 2);
    expect(Math.abs(midTier1[0])).toBeGreaterThan(Math.abs(midTier0[0]));
  });

  it('accepts tuple inputs and is finite for zero-length corridors', () => {
    const pts = bezierMidpoint([1.234, 5.678], [1.234, 5.678], 3);
    for (const p of pts) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
  });
});

describe('commodityColor', () => {
  it('returns stable hex for known families', () => {
    expect(commodityColor('crude_oil')).toBe(commodityColor('Crude Oil'));
    expect(commodityColor('LPG')).toMatch(/^#/);
  });

  it('falls back to slate for unknown families', () => {
    const unknown = commodityColor('mystery');
    const fallback = commodityColor(undefined);
    expect(unknown).toBe(fallback);
  });

  it('normalises whitespace and hyphens', () => {
    expect(commodityColor('fuel-oil')).toBe(commodityColor('Fuel Oil'));
  });
});

describe('volumeToWeight', () => {
  it('returns a default for missing or invalid input', () => {
    expect(volumeToWeight(undefined)).toBe(2);
    expect(volumeToWeight(null as unknown as number)).toBe(2);
    expect(volumeToWeight(-5)).toBe(2);
    expect(volumeToWeight(0)).toBe(2);
  });

  it('clamps to [1, 6]', () => {
    expect(volumeToWeight(1)).toBeLessThanOrEqual(6);
    expect(volumeToWeight(1)).toBeGreaterThanOrEqual(1);
    expect(volumeToWeight(1e12)).toBeLessThanOrEqual(6);
  });

  it('monotonically increases with volume', () => {
    const a = volumeToWeight(10_000);
    const b = volumeToWeight(500_000);
    const c = volumeToWeight(5_000_000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThanOrEqual(b);
  });
});

describe('recencyOpacity', () => {
  const now = Date.parse('2024-06-01T00:00:00Z');

  it('returns 1.0 for fresh events', () => {
    expect(recencyOpacity('2024-05-25T00:00:00Z', now)).toBe(1.0);
  });

  it('returns 0.4 for stale events', () => {
    expect(recencyOpacity('2023-11-01T00:00:00Z', now)).toBe(0.4);
  });

  it('decays linearly between 30 and 180 days', () => {
    // 105 days ≈ midpoint, expect ~0.7
    const mid = recencyOpacity('2024-02-17T00:00:00Z', now);
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(0.8);
  });

  it('falls back to a neutral opacity when date is missing or invalid', () => {
    expect(recencyOpacity(undefined, now)).toBe(0.7);
    expect(recencyOpacity('not-a-date', now)).toBe(0.7);
  });
});

describe('tierDashArray', () => {
  it('returns dashed for synthetic / seed_port_calls', () => {
    expect(tierDashArray('synthetic', 'synthetic', 1)).toBe('8 6');
    expect(tierDashArray(undefined, 'seed_port_calls', 1)).toBe('8 6');
  });

  it('returns solid for live_ais', () => {
    expect(tierDashArray('confirmed', 'live_ais', 2)).toBeUndefined();
  });

  it('returns solid when triangulation_score >= 4 regardless of tier', () => {
    expect(tierDashArray('synthetic', 'synthetic', 4)).toBeUndefined();
    expect(tierDashArray('synthetic', 'seed_port_calls', 5)).toBeUndefined();
  });

  it('returns solid by default', () => {
    expect(tierDashArray(undefined, undefined, undefined)).toBeUndefined();
  });
});

describe('tierDoubleStroke', () => {
  it('is true only for high triangulation scores', () => {
    expect(tierDoubleStroke(4)).toBe(true);
    expect(tierDoubleStroke(10)).toBe(true);
    expect(tierDoubleStroke(3)).toBe(false);
    expect(tierDoubleStroke(undefined)).toBe(false);
    expect(tierDoubleStroke(null)).toBe(false);
  });
});
