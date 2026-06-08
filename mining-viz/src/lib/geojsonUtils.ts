/**
 * Shared GeoJSON geometry helpers — replacing verbatim duplicates
 * in GemGgitLngMapLayer, GemGogptPlantMapLayer, bindPetroleumPopup,
 * and OsmPetroleumMapLayersGeoJson.
 */

/**
 * Extract [lat, lng] from a Point geometry suitable for Leaflet CircleMarker.
 * Returns null for non-Point geometries or invalid coordinates.
 */
export function pointCoords(
  geometry: GeoJSON.Geometry | null | undefined,
): [number, number] | null {
  if (!geometry || geometry.type !== 'Point') return null;
  const [lng, lat] = geometry.coordinates as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

/**
 * Extract { lat, lng } from a Point or MultiPoint geometry.
 * Used for popup positioning and coordinate display.
 */
export function getFeatureCoordinates(
  geometry: GeoJSON.Geometry | null | undefined,
): { lat: number; lng: number } | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  }
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length > 0) {
    const [lng, lat] = geometry.coordinates[0] as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}
