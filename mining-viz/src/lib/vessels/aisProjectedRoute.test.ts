import { describe, expect, it } from 'vitest';
import { buildAisProjectedRoute, resolveAisDestinationEndpoint } from './aisProjectedRoute';
import type { MaritimeVessel } from './types';

function vessel(partial: Partial<MaritimeVessel>): MaritimeVessel {
  return {
    id: 'v1',
    mmsi: '123',
    vessel_name: 'TEST',
    lat: 25,
    lng: 55,
    observed_at: '2026-05-31T00:00:00Z',
    source_label: 'ais',
    ...partial,
  };
}

describe('resolveAisDestinationEndpoint', () => {
  it('matches UN/LOCODE substring in AIS destination', () => {
    const endpoint = resolveAisDestinationEndpoint(
      vessel({
        destination: 'FR LRH',
        nearest_port: {
          name: 'Lorient',
          unlocode: 'FRLRH',
          lat: 47.75,
          lng: -3.37,
          source_label: 'port',
        },
      }),
    );
    expect(endpoint?.matchKind).toBe('unlocode');
    expect(endpoint?.lat).toBe(47.75);
  });

  it('returns null when port name does not match destination text', () => {
    const endpoint = resolveAisDestinationEndpoint(
      vessel({
        destination: 'SINGAPORE',
        nearest_port: {
          name: 'Fujairah',
          lat: 25.12,
          lng: 56.34,
          source_label: 'port',
        },
      }),
    );
    expect(endpoint).toBeNull();
  });
});

describe('buildAisProjectedRoute', () => {
  it('reports no destination when AIS field empty', () => {
    expect(buildAisProjectedRoute(vessel({ destination: null })).status).toBe('no_destination');
  });

  it('builds path when destination matches nearest port', () => {
    const result = buildAisProjectedRoute(
      vessel({
        destination: 'ROTTERDAM',
        nearest_port: {
          name: 'Rotterdam',
          lat: 51.9,
          lng: 4.5,
          source_label: 'port',
        },
      }),
    );
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.path.length).toBeGreaterThan(2);
      expect(result.path[0][0]).toBeCloseTo(25, 5);
      expect(result.path[0][1]).toBeCloseTo(55, 5);
    }
  });
});
