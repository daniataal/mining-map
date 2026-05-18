import { describe, expect, it } from 'vitest';
import { mockResponseForPayload } from './mockRoute';

describe('mockResponseForPayload', () => {
  const ghanaSupplier = { lat: 5.548, lng: -0.192, label: 'Accra mine' };
  const tlvBuyer = { lat: 32.011, lng: 34.87, label: 'Ben Gurion Airport (TLV)' };

  it('Ghana → TLV sea uses offshore corridor with many sea points', () => {
    const res = mockResponseForPayload(ghanaSupplier, tlvBuyer, 'gold_concentrate', [
      'sea_fcl',
      'truck_inland',
    ]);
    const seaLeg = res.map.legs.find((leg) => leg.method === 'sea');
    expect(seaLeg).toBeDefined();
    expect(seaLeg!.path.length).toBeGreaterThan(20);
    expect(seaLeg!.label).toMatch(/Haifa/i);

    const inSahara = (lat: number, lng: number) => lat > 20 && lat < 30 && lng > 2 && lng < 18;
    const mid = seaLeg!.path.filter((_, i) => i > 0 && i < seaLeg!.path.length - 1);
    for (const [lat, lng] of mid.filter((_, i) => i % 8 === 0)) {
      expect(inSahara(lat, lng)).toBe(false);
    }
  });

  it('Ghana → TLV sea includes Haifa→TLV road corridor (not geodesic)', () => {
    const res = mockResponseForPayload(ghanaSupplier, tlvBuyer, 'gold_concentrate', [
      'sea_fcl',
      'truck_inland',
    ]);
    const roadLeg = res.map.legs.find(
      (leg) => leg.method === 'road' && leg.label?.includes('Haifa'),
    );
    expect(roadLeg).toBeDefined();
    expect(roadLeg!.path.length).toBeGreaterThan(12);
    const first = roadLeg!.path[0];
    const last = roadLeg!.path[roadLeg!.path.length - 1];
    expect(first[0]).toBeCloseTo(32.819, 1);
    expect(last[0]).toBeCloseTo(32.011, 1);
  });

  it('Ghana → TLV air uses airport trunk, not sea', () => {
    const res = mockResponseForPayload(ghanaSupplier, tlvBuyer, 'gold_concentrate', [
      'air',
      'truck_inland',
    ]);
    expect(res.map.legs.some((leg) => leg.method === 'sea')).toBe(false);
    const airLeg = res.map.legs.find((leg) => leg.method === 'air');
    expect(airLeg?.label).toMatch(/Kotoka/i);
    expect(airLeg?.label).toMatch(/Ben Gurion/i);
    expect(airLeg!.path.length).toBeGreaterThan(10);
  });

  it('adds mixed-mode note when sea selected for airport destination', () => {
    const res = mockResponseForPayload(ghanaSupplier, tlvBuyer, 'gold_concentrate', [
      'sea_fcl',
      'truck_inland',
    ]);
    expect(res.limitations.some((line) => /Haifa/i.test(line) && /airport|Ben Gurion|TLV/i.test(line))).toBe(
      true,
    );
  });
});
