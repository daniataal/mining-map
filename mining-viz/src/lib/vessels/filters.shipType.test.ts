import { describe, expect, it } from 'vitest';
import { applyVesselFilters, canonicalShipTypeChipFromVessel, parseAisShipTypeCode } from './filters';
import type { MaritimeVessel, VesselFilters } from './types';

const baseVessel = (over: Partial<MaritimeVessel>): MaritimeVessel => ({
  id: 'ais:1',
  mmsi: '123',
  vessel_name: 'Test',
  lat: 25,
  lng: 52,
  observed_at: '2026-01-01T00:00:00+00:00',
  source_label: 'AISStream',
  ...over,
});

describe('canonicalShipTypeChipFromVessel', () => {
  it('uses AIS type code when label is missing', () => {
    expect(
      canonicalShipTypeChipFromVessel(
        baseVessel({ ship_type_code: 82, ship_type_label: null }),
      ),
    ).toBe('Tanker');
    expect(
      canonicalShipTypeChipFromVessel(
        baseVessel({ ship_type_code: 71, ship_type_label: '' }),
      ),
    ).toBe('Cargo');
  });

  it('maps non-canonical labels to filter chips', () => {
    expect(canonicalShipTypeChipFromVessel(baseVessel({ ship_type_label: 'LNG Carrier' }))).toBe('Tanker');
    expect(canonicalShipTypeChipFromVessel(baseVessel({ ship_type_label: 'Bulk carrier' }))).toBe('Cargo');
  });

  it('parses numeric string AIS type codes from JSON snapshots', () => {
    expect(parseAisShipTypeCode('82')).toBe(82);
    expect(
      canonicalShipTypeChipFromVessel(
        baseVessel({ ship_type_code: '82' as unknown as number, ship_type_label: null }),
      ),
    ).toBe('Tanker');
  });
});

describe('applyVesselFilters shipTypes', () => {
  const filtersTankerOnly: VesselFilters = {
    search: '',
    shipTypes: ['Tanker'],
    minSpeedKnots: null,
    maxSpeedKnots: null,
    navigationalStatuses: [],
  };

  it('matches tanker chip when only ship_type_code is present', () => {
    const out = applyVesselFilters(
      [baseVessel({ ship_type_code: 82, ship_type_label: null })],
      filtersTankerOnly,
    );
    expect(out).toHaveLength(1);
  });

  it('excludes non-tankers when Tanker chip selected', () => {
    const out = applyVesselFilters(
      [
        baseVessel({ id: 'a', ship_type_code: 82 }),
        baseVessel({ id: 'b', ship_type_code: 71, ship_type_label: 'Cargo' }),
      ],
      filtersTankerOnly,
    );
    expect(out.map((v) => v.id)).toEqual(['a']);
  });
});
