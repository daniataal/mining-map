import { describe, expect, it } from 'vitest';
import { findDossierLicenseForOilCompany } from './liveDataDossier';
import type { MiningLicense } from '../../types';

describe('liveDataDossier', () => {
  const licenses: MiningLicense[] = [
    {
      id: 'lic-1',
      company: 'Acme Petroleum Ltd',
      country: 'Ghana',
      lat: 5.6,
      lng: -0.2,
      licenseType: 'Exploration',
      status: 'Operating',
    },
  ];

  const entityIndex = Object.fromEntries(licenses.map((l) => [l.id, l]));

  it('prefers supplier_id when present in entity index', () => {
    const lic = findDossierLicenseForOilCompany(
      { id: 'co-1', name: 'Other Co', supplier_id: 'lic-1' },
      entityIndex,
      licenses,
    );
    expect(lic?.id).toBe('lic-1');
  });

  it('falls back to normalized company name match', () => {
    const lic = findDossierLicenseForOilCompany(
      { id: 'co-2', name: 'Acme Petroleum Limited', supplier_id: null },
      {},
      licenses,
    );
    expect(lic?.company).toBe('Acme Petroleum Ltd');
  });
});
