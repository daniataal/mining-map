import { describe, expect, it } from 'vitest';
import {
  haversineMeters,
  pickNearestPipelineFeature,
  pipelinePickToleranceM,
  pointToSegmentMeters,
} from './pipelineMapPick';

describe('pipelineMapPick', () => {
  it('computes point-to-segment distance', () => {
    const onLine = pointToSegmentMeters(0, 0.5, 0, 0, 0, 1);
    expect(onLine).toBeLessThan(1);
    const offLine = pointToSegmentMeters(0.1, 0.5, 0, 0, 0, 1);
    expect(offLine).toBeGreaterThan(10_000);
  });

  it('picks nearest pipeline within tolerance', () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { name: 'Far', pipeline_substance: 'oil' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [10, 10],
            [11, 10],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'Near', pipeline_substance: 'gas' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 0],
          ],
        },
      },
    ];
    const pick = pickNearestPipelineFeature(features, 0, 0.5, 50_000);
    expect(pick?.feature.properties?.name).toBe('Near');
  });

  it('returns null when outside tolerance', () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { name: 'Far' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [50, 50],
            [51, 50],
          ],
        },
      },
    ];
    expect(pickNearestPipelineFeature(features, 0, 0, 1000)).toBeNull();
  });

  it('widens tolerance at low zoom', () => {
    expect(pipelinePickToleranceM(14)).toBeLessThan(pipelinePickToleranceM(5));
  });

  it('prefers GEM pipeline over OSM at similar distance', () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { name: 'OSM pipe', pipeline_substance: 'oil', layer_id: 'pipelines' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 0],
          ],
        },
      },
      {
        type: 'Feature',
        properties: {
          name: 'GEM pipe',
          fuel_group: 'oil',
          layer_id: 'gem_pipelines',
          source: 'gem_goit_oil_ngl_pipelines_march_2025',
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0.0001],
            [1, 0.0001],
          ],
        },
      },
    ];
    const pick = pickNearestPipelineFeature(features, 0, 0.5, 50_000);
    expect(pick?.feature.properties?.name).toBe('GEM pipe');
  });

  it('haversine is zero for identical points', () => {
    expect(haversineMeters(1, 2, 1, 2)).toBe(0);
  });
});
