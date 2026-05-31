import type { LatLngTuple } from '../corridorGeometry';

/** Great-circle segment between two WGS84 points (indicative sea path, not routed lanes). */
export function greatCirclePath(
  from: LatLngTuple,
  to: LatLngTuple,
  steps = 24,
): LatLngTuple[] {
  const [aLat, aLng] = from;
  const [bLat, bLng] = to;
  const lat1 = (aLat * Math.PI) / 180;
  const lng1 = (aLng * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const lng2 = (bLng * Math.PI) / 180;
  const delta =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
      ),
    );
  if (delta < 1e-9) return [from, to];
  const out: LatLngTuple[] = [];
  const n = Math.max(2, steps);
  for (let i = 0; i <= n; i += 1) {
    const f = i / n;
    const aa = Math.sin((1 - f) * delta) / Math.sin(delta);
    const bb = Math.sin(f * delta) / Math.sin(delta);
    const x = aa * Math.cos(lat1) * Math.cos(lng1) + bb * Math.cos(lat2) * Math.cos(lng2);
    const y = aa * Math.cos(lat1) * Math.sin(lng1) + bb * Math.cos(lat2) * Math.sin(lng2);
    const z = aa * Math.sin(lat1) + bb * Math.sin(lat2);
    const lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
    const lng = (Math.atan2(y, x) * 180) / Math.PI;
    out.push([lat, lng]);
  }
  return out;
}
