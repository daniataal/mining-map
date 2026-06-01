import type { FeatureGroup, Layer, Marker } from 'leaflet';

/** Minimal MarkerClusterGroup surface used for popup spiderfy timing. */
export type LicenseMarkerClusterGroup = FeatureGroup & {
  once(event: 'spiderfied', handler: () => void): LicenseMarkerClusterGroup;
  off(event: 'spiderfied', handler: () => void): LicenseMarkerClusterGroup;
  getVisibleParent?: (marker: Marker) => Layer | null;
  zoomToShowLayer?: (layer: Layer, callback?: () => void) => void;
};

export function asLicenseMarkerClusterGroup(
  layer: unknown,
): LicenseMarkerClusterGroup | null {
  if (
    layer &&
    typeof layer === 'object' &&
    typeof (layer as LicenseMarkerClusterGroup).once === 'function' &&
    typeof (layer as LicenseMarkerClusterGroup).off === 'function' &&
    (
      typeof (layer as LicenseMarkerClusterGroup).getVisibleParent === 'function' ||
      typeof (layer as LicenseMarkerClusterGroup).zoomToShowLayer === 'function'
    )
  ) {
    return layer as LicenseMarkerClusterGroup;
  }
  return null;
}
