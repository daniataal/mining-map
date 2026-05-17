import type { MiningLicense } from '../types';

/** Curated or ingested refinery rows (licenses table or petroleum layer). */
export function isRefineryEntity(item: Pick<MiningLicense, 'entitySubtype' | 'licenseType'>): boolean {
  const sub = (item.entitySubtype || '').trim().toLowerCase();
  if (sub === 'refinery' || sub === 'refinery_complex') return true;
  const lt = (item.licenseType || '').trim().toLowerCase();
  return lt.includes('refinery') || lt.includes('refining');
}
