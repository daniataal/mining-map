import { describe, expect, it } from 'vitest';
import {
  buildPipelineHoverSummary,
  collectGemPipelineDetails,
  pipelineClickCoordinates,
} from './petroleumFeatureFields';

describe('pipelineMapInteraction', () => {
  it('prefers click coordinates over line midpoint', () => {
    const coords = pipelineClickCoordinates(
      {
        type: 'LineString',
        coordinates: [
          [10, 20],
          [11, 21],
        ],
      },
      { lat: 20.5, lng: 10.5 },
    );
    expect(coords).toEqual({ lat: 20.5, lng: 10.5 });
  });

  it('uses line midpoint when click point is absent', () => {
    const coords = pipelineClickCoordinates({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [2, 2],
        [4, 4],
      ],
    });
    expect(coords).toEqual({ lat: 2, lng: 2 });
  });
});

describe('GEM pipeline presentation', () => {
  it('builds hover summary with route and commodity', () => {
    const summary = buildPipelineHoverSummary({
      layer_id: 'gem_pipelines',
      pipeline_name: 'East-West Crude',
      fuel: 'Oil',
      capacity_text: '500000 bpd',
      start_location: 'Basra',
      end_location: 'Ceyhan',
    });
    expect(summary.title).toBe('East-West Crude');
    expect(summary.subtitle).toContain('Oil');
    expect(summary.subtitle).toContain('Basra → Ceyhan');
  });

  it('collects GEM route and capacity fields', () => {
    const rows = collectGemPipelineDetails({
      source_id: 'gem_goit_oil_ngl_pipelines_march_2025',
      pipeline_name: 'Test',
      fuel: 'Oil',
      start_location: 'A',
      end_location: 'B',
      capacity_text: '100 bpd',
      status: 'operating',
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { label: 'Pipeline', value: 'Test' },
        { label: 'Commodity', value: 'Oil' },
        { label: 'Route', value: 'A → B' },
        { label: 'Capacity', value: '100 bpd' },
        { label: 'Status', value: 'operating' },
      ]),
    );
  });
});
