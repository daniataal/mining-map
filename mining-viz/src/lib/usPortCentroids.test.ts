import { describe, expect, it } from 'vitest';
import { dischargeFromHistoricPort, usPortCentroid } from './usPortCentroids';

describe('usPortCentroids', () => {
  it('resolves Newark with full state name (not Gulf fallback)', () => {
    const c = usPortCentroid({
      port_city: 'NEWARK',
      port_state: 'NEW JERSEY',
      port_code: '5201',
    });
    expect(c.label).toContain('Newark');
    expect(c.lat).toBeGreaterThan(40);
    expect(c.lng).toBeLessThan(-73);
    expect(c.label).not.toContain('Gulf');
  });

  it('resolves El Segundo, CA', () => {
    const d = dischargeFromHistoricPort({
      port_city: 'EL SEGUNDO',
      port_state: 'CALIFORNIA',
    });
    expect(d.label).toContain('El Segundo');
    expect(d.lat).toBeLessThan(34.5);
    expect(d.lng).toBeLessThan(-117);
  });
});
