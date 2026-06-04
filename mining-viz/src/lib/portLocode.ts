import type { MiningLicense } from '../types';

/** Resolve UN/LOCODE (e.g. AEFJR) from a map entity for port-directory APIs. */
export function resolvePortLocode(
  item: Pick<MiningLicense, 'locode' | 'id' | 'countryIso2'>,
): string | null {
  const direct = (item.locode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (direct.length >= 5) return direct;

  const id = (item.id || '').trim();
  if (id.toLowerCase().startsWith('unlocode:')) {
    const code = id.slice('unlocode:'.length).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length >= 5) return code;
  }
  return null;
}
