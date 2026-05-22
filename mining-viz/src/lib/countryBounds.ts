import L from 'leaflet';
import type { MaritimeViewportBounds } from '../types';

export type LicenseViewportBounds = MaritimeViewportBounds;

const DEFAULT_PAD_DEGREES = 0.35;

/** Axis-aligned bounds for license viewport fetch from country-border GeoJSON. */
export function licenseViewportBoundsFromGeoJson(
  geojson: object | null | undefined,
  padDegrees = DEFAULT_PAD_DEGREES,
): LicenseViewportBounds | null {
  if (!geojson) return null;
  try {
    const layer = L.geoJSON(geojson as GeoJSON.GeoJsonObject);
    const bounds = layer.getBounds();
    if (!bounds.isValid()) return null;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    return {
      south: sw.lat - padDegrees,
      west: sw.lng - padDegrees,
      north: ne.lat + padDegrees,
      east: ne.lng + padDegrees,
    };
  } catch {
    return null;
  }
}

/** Wide hub used until country borders load or for multi-country fetches. */
export const LICENSE_COUNTRY_FETCH_HUB: LicenseViewportBounds = {
  south: -60,
  west: -180,
  north: 72,
  east: 180,
};
