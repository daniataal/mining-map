import { describe, expect, it } from 'vitest';
import { planVesselLodDraw, LOD_FULL_DETAIL_ZOOM } from './vesselDisplayLod';
import type { VesselDrawRecord } from './vesselMarkerStyle';

function record(id: string, lat: number, lng: number, lodPriority = 5): VesselDrawRecord {
  return {
    id,
    lat,
    lng,
    heading: 0,
    color: '#fff',
    isSelected: false,
    lodPriority,
  };
}

describe('planVesselLodDraw', () => {
  const worldBounds = { south: -60, west: -150, north: 70, east: 150 };

  it('draws all in-view vessels at regional zoom', () => {
    const records = [
      record('a', 51.5, 4.0),
      record('b', 51.6, 4.1),
      record('c', 25.0, 55.0),
    ];
    const plan = planVesselLodDraw(records, worldBounds, LOD_FULL_DETAIL_ZOOM);
    expect(plan.lodSubsampling).toBe(false);
    expect(plan.drawIndices).toHaveLength(3);
  });

  it('subsamples dense world view but keeps tanker priority per cell', () => {
    const records: VesselDrawRecord[] = [];
    for (let i = 0; i < 6000; i += 1) {
      records.push(record(`f-${i}`, 50 + (i % 5) * 0.01, 4 + (i % 7) * 0.01, 8));
    }
    records.push(record('tanker-1', 50.02, 4.02, 0));
    const plan = planVesselLodDraw(records, worldBounds, 3);
    expect(plan.lodSubsampling).toBe(true);
    expect(plan.drawIndices.length).toBeLessThan(plan.inViewCount);
    expect(plan.drawIndices).toContain(records.length - 1);
  });

  it('draws all when in-view count is below LOD_MAX_DRAW even at world zoom', () => {
    const records = Array.from({ length: 772 }, (_, i) =>
      record(`v-${i}`, -30 + (i % 40), -120 + (i % 80) * 2, 5),
    );
    const plan = planVesselLodDraw(records, worldBounds, 4);
    expect(plan.lodSubsampling).toBe(false);
    expect(plan.drawIndices).toHaveLength(772);
  });
});
