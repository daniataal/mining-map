import type { MiningLicense } from '../types';

export function getLicenseRenderKey(license: MiningLicense, index: number): string {
  const stableParts = [
    license.id,
    license.company,
    license.country,
    license.region,
    license.commodity,
    license.licenseType,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

  return `${stableParts.join('::') || 'license'}::${index}`;
}
