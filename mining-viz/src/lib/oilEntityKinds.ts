import type { MiningLicense } from '../types';
import { isOilAndGasLicense } from './licenseHeroImage';

/** Curated or ingested refinery rows (licenses table or petroleum layer). */
export function isFuelMarketerEntity(
  item: Pick<MiningLicense, 'entitySubtype' | 'licenseType' | 'sector' | 'commodity'>
): boolean {
  const sub = (item.entitySubtype || '').trim().toLowerCase();
  if (sub === 'fuel_marketer' || sub === 'petroleum_products_license') return true;
  if (!isOilAndGasLicense(item.sector, item.commodity)) return false;
  const lt = (item.licenseType || '').trim().toLowerCase();
  return (
    lt.includes('fuel marketing') ||
    lt.includes('products marketing') ||
    lt.includes('oil marketing company') ||
    lt.includes('petroleum products marketing')
  );
}

/** Curated or ingested refinery rows (licenses table or petroleum layer). */
export function isRefineryEntity(
  item: Pick<MiningLicense, 'entitySubtype' | 'licenseType' | 'sector' | 'commodity'>
): boolean {
  const sub = (item.entitySubtype || '').trim().toLowerCase();
  if (sub === 'oil_field') return false;
  if (sub === 'refinery' || sub === 'refinery_complex') return true;

  if (!isOilAndGasLicense(item.sector, item.commodity)) return false;

  const lt = (item.licenseType || '').trim().toLowerCase();
  return lt.includes('refinery') || lt.includes('refining');
}

/** Producing field / well cluster — not a refinery (e.g. Zakum). */
export function isOilFieldEntity(
  item: Pick<MiningLicense, 'entitySubtype' | 'licenseType' | 'sector' | 'commodity'>
): boolean {
  const sub = (item.entitySubtype || '').trim().toLowerCase();
  if (sub === 'oil_field') return true;
  if (!isOilAndGasLicense(item.sector, item.commodity)) return false;
  const lt = (item.licenseType || '').trim().toLowerCase();
  if (lt.includes('oil field') || lt.includes('offshore field') || lt.includes('giant oil field')) {
    return true;
  }
  return false;
}
