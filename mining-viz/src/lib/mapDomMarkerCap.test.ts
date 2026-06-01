import { describe, expect, it } from 'vitest';
import { capMarkersInViewport } from './mapDomMarkerCap';

const viewport = { south: 0, west: 0, north: 10, east: 10 };

describe('capMarkersInViewport', () => {
  it('returns all items when under limit', () => {
    const items = [{ id: 'a', lat: 5, lng: 5 }];
    expect(capMarkersInViewport(items, viewport, 800)).toEqual({ data: items, capped: false });
  });

  it('caps in-viewport markers and keeps selection', () => {
    const items = Array.from({ length: 900 }, (_, i) => ({
      id: `m${i}`,
      lat: 5,
      lng: 5 + i * 0.0001,
    }));
    const selectedId = 'm899';
    const { data, capped } = capMarkersInViewport(items, viewport, 800, selectedId);
    expect(capped).toBe(true);
    expect(data).toHaveLength(800);
    expect(data.some((row) => row.id === selectedId)).toBe(true);
  });

  it('excludes out-of-viewport markers before counting cap', () => {
    const items = [
      ...Array.from({ length: 900 }, (_, i) => ({ id: `in${i}`, lat: 5, lng: 5 })),
      { id: 'far', lat: 50, lng: 50 },
    ];
    const { data, capped } = capMarkersInViewport(items, viewport, 800);
    expect(capped).toBe(true);
    expect(data).toHaveLength(800);
    expect(data.some((row) => row.id === 'far')).toBe(false);
  });
});
