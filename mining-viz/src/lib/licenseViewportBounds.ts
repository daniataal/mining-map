import type { MaritimeViewportBounds } from '../types';

export type LicenseViewportBounds = MaritimeViewportBounds;

/** Wrap longitude to [-180, 180] (Leaflet can emit multi-world west/east). */
export function wrapLongitude(lng: number): number {
  if (!Number.isFinite(lng)) return 0;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Clamp/wrap license map bbox before GET /licenses (prevents e.g. min_lng=-1254). */
export function normalizeLicenseViewportBounds(
  bounds: LicenseViewportBounds,
): LicenseViewportBounds {
  let south = Math.max(-90, Math.min(90, bounds.south));
  let north = Math.max(-90, Math.min(90, bounds.north));
  if (south > north) {
    const swap = south;
    south = north;
    north = swap;
  }

  let west = wrapLongitude(bounds.west);
  let east = wrapLongitude(bounds.east);

  if (west > east) {
    west = -180;
    east = 180;
  }

  if (east - west > 360) {
    west = -180;
    east = 180;
  }

  return { south, west, north, east };
}

/** Coarsen bbox so tiny pans do not refetch (≈0.25° grid). */
export function quantizeLicenseViewportBounds(
  bounds: LicenseViewportBounds,
): LicenseViewportBounds {
  const normalized = normalizeLicenseViewportBounds(bounds);
  const span = Math.max(
    Math.abs(normalized.north - normalized.south),
    Math.abs(normalized.east - normalized.west),
  );
  // At close zoom levels (tiny span), use a very fine quantization grid to prevent points disappearing during pans.
  const step = span < 0.05 ? 0.005 : span < 0.2 ? 0.02 : 0.25;
  const q = (n: number) => Math.round(n / step) * step;
  return {
    south: q(normalized.south),
    west: q(normalized.west),
    north: q(normalized.north),
    east: q(normalized.east),
  };
}
