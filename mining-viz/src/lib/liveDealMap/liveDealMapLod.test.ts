import { describe, expect, it } from 'vitest';
import {
  isLiveDealClientClusterData,
  planLiveDealPointDraw,
  planLiveDealPointFeatureDraw,
} from './liveDealMapLod';
import type { LiveDealMapFeature } from './liveDealMapTypes';

const viewport = { south: -10, west: -10, north: 10, east: 10 };

function point(uid: string, kind: LiveDealMapFeature['kind'], lat: number, lng: number): LiveDealMapFeature {
  return {
    shape: 'point',
    uid,
    id: uid,
    kind,
    lat,
    lng,
    title: uid,
    confidence: 0.7,
  };
}

describe('planLiveDealPointDraw', () => {
  it('draws all visible points when below the zoom cap', () => {
    const features = [
      point('terminal-1', 'terminal', 0, 0),
      point('vessel-1', 'vessel', 1, 1),
      point('outside', 'terminal', 40, 40),
    ];

    expect(planLiveDealPointDraw(features, viewport, 8).drawIndices).toEqual([0, 1]);
  });

  it('keeps deal opportunities ahead of lower-priority points in a low-zoom cell', () => {
    const features: LiveDealMapFeature[] = [
      point('vessel-1', 'vessel', 0.1, 0.1),
      point('terminal-1', 'terminal', 0.2, 0.2),
      { ...point('opportunity-1', 'opportunity', 0.3, 0.3), dealScore: 0.9 },
    ];

    const plan = planLiveDealPointDraw(features, viewport, 4);
    expect(plan.lodSubsampling).toBe(false);

    const crowded = Array.from({ length: 220 }, (_, index) =>
      point(`v-${index}`, 'vessel', 0.01 * index, 0.01 * index),
    );
    crowded.push({ ...point('deal', 'opportunity', 0.15, 0.15), dealScore: 1 });

    const crowdedPlan = planLiveDealPointDraw(crowded, viewport, 4);
    expect(crowdedPlan.lodSubsampling).toBe(true);
    expect(crowdedPlan.drawIndices.map((i) => crowded[i].uid)).toContain('deal');
  });

  it('keeps the selected point even when low-zoom subsampling would hide it', () => {
    const crowded = Array.from({ length: 220 }, (_, index) =>
      point(`v-${index}`, 'vessel', 0.01 * index, 0.01 * index),
    );

    const plan = planLiveDealPointDraw(crowded, viewport, 4, 'v-219');
    expect(plan.drawIndices.map((i) => crowded[i].uid)).toContain('v-219');
  });

  it('turns dense license cells into clickable aggregate features', () => {
    const crowded = Array.from({ length: 30 }, (_, index) =>
      point(`license-${index}`, 'license', 5 + index * 0.001, -1 + index * 0.001),
    );

    const plan = planLiveDealPointFeatureDraw(crowded, viewport, 7, null, {
      clusterPoints: true,
      clusterKinds: ['license'],
    });

    expect(plan.lodSubsampling).toBe(true);
    expect(plan.drawFeatures).toHaveLength(1);
    const cluster = plan.drawFeatures[0];
    expect(cluster.kind).toBe('server_cluster');
    expect(cluster.sourceCount).toBe(30);
    expect(isLiveDealClientClusterData(cluster.data)).toBe(true);
  });
});
