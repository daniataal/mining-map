import type { MiningLicense } from '../types';

const STORAGE_ENTITY_KINDS = new Set([
  'storage_terminal',
  'storage_tank',
  'tank_farm',
]);

export function isStorageMapEntity(item: Pick<MiningLicense, 'entityKind' | 'entitySubtype'>): boolean {
  if (item.entityKind && STORAGE_ENTITY_KINDS.has(item.entityKind)) return true;
  if (item.entitySubtype && STORAGE_ENTITY_KINDS.has(item.entitySubtype)) return true;
  return false;
}
