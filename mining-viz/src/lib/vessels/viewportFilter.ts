import type { MaritimeVessel, MaritimeViewportBounds } from './types';

/** Client-side viewport filter — avoids per-pan API round-trips when a snapshot is already loaded. */
export function filterVesselsByViewport(
  vessels: MaritimeVessel[],
  bbox: MaritimeViewportBounds | null | undefined,
): MaritimeVessel[] {
  if (!bbox || vessels.length === 0) return vessels;
  const { south, west, north, east } = bbox;
  return vessels.filter(
    (vessel) =>
      vessel.lat >= south &&
      vessel.lat <= north &&
      vessel.lng >= west &&
      vessel.lng <= east,
  );
}
