import { describe, expect, it } from 'vitest';
import {
  classifyPipelineSubstance,
  isWaterPipeline,
  pipelineSubstanceDisplayLabel,
  shouldIncludeInOilGasPipelineLayer,
  splitOsmPipelineFeatures,
} from './pipelineSubstance';

describe('classifyPipelineSubstance', () => {
  it('reads explicit substance tags', () => {
    expect(classifyPipelineSubstance({ substance: 'oil' })).toBe('oil');
    expect(classifyPipelineSubstance({ substance: 'gas' })).toBe('gas');
    expect(classifyPipelineSubstance({ substance: 'water' })).toBe('water');
  });

  it('reads type=water', () => {
    expect(classifyPipelineSubstance({ type: 'water', man_made: 'pipeline' })).toBe('water');
  });

  it('classifies Qatar water project by Arabic name (OSM way 296661798)', () => {
    const props = {
      man_made: 'pipeline',
      name: 'مشروع المياه القطري',
      'name:ar': 'مشروع المياه القطري',
      'name:en': 'HaMovil HaArtsi',
      osm_id: 296661798,
      osm_type: 'way',
      source: 'openstreetmap',
    };
    expect(classifyPipelineSubstance(props)).toBe('water');
    expect(pipelineSubstanceDisplayLabel('water')).toBe('Water pipeline');
    expect(isWaterPipeline(props)).toBe(true);
    expect(shouldIncludeInOilGasPipelineLayer(props, 'oil_pipelines')).toBe(false);
  });

  it('returns unknown when pipeline lacks substance and name hints', () => {
    expect(
      classifyPipelineSubstance({ man_made: 'pipeline', osm_id: 1 })
    ).toBe('unknown');
    expect(pipelineSubstanceDisplayLabel('unknown')).toBe(
      'Pipeline (substance not tagged)'
    );
  });

  it('uses precomputed pipeline_substance from backend', () => {
    expect(classifyPipelineSubstance({ pipeline_substance: 'gas' })).toBe('gas');
  });
});

describe('splitOsmPipelineFeatures', () => {
  it('separates water lines from oil/gas', () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { substance: 'oil' },
        geometry: { type: 'LineString', coordinates: [] },
      },
      {
        type: 'Feature',
        properties: { name: 'City water main' },
        geometry: { type: 'LineString', coordinates: [] },
      },
    ];
    const { oilGas, water } = splitOsmPipelineFeatures(features);
    expect(oilGas).toHaveLength(1);
    expect(water).toHaveLength(1);
  });
});
