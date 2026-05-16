import type { MiningLicense } from '../types';

export type LicenseHeroImageKey = 'gold' | 'diamond' | 'oil_gas' | 'mining';

const HERO_IMAGE_PATHS: Record<LicenseHeroImageKey, string> = {
  gold: '/assets/commodities/gold.png',
  diamond: '/assets/commodities/diamond.png',
  oil_gas: '/assets/commodities/oil-gas.png',
  mining: '/assets/commodities/mining.png',
};

/** True when commodity text indicates oil, gas, or petroleum (not mining support services). */
export function isOilGasCommodityText(commodity?: string | null): boolean {
  const normalized = (commodity || '').toLowerCase();
  if (!normalized) return false;
  if (
    normalized.includes('oil') ||
    normalized.includes('petroleum') ||
    normalized.includes('crude') ||
    normalized.includes('hydrocarbon') ||
    normalized.includes('brent') ||
    normalized.includes('barrel')
  ) {
    return true;
  }
  if (
    normalized.includes('lng') ||
    normalized.includes('lpg') ||
    normalized.includes('natural gas') ||
    normalized.includes('offshore gas')
  ) {
    return true;
  }
  if (/\boil\s*&\s*gas\b/.test(normalized) || normalized.includes('oil and gas')) {
    return true;
  }
  return false;
}

export function isOilAndGasLicense(
  sector?: string | null,
  commodity?: string | null
): boolean {
  const sectorNorm = (sector || '').toLowerCase();
  if (sectorNorm === 'oil_and_gas' || sectorNorm === 'oil') return true;
  return isOilGasCommodityText(commodity);
}

export function inferLicenseHeroImageKey(
  commodity?: string | null,
  sector?: string | null
): LicenseHeroImageKey {
  const normalized = (commodity || '').toLowerCase();
  if (normalized.includes('gold')) return 'gold';
  if (normalized.includes('diamond')) return 'diamond';
  if (isOilAndGasLicense(sector, commodity)) return 'oil_gas';
  return 'mining';
}

export function getLicenseHeroImageUrl(
  license: Pick<MiningLicense, 'commodity' | 'sector'> & { photoUrl?: string | null }
): string {
  const custom = (license.photoUrl || '').trim();
  if (custom) return custom;
  const key = inferLicenseHeroImageKey(license.commodity, license.sector);
  return HERO_IMAGE_PATHS[key];
}

export function getLicenseVolumeUnit(
  sector?: string | null,
  commodity?: string | null
): 'KG' | 'BBL' {
  return isOilAndGasLicense(sector, commodity) ? 'BBL' : 'KG';
}
