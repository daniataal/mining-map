/** OSM-only petroleum map when Mapbox/oilmap layers are disabled server-side. */

export function isPetroleumMapboxDisabledEnv(): boolean {
  const v = String(import.meta.env.VITE_PETROLEUM_DISABLE_MAPBOX ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function catalogMapboxDisabled(catalog?: { mapbox_disabled?: boolean } | null): boolean {
  return Boolean(catalog?.mapbox_disabled);
}
