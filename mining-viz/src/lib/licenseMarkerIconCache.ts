import type { DivIcon } from 'leaflet';

type IconEntry = { sig: string; icon: DivIcon };

/** Reuse DivIcon instances per license id so react-leaflet does not call setIcon on every parent render. */
export function createLicenseMarkerIconCache() {
  const cache = new Map<string, IconEntry>();

  return {
    get(id: string, sig: string, factory: () => DivIcon): DivIcon {
      const hit = cache.get(id);
      if (hit && hit.sig === sig) return hit.icon;
      const icon = factory();
      cache.set(id, { sig, icon });
      return icon;
    },
    prune(validIds: Set<string>) {
      for (const key of cache.keys()) {
        if (!validIds.has(key)) cache.delete(key);
      }
    },
  };
}

export function markerIconSignature(
  color: string,
  isEsgRisk: boolean,
  refineryPin: boolean,
  oilFieldPin: boolean,
  isDark = true,
): string {
  return `${color}|${isEsgRisk ? 1 : 0}|${refineryPin ? 'r' : oilFieldPin ? 'o' : 'd'}|${isDark ? 'd' : 'l'}`;
}
