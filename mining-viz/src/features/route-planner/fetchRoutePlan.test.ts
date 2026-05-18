import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchRoutePlan } from './fetchRoutePlan';

const ghanaSupplier = {
  lat: 5.548,
  lng: -0.192,
  label: 'Accra mine',
  country: 'Ghana',
};
const haifaBuyer = {
  lat: 32.819,
  lng: 34.99,
  label: 'Haifa Port',
  country: 'Israel',
};

describe('fetchRoutePlan', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns simulation with liveUnavailableReason when API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Failed to fetch')),
    );

    const res = await fetchRoutePlan({
      supplier: { lat: 5.5, lng: -0.2, label: 'Mine' },
      buyer: { lat: 32, lng: 34.8, label: 'Port' },
      productType: 'gold_concentrate',
      shippingMethods: ['sea_fcl'],
      quantityTons: 100,
      incoterm: 'FOB',
    });

    expect(res.source).toBe('simulation');
    expect(res.liveUnavailableReason).toBeTruthy();
    expect(res.limitations[0]).toContain(res.liveUnavailableReason!);
  });

  it('maps live Ghana→Haifa with supplier/buyer ends and correct sea direction', async () => {
    const liveBody = {
      recommended: {
        id: 'recommended',
        label: 'Recommended',
        is_recommended: true,
        route: {
          origin: { name: 'Accra', lat: 5.548, lng: -0.192, kind: 'origin' },
          destination: { name: 'Haifa Port', lat: 32.819, lng: 34.99, kind: 'destination' },
          legs: [
            {
              leg_id: 'leg-1',
              from: { name: 'Port of Tema', lat: 5.64, lng: 0.018, kind: 'port' },
              to: { name: 'Haifa Port', lat: 32.819, lng: 34.99, kind: 'port' },
              method: 'sea',
              path: [
                [5.64, 0.018],
                [3, -12],
                [32.819, 34.99],
              ],
            },
          ],
        },
        cost_breakdown: {
          leg_costs: [{ leg_id: 'leg-1', method: 'sea', total_cost_usd: 12000, distance_km: 4800 }],
        },
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            String(url).includes('due-diligence')
              ? { checks: [], recommendation: 'escalate' }
              : liveBody,
        }),
      ),
    );

    const res = await fetchRoutePlan({
      supplier: ghanaSupplier,
      buyer: haifaBuyer,
      productType: 'gold_concentrate',
      shippingMethods: ['sea_fcl'],
      quantityTons: 100,
      incoterm: 'FOB',
    });

    expect(res.source).toBe('live');
    expect(res.map.ends?.from.label).toBe('Accra mine');
    expect(res.map.ends?.to.label).toBe('Haifa Port');
    const sea = res.map.legs.find((leg) => leg.method === 'sea');
    expect(sea?.fromName).toMatch(/Tema/i);
    expect(sea?.toName).toMatch(/Haifa/i);
    expect(res.warnings.some((w) => /Ghana → Israel/i.test(w))).toBe(false);
  });

  it('warns when supplier and buyer appear reversed (Israel→Ghana)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('offline')),
    );

    const res = await fetchRoutePlan({
      supplier: { ...haifaBuyer, label: 'Haifa Port' },
      buyer: { ...ghanaSupplier, label: 'Accra' },
      productType: 'gold_concentrate',
      shippingMethods: ['sea_fcl'],
      quantityTons: 100,
      incoterm: 'FOB',
    });

    expect(res.warnings.some((w) => /Ghana → Israel/i.test(w))).toBe(true);
    expect(res.map.ends?.from.label).toBe('Haifa Port');
    expect(res.map.ends?.to.label).toBe('Accra');
  });
});
