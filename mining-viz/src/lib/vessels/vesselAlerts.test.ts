import { describe, expect, it } from 'vitest';
import type { LegalEvent } from '../../types';
import type { MaritimeVessel, MaritimeVesselFeedResponse } from './types';
import {
  buildVesselAlerts,
  findNearbyVessels,
  haversineDistanceKm,
  isDemoMaritimeVessel,
  isPointInBbox,
  licenseViewportBounds,
} from './vesselAlerts';

function feed(partial: Partial<MaritimeVesselFeedResponse>): MaritimeVesselFeedResponse {
  return {
    vessels: [],
    source: 'test',
    data_as_of: '2026-05-20T12:00:00Z',
    live_positions_enabled: false,
    limitations: [],
    scope: 'all_vessels',
    capture_window_seconds: 10,
    max_vessels: 1000,
    ...partial,
  };
}

function vessel(partial: Partial<MaritimeVessel>): MaritimeVessel {
  return {
    id: 'mmsi:123',
    mmsi: '123',
    vessel_name: 'Test Vessel',
    lat: 0,
    lng: 0,
    observed_at: '2026-05-20T11:55:00Z',
    source_label: 'AISStream snapshot',
    ...partial,
  };
}

describe('haversineDistanceKm', () => {
  it('returns zero for identical points', () => {
    expect(haversineDistanceKm(1, 2, 1, 2)).toBe(0);
  });
});

describe('isDemoMaritimeVessel', () => {
  it('detects demo ids and synthetic source labels', () => {
    expect(isDemoMaritimeVessel(vessel({ id: 'demo:gulf:1', source_label: 'AIS' }))).toBe(true);
    expect(isDemoMaritimeVessel(vessel({ source_label: 'Hormuz demo (synthetic)' }))).toBe(true);
    expect(isDemoMaritimeVessel(vessel({ id: 'mmsi:999', source_label: 'AISStream snapshot' }))).toBe(false);
  });
});

describe('findNearbyVessels', () => {
  it('returns vessels sorted by distance and excludes demo rows by default', () => {
    const nearby = findNearbyVessels(
      [
        vessel({ id: 'far', lat: 1.5, lng: 0 }),
        vessel({ id: 'near', lat: 0.05, lng: 0, vessel_name: 'Near One' }),
        vessel({ id: 'demo:1', lat: 0.01, lng: 0, source_label: 'demo synthetic' }),
      ],
      0,
      0,
      150,
    );
    expect(nearby.map((item) => item.vessel.id)).toEqual(['near']);
  });
});

describe('buildVesselAlerts', () => {
  it('adds stale AIS warning from feed metadata', () => {
    const alerts = buildVesselAlerts({
      feed: feed({ stale: true, snapshot_age_seconds: 900 }),
      feedIssue: 'snapshot_stale',
      licenseLat: 5,
      licenseLng: -1,
    });
    expect(alerts.some((alert) => alert.kind === 'ais_stale')).toBe(true);
    expect(alerts.find((alert) => alert.kind === 'ais_stale')?.sourceLabel).toBe('AIS snapshot');
  });

  it('adds Persian Gulf coverage gap with higher severity when license is in Gulf', () => {
    const alerts = buildVesselAlerts({
      feed: feed({ aisstream_persian_gulf_coverage_gap: true }),
      feedIssue: null,
      licenseLat: 26,
      licenseLng: 52,
    });
    const gap = alerts.find((alert) => alert.kind === 'persian_gulf_gap');
    expect(gap?.severity).toBe('critical');
    expect(isPointInBbox(26, 52, [22, 47, 30.5, 60])).toBe(true);
  });

  it('creates proximity alerts only for real AIS vessels', () => {
    const alerts = buildVesselAlerts({
      feed: feed({}),
      feedIssue: null,
      licenseLat: 0,
      licenseLng: 0,
      nearbySignals: findNearbyVessels(
        [
          vessel({ id: 'near', lat: 0.05, lng: 0, speed_knots: 8.2 }),
          vessel({ id: 'demo:1', lat: 0.01, lng: 0, source_label: 'demo synthetic' }),
        ],
        0,
        0,
      ),
    });
    expect(alerts.filter((alert) => alert.kind === 'vessel_proximity')).toHaveLength(1);
    expect(alerts[0].kind).toBe('vessel_proximity');
    expect(alerts[0].observedAt).toBe('2026-05-20T11:55:00Z');
  });

  it('adds OpenSanctions alert from legal events', () => {
    const legalEvents: LegalEvent[] = [
      {
        id: 'le-1',
        entityKind: 'license',
        entityId: 'lic-1',
        caseTitle: 'ACME Corp sanctions match',
        role: 'subject',
        summary: 'Matched on EU consolidated list.',
        sourceName: 'OpenSanctions',
        discoveredBy: 'opensanctions',
        lastSeenAt: '2026-05-19T08:00:00Z',
      },
    ];
    const alerts = buildVesselAlerts({
      feed: feed({}),
      feedIssue: null,
      legalEvents,
    });
    expect(alerts.some((alert) => alert.kind === 'sanctions')).toBe(true);
  });

  it('adds ESG zone alert when license intersects overlay', () => {
    const alerts = buildVesselAlerts({
      feed: feed({}),
      feedIssue: null,
      esgZone: {
        name: 'Test Reserve',
        center: [0, 0],
        radius: 1000,
        color: '#000',
        fillColor: '#000',
        description: 'test',
        zoneType: 'Reserve',
        restrictions: 'none',
        country: 'Test',
      },
    });
    expect(alerts.some((alert) => alert.kind === 'esg_zone')).toBe(true);
  });
});

describe('licenseViewportBounds', () => {
  it('builds a padded bbox around the license', () => {
    expect(licenseViewportBounds(10, 20, 1)).toEqual({
      south: 9,
      west: 19,
      north: 11,
      east: 21,
    });
  });
});
