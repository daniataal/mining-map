import { describe, expect, it } from 'vitest';
import {
  buildStorageTerminalPopupModel,
  formatStoragePopupSubtitle,
  formatStoragePopupTitle,
  formatStorageSourceShortLabel,
} from './storageTerminalPopup';
import type { MiningLicense } from '../types';

const baseStorageItem: MiningLicense = {
  id: 'osm:node:123',
  company: 'Unnamed Storage Terminal',
  licenseType: 'Storage Tank',
  commodity: 'petroleum',
  sector: 'oil_and_gas',
  entityKind: 'storage_terminal',
  entitySubtype: 'storage_tank',
  status: 'Mapped open infrastructure',
  date: null,
  country: 'Unknown',
  region: 'Unknown',
  lat: 24.4374,
  lng: 54.4936,
  substanceText: 'oil',
  sourceName: 'OpenStreetMap (offline bulk seed)',
  confidenceScore: 0.58,
  lastSyncedAt: '2026-05-30T00:00:00.000Z',
};

describe('formatStorageSourceShortLabel', () => {
  it('shortens offline bulk seed source names', () => {
    expect(formatStorageSourceShortLabel('OpenStreetMap (offline bulk seed)')).toBe(
      'OSM (offline seed)',
    );
    expect(formatStorageSourceShortLabel('OpenStreetMap via Overpass')).toBe('OSM (Overpass)');
  });
});

describe('formatStoragePopupTitle', () => {
  it('prefers nearby site context for generic titles', () => {
    expect(
      formatStoragePopupTitle({
        ...baseStorageItem,
        siteContextName: 'Khalifa Industrial Zone',
      }),
    ).toBe('Near Khalifa Industrial Zone');
  });

  it('falls back to operator when company is generic', () => {
    expect(
      formatStoragePopupTitle({
        ...baseStorageItem,
        company: 'Unnamed storage tank',
        operatorName: 'ADNOC',
      }),
    ).toBe('ADNOC');
  });
});

describe('formatStoragePopupSubtitle', () => {
  it('omits unknown country labels', () => {
    expect(formatStoragePopupSubtitle(baseStorageItem)).toBe('Mapped open infrastructure');
  });

  it('includes country and status when known', () => {
    expect(
      formatStoragePopupSubtitle({
        ...baseStorageItem,
        country: 'United Arab Emirates',
        region: 'Abu Dhabi',
      }),
    ).toBe('United Arab Emirates · Abu Dhabi · Mapped open infrastructure');
  });
});

describe('buildStorageTerminalPopupModel', () => {
  it('builds sparse popup rows without license-only fields', () => {
    const model = buildStorageTerminalPopupModel(baseStorageItem);
    expect(model.badgeLabel).toBe('OSM tank node (unverified)');
    expect(model.operatorMissing).toBe(true);
    expect(model.detailRows.map((row) => row.label)).toEqual(['Substance', 'Sector']);
    expect(model.sourceShortLabel).toBe('OSM (offline seed)');
    expect(model.confidencePercent).toBe(58);
  });

  it('includes operator and owner when tagged', () => {
    const model = buildStorageTerminalPopupModel({
      ...baseStorageItem,
      company: 'Vopak Rotterdam',
      operatorName: 'Vopak',
      ownerName: 'Shell',
      country: 'Netherlands',
    });
    expect(model.title).toBe('Vopak Rotterdam');
    expect(model.operator).toBe('Vopak');
    expect(model.operatorMissing).toBe(false);
    expect(model.detailRows.map((row) => row.label)).toContain('Owner');
  });

  it('surfaces curated enrichment fields for sparse OSM nodes', () => {
    const model = buildStorageTerminalPopupModel({
      ...baseStorageItem,
      operatorName: 'ADNOC',
      capacityText: 'Multi-tank crude & products hub',
      country: 'United Arab Emirates',
      region: 'Abu Dhabi | Sas Al Nakhl',
      siteContextName: 'ADNOC Sas Al Nakhl / Umm Al Nar Storage Hub',
      curatedEnrichmentSourceName: 'ADNOC Sas Al Nakhl / Umm Al Nar Storage Hub',
      curatedEnrichmentDistanceKm: 0.42,
      enrichmentSourceUrl: 'https://www.adnoc.ae/',
    });
    expect(model.title).toBe('Near ADNOC Sas Al Nakhl / Umm Al Nar Storage Hub');
    expect(model.operator).toBe('ADNOC');
    expect(model.operatorMissing).toBe(false);
    expect(model.detailRows.map((row) => row.label)).toContain('Capacity');
    expect(model.enrichmentSourceUrl).toBe('https://www.adnoc.ae/');
    expect(model.curatedEnrichmentSourceName).toBe(
      'ADNOC Sas Al Nakhl / Umm Al Nar Storage Hub',
    );
  });
});
