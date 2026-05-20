import { describe, expect, it } from 'vitest';
import {
  buildOsmObjectUrl,
  buildPetroleumFeatureViewModel,
  collectExploringCompanies,
  collectOsmPipelineDetails,
  isOilmapDatasetCountry,
  isOsmInfrastructureFeature,
  parseOsmWikipediaUrl,
  parseOsmWikidataUrl,
  parsePetroleumSource,
  resolvePetroleumCountry,
} from './petroleumFeatureFields';

const NAMIBIA_BLOCK_2017 = {
  Company: '',
  Country: 'NA_contracts',
  Name: '2017',
  Source:
    '<a href="http://www.namcor.com.na/hydrocarbon-licence-map" style="color:white;" target="_blank" >http://www.namcor.com.na/hydrocarbon-licence-map</a>',
  Type: 'EXPLORATION AREAS',
  source_layer: '100419-547uem',
};

const NAMIBIA_BLOCK_WITH_OPERATORS = {
  Company: 'Repsol, Arcadia Expro, Tower',
  Country: 'NA_contracts',
  Name: '2011A',
  Source:
    '<a href="http://www.namcor.com.na/hydrocarbon-licence-map" style="color:white;" target="_blank" >http://www.namcor.com.na/hydrocarbon-licence-map</a>',
  Type: 'EXPLORATION AREAS',
};

describe('resolvePetroleumCountry', () => {
  it('maps oilmap dataset ids to country names', () => {
    expect(resolvePetroleumCountry('NA_contracts')).toBe('Namibia');
    expect(resolvePetroleumCountry('NG_contracts+')).toBe('Nigeria');
    expect(resolvePetroleumCountry('ZA')).toBe('South Africa');
  });

  it('keeps readable country names', () => {
    expect(resolvePetroleumCountry('COLOMBIA')).toBe('Colombia');
    expect(resolvePetroleumCountry('Italy')).toBe('Italy');
  });

  it('detects dataset country codes', () => {
    expect(isOilmapDatasetCountry('NA_contracts')).toBe(true);
    expect(isOilmapDatasetCountry('Namibia')).toBe(false);
  });
});

describe('parsePetroleumSource', () => {
  it('extracts href from oilmap HTML anchor', () => {
    const parsed = parsePetroleumSource(NAMIBIA_BLOCK_2017.Source);
    expect(parsed.sourceUrl).toBe('http://www.namcor.com.na/hydrocarbon-licence-map');
    expect(parsed.sourceLabel).toContain('namcor.com.na');
    expect(parsed.sourceText).toBeNull();
  });

  it('accepts plain URLs', () => {
    const parsed = parsePetroleumSource('https://example.com/license-map');
    expect(parsed.sourceUrl).toBe('https://example.com/license-map');
  });
});

describe('collectExploringCompanies', () => {
  it('splits comma-separated Company values', () => {
    expect(collectExploringCompanies(NAMIBIA_BLOCK_WITH_OPERATORS)).toEqual([
      'Repsol',
      'Arcadia Expro',
      'Tower',
    ]);
  });

  it('reads operator aliases', () => {
    expect(
      collectExploringCompanies({ operator: 'Shell', licensee: 'Total' })
    ).toEqual(['Shell', 'Total']);
  });
});

