import type { FeatureGroup } from 'leaflet';

/** Minimal MarkerClusterGroup surface used for popup spiderfy timing. */
export type LicenseMarkerClusterGroup = FeatureGroup & {
  once(event: 'spiderfied', handler: () => void): LicenseMarkerClusterGroup;
  off(event: 'spiderfied', handler: () => void): LicenseMarkerClusterGroup;
};

export function asLicenseMarkerClusterGroup(
  layer: unknown,
): LicenseMarkerClusterGroup | null {
  if (
    layer &&
    typeof layer === 'object' &&
    'getAllChildMarkers' in layer &&
    typeof (layer as LicenseMarkerClusterGroup).once === 'function'
  ) {
    return layer as LicenseMarkerClusterGroup;
  }
  return null;
}
