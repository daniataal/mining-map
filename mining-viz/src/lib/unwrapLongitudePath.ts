import type { LatLngTuple } from './corridorGeometry';

/**
 * Adjust longitudes so Leaflet draws the short great-circle path across the
 * map instead of wrapping the long way (vertical "spikes" through the poles).
 */
export function unwrapLongitudePath(points: LatLngTuple[]): LatLngTuple[] {
  if (points.length < 2) return points;
  const out: LatLngTuple[] = [[points[0][0], points[0][1]]];
  let prevLng = points[0][1];
  for (let i = 1; i < points.length; i++) {
    let lng = points[i][1];
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    out.push([points[i][0], lng]);
    prevLng = lng;
  }
  return out;
}