describe('buildPetroleumFeatureViewModel', () => {
  it('normalizes Namibia block 2017 popup fields', () => {
    const model = buildPetroleumFeatureViewModel(NAMIBIA_BLOCK_2017, 'exploration');
    expect(model.title).toBe('2017');
    expect(model.subtitle).toBe('Namibia');
    expect(model.country).toBe('Namibia');
    expect(model.exploringCompanies).toEqual([]);
    expect(model.sourceUrl).toBe('http://www.namcor.com.na/hydrocarbon-licence-map');
    expect(model.source).toBeNull();
    expect(model.extraRows.some((r) => r.value.includes('<a href'))).toBe(false);
  });

  it('lists exploring companies for blocks with Company data', () => {
    const model = buildPetroleumFeatureViewModel(NAMIBIA_BLOCK_WITH_OPERATORS, 'exploration');
    expect(model.exploringCompanies).toEqual(['Repsol', 'Arcadia Expro', 'Tower']);
    expect(model.country).toBe('Namibia');
  });

  it('prefers Name as title and Company as operator for refineries', () => {
    const model = buildPetroleumFeatureViewModel(
      {
        Name: '502 - Metro Oil Corp. - Fujairah',
        Company: 'Metro Oil Corp',
        Country: 'United Arab Emirates',
        STATUS: 'Operating',
      },
      'refineries'
    );
    expect(model.title).toBe('502 - Metro Oil Corp. - Fujairah');
    expect(model.operator).toBe('Metro Oil Corp');
    expect(model.country).toBe('United Arab Emirates');
    expect(model.status).toBe('Operating');
  });

  it('does not duplicate name rows in extra fields', () => {
    const model = buildPetroleumFeatureViewModel({ Name: 'Alpha Refinery', Type: 'Refinery' }, 'refineries');
    expect(model.extraRows.some((r) => r.label.toLowerCase().includes('name'))).toBe(false);
  });

  it('surfaces OSM pipeline operator and operational tags', () => {
    const props = {
      name: 'Trans-Alaska Pipeline',
      operator: 'Alyeska Pipeline Service Company',
      owner: 'State of Alaska',
      substance: 'oil',
      diameter: '48 in',
      capacity: '2.1 Mbpd',
      ref: 'TAPS',
      network: 'US crude',
      source: 'openstreetmap',
      osm_type: 'way',
      osm_id: 98483828,
      man_made: 'pipeline',
      wikipedia: 'en:Trans-Alaska Pipeline System',
      wikidata: 'Q587961',
    };
    const model = buildPetroleumFeatureViewModel(props, 'oil_pipelines');
    expect(model.isOsmFeature).toBe(true);
    expect(model.operator).toBe('Alyeska Pipeline Service Company');
    expect(model.owner).toBe('State of Alaska');
    expect(model.operatorMissing).toBe(false);
    expect(model.sector).toBe('oil');
    expect(model.pipelineDetails).toEqual(
      expect.arrayContaining([
        { label: 'Substance', value: 'oil' },
        { label: 'Diameter', value: '48 in' },
        { label: 'Capacity', value: '2.1 Mbpd' },
        { label: 'Reference', value: 'TAPS' },
        { label: 'Network', value: 'US crude' },
      ])
    );
    expect(model.osmUrl).toBe('https://www.openstreetmap.org/way/98483828');
    expect(model.wikipediaUrl).toContain('wikipedia.org');
    expect(model.wikidataUrl).toBe('https://www.wikidata.org/wiki/Q587961');
    expect(model.extraRows.some((r) => r.label.toLowerCase() === 'source')).toBe(false);
  });

  it('shows water pipeline badge for Arabic water project name', () => {
    const props = {
      name: 'مشروع المياه القطري',
      'name:ar': 'مشروع المياه القطري',
      source: 'openstreetmap',
      osm_type: 'way',
      osm_id: 296661798,
      man_made: 'pipeline',
      layer_id: 'pipelines',
    };
    const model = buildPetroleumFeatureViewModel(props, 'oil_pipelines');
    expect(model.pipelineSubstance).toBe('water');
    expect(model.pipelineBadgeLabel).toBe('Water pipeline');
    expect(model.facilityType).toBe('Water pipeline');
  });

  it('marks operator missing for untagged OSM pipelines', () => {
    const model = buildPetroleumFeatureViewModel(
      {
        source: 'openstreetmap',
        osm_type: 'way',
        osm_id: 123,
        man_made: 'pipeline',
      },
      'oil_pipelines'
    );
    expect(model.operatorMissing).toBe(true);
    expect(model.operator).toBeNull();
    expect(model.title).toContain('123');
    expect(model.pipelineBadgeLabel).toBe('Pipeline (substance not tagged)');
  });

  it('uses owner when operator is absent', () => {
    const model = buildPetroleumFeatureViewModel(
      { owner: 'Gazprom', source: 'openstreetmap', osm_id: 1, osm_type: 'way' },
      'gas_pipelines'
    );
    expect(model.operator).toBe('Gazprom');
    expect(model.operatorMissing).toBe(false);
  });
});

describe('OSM petroleum helpers', () => {
  it('detects OSM infrastructure features', () => {
    expect(isOsmInfrastructureFeature({ source: 'openstreetmap' })).toBe(true);
    expect(isOsmInfrastructureFeature({ osm_id: 42 })).toBe(true);
    expect(isOsmInfrastructureFeature({ Name: 'Block A' })).toBe(false);
  });

  it('builds OSM object URLs', () => {
    expect(buildOsmObjectUrl('way', 98483828)).toBe(
      'https://www.openstreetmap.org/way/98483828'
    );
  });

  it('parses wikipedia and wikidata tags', () => {
    expect(parseOsmWikipediaUrl('en:Trans-Alaska Pipeline System')).toContain(
      'en.wikipedia.org/wiki'
    );
    expect(parseOsmWikidataUrl('Q587961')).toBe('https://www.wikidata.org/wiki/Q587961');
  });

  it('collects diameter variant tags', () => {
    expect(
      collectOsmPipelineDetails({
        substance: 'gas',
        'diameter:design': '1200 mm',
      })
    ).toEqual(
      expect.arrayContaining([
        { label: 'Substance', value: 'gas' },
        { label: 'Diameter design', value: '1200 mm' },
      ])
    );
  });
});
