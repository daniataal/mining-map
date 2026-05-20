import { describe, expect, it } from 'vitest';
import type { MiningLicense } from '../types';
import {
  buildOilGasLicensePopupModel,
  extractOperatorFromEnrichment,
  formatOilGasSubtypeBadge,
  parseProductionFromCommodity,
  resolveOilGasOperator,
  resolveOilGasPopupKind,
  shouldUseOilGasLicensePopup,
} from './oilGasLicensePopup';

function license(partial: Partial<MiningLicense> & Pick<MiningLicense, 'id'>): MiningLicense {
  return {
    company: 'Test Co',
    licenseType: 'License',
    commodity: 'Crude Oil',
    status: 'Active',
    date: null,
    country: 'UAE',
    region: 'Abu Dhabi',
    lat: 24,
    lng: 54,
    ...partial,
  } as MiningLicense;
}

describe('parseProductionFromCommodity', () => {
  it('splits parenthetical kb/d from commodity', () => {
    expect(parseProductionFromCommodity('Crude Oil (1,234 kb/d)')).toEqual({
      baseCommodity: 'Crude Oil',
      production: '1,234 kb/d',
    });
  });

  it('returns base only when no rate present', () => {
    expect(parseProductionFromCommodity('Crude Oil')).toEqual({
      baseCommodity: 'Crude Oil',
      production: null,
    });
  });
});

describe('extractOperatorFromEnrichment', () => {
  it('parses operated-by clause from notes', () => {
    expect(
      extractOperatorFromEnrichment(
        'One of the largest fields (~1.4 Mb/d); operated by BP/PetroChina JV.'
      )
    ).toBe('BP/PetroChina JV');
  });
});

describe('resolveOilGasPopupKind', () => {
  it('classifies Zakum as oil field', () => {
    expect(
      resolveOilGasPopupKind(
        license({
          id: 'z',
          company: 'Zakum Oil Field',
          entitySubtype: 'oil_field',
          licenseType: 'Supergiant Offshore Field',
          sector: 'oil_and_gas',
        })
      )
    ).toBe('oil_field');
  });

  it('classifies refinery rows', () => {
    expect(
      resolveOilGasPopupKind(
        license({
          id: 'r',
          entitySubtype: 'refinery',
          licenseType: 'Refinery Complex',
          commodity: 'Refined Products',
          sector: 'oil_and_gas',
        })
      )
    ).toBe('refinery');
  });
});

describe('buildOilGasLicensePopupModel', () => {
  it('builds Zakum-style operations and source rows', () => {
    const model = buildOilGasLicensePopupModel(
      license({
        id: 'z',
        company: 'Zakum Oil Field',
        entitySubtype: 'oil_field',
        licenseType: 'Supergiant Offshore Field',
        commodity: 'Crude Oil',
        status: 'Producing',
        region: 'Abu Dhabi Offshore',
        sector: 'oil_and_gas',
        sourceName: 'OPEC / Persian Gulf Reference Data',
        confidenceScore: 0.72,
        confidenceNote: 'Curated reference row.',
        enrichmentNote: 'Third-largest oil field in the Middle East (~1 Mb/d).',
      })
    );

    expect(model.badgeLabel).toBe('OIL FIELD');
    expect(model.description).toContain('Third-largest');
    expect(model.identity.find((r) => r.label === 'Field / facility type')?.value).toBe(
      'Supergiant Offshore Field'
    );
    expect(model.operations.find((r) => r.label === 'Production')?.value).toBe('~1 Mb/d');
    expect(model.source.some((r) => r.label === 'Source')).toBe(true);
    expect(model.source.some((r) => r.label === 'Trust' && r.value === '72%')).toBe(true);
  });

  it('surfaces refinery capacity from enrichment note', () => {
    const model = buildOilGasLicensePopupModel(
      license({
        id: 'ruwais',
        company: 'ADNOC Refining (Ruwais)',
        entitySubtype: 'refinery',
        licenseType: 'Refinery Complex',
        commodity: 'Refined Products',
        sector: 'oil_and_gas',
        enrichmentNote: "One of the world's largest refinery complexes (~922 kb/d).",
        operatorName: 'ADNOC',
      })
    );

    expect(model.kind).toBe('refinery');
    expect(model.operations.find((r) => r.label === 'Capacity')?.value).toBe('~922 kb/d');
    expect(resolveOilGasOperator(license({ id: 'x', operatorName: 'ADNOC', company: 'ADNOC Refining' }))).toBe(
      'ADNOC'
    );
  });

  it('includes regulator link for fuel marketers', () => {
    const model = buildOilGasLicensePopupModel(
      license({
        id: 'fm',
        entitySubtype: 'fuel_marketer',
        licenseType: 'Fuel marketing & retail distribution',
        commodity: 'Gasoline, Diesel, LPG',
        sourceRecordUrl: 'https://www.adnocdistribution.ae/',
        sector: 'oil_and_gas',
      })
    );

    expect(model.kind).toBe('fuel_marketer');
    expect(formatOilGasSubtypeBadge('fuel_marketer', 'fuel_marketer')).toBe('FUEL MARKETER');
    expect(model.operations.some((r) => r.href?.includes('adnocdistribution'))).toBe(true);
  });
});

describe('shouldUseOilGasLicensePopup', () => {
  it('is true for oil_and_gas sector licenses', () => {
    expect(
      shouldUseOilGasLicensePopup(
        license({ id: '1', sector: 'oil_and_gas', entityKind: 'license' })
      )
    ).toBe(true);
  });

  it('is false for storage terminals', () => {
    expect(
      shouldUseOilGasLicensePopup(
        license({ id: '1', sector: 'oil_and_gas', entityKind: 'storage_terminal' })
      )
    ).toBe(false);
  });
});
