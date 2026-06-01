import { describe, expect, it } from 'vitest';
import { licenseCardSubtitle, licenseCardTitle } from './licenseSidebarCard';
import type { MiningLicense } from '../types';

function base(overrides: Partial<MiningLicense> = {}): MiningLicense {
  return {
    id: 'x',
    company: 'Unknown',
    licenseType: 'Operating company',
    commodity: 'Crude',
    status: 'Operating',
    date: null,
    country: 'Saudi Arabia',
    region: 'Eastern Province',
    lat: 0,
    lng: 0,
    operatorName: 'Aramco',
    ...overrides,
  };
}

describe('licenseSidebarCard', () => {
  it('uses operator when company is unknown placeholder', () => {
    expect(licenseCardTitle(base())).toBe('Aramco');
  });

  it('shows country holder and status on subtitle', () => {
    expect(licenseCardSubtitle(base({ company: 'Ghawar' }))).toBe(
      'Saudi Arabia · Aramco · Operating',
    );
  });

  it('prefers company when present', () => {
    expect(licenseCardTitle(base({ company: 'Ghawar Field' }))).toBe('Ghawar Field');
    expect(licenseCardSubtitle(base({ company: 'Ghawar Field' }))).toBe(
      'Saudi Arabia · Aramco · Operating',
    );
  });
});
