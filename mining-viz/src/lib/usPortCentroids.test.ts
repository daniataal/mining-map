import { describe, expect, it } from 'vitest';
import { dischargeFromHistoricPort, formatUsPortLabel, usPortCentroid } from './usPortCentroids';

describe('formatUsPortLabel', () => {
  it('formats city and state', () => {
    expect(formatUsPortLabel('Houston', 'TX', null)).toBe('Houston, TX');
  });
});

describe('usPortCentroid', () => {
  it('resolves known EIA ports', () => {
    const c = usPortCentroid({ port_city: 'Houston', port_state: 'TX' });
    expect(c.label).toBe('Houston, TX');
    expect(c.lat).toBeCloseTo(29.73, 0);
  });

  it('uses port label from API when provided', () => {
    const d = dischargeFromHistoricPort({
      port_city: 'Nederland',
      port_state: 'TX',
      port_label: 'Nederland, TX',
    });
    expect(d.label).toBe('Nederland, TX');
  });
});
