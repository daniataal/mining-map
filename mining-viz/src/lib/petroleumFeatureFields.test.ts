import { describe, expect, it } from 'vitest';
import {
  buildPetroleumFeatureViewModel,
  collectExploringCompanies,
  isOilmapDatasetCountry,
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
});
