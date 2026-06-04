export interface PetroleumViewportBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** One-time world bbox for oil & gas map — avoids refetching infrastructure on every pan. */
export const WORLD_PETROLEUM_PRELOAD_BBOX: PetroleumViewportBounds = {
  south: -55,
  west: -180,
  north: 84,
  east: 180,
};

/** Use tracked viewport when ready; null until the map reports bounds (avoids world Overpass/DB scans). */
export function resolvePetroleumViewportBounds(
  viewport: PetroleumViewportBounds | null | undefined,
): PetroleumViewportBounds | null {
  if (
    viewport &&
    Number.isFinite(viewport.south) &&
    Number.isFinite(viewport.west) &&
    Number.isFinite(viewport.north) &&
    Number.isFinite(viewport.east)
  ) {
    return viewport;
  }
  return null;
}
