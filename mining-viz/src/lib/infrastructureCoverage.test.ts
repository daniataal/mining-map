import { describe, expect, it } from 'vitest';
import {
  formatInfrastructureCoverageBanner,
  infrastructureCoverageGapMessage,
} from './infrastructureCoverageFormat';

describe('infrastructureCoverage', () => {
  it('formats banner from viewport counts', () => {
    const text = formatInfrastructureCoverageBanner({
      viewport: {
        osm_pipelines: 12,
        osm_refineries: 1,
        osm_storage: 40,
        gem_pipelines: 8,
        gem_plants: 3,
        gem_lng_terminals: 2,
        gem_extraction_fields: 5,
      },
    });
    expect(text).toContain('12 pipes');
    expect(text).toContain('complementary');
  });

  it('surfaces coverage gap message', () => {
    expect(
      infrastructureCoverageGapMessage({ coverage_gap: true }),
    ).toMatch(/No OSM\/GEM/);
  });
});
