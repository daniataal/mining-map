import { describe, expect, it } from 'vitest';
import {
  countriesForSector,
  countryHasSectorSignal,
  formatCoverageSummaryCounts,
  latestSyncForSources,
  miningSourceIds,
  sectorCoverageSummary,
} from './licenseCoverage';
import type { WorldCoverageResponse } from '../types';

const FIXTURE: WorldCoverageResponse = {
  generated_at: '2026-05-23T12:00:00Z',
  summary: {
    mining: {
      official_syncable: 3,
      global_fallback_only: 1,
      fallback_imported: 0,
    },
    oil_and_gas: { official_syncable: 5 },
  },
  countries: [
    {
      country: 'Zambia',
      sectors: {
        mining: {
          status: 'official_syncable',
          note: '',
          references: [],
          source_ids: ['zambia_mining'],
          record_count: 120,
          last_synced_at: '2026-05-20T00:00:00Z',
          fallback_record_count: 0,
          fallback_last_synced_at: null,
          fallback_sources: [],
        },
        oil_and_gas: {
          status: 'unavailable',
          note: '',
          references: [],
          source_ids: [],
          record_count: 0,
          last_synced_at: null,
          fallback_record_count: 0,
          fallback_last_synced_at: null,
          fallback_sources: [],
        },
      },
    },
    {
      country: 'Nowhere',
      sectors: {
        mining: {
          status: 'unavailable',
          note: '',
          references: [],
          source_ids: [],
          record_count: 0,
          last_synced_at: null,
          fallback_record_count: 0,
          fallback_last_synced_at: null,
          fallback_sources: [],
        },
        oil_and_gas: {
          status: 'unavailable',
          note: '',
          references: [],
          source_ids: [],
          record_count: 0,
          last_synced_at: null,
          fallback_record_count: 0,
          fallback_last_synced_at: null,
          fallback_sources: [],
        },
      },
    },
  ],
  sources: [
    {
      source_id: 'zambia_mining',
      source_name: 'Zambia',
      sector: 'mining',
      country: 'Zambia',
      source_url: 'https://example.com',
      source_kind: 'arcgis',
      source_access: 'open',
      coverage_state: 'official_syncable',
      coverage_scope: 'national',
      jurisdiction_scope: 'national',
      record_count: 120,
    },
  ],
};

describe('licenseCoverage', () => {
  it('formats non-zero summary counts', () => {
    const summary = sectorCoverageSummary(FIXTURE, 'mining');
    expect(formatCoverageSummaryCounts(summary)).toContain('3 official live');
  });

  it('lists countries with sector signal only', () => {
    expect(countryHasSectorSignal(FIXTURE.countries[0], 'mining')).toBe(true);
    expect(countryHasSectorSignal(FIXTURE.countries[1], 'mining')).toBe(false);
    expect(countriesForSector(FIXTURE, 'mining')).toHaveLength(1);
    expect(countriesForSector(FIXTURE, 'mining')[0].country).toBe('Zambia');
  });

  it('picks latest mining sync run by source_id', () => {
    const ids = miningSourceIds(FIXTURE);
    const latest = latestSyncForSources(
      [
        { source_id: 'zambia_mining', finished_at: '2026-05-19T00:00:00Z', status: 'success' },
        { source_id: 'other', finished_at: '2026-05-21T00:00:00Z', status: 'success' },
      ],
      ids,
    );
    expect(latest?.source_id).toBe('zambia_mining');
  });
});
