import type { LatLngTuple } from '../corridorGeometry';
import { unwrapLongitudePath } from '../unwrapLongitudePath';

export type VesselTrackPoint = {
  received_at?: string;
  latitude?: number;
  longitude?: number;
  speed_over_ground?: number | null;
  course_over_ground?: number | null;
};

export type VesselTrackResponse = {
  points?: VesselTrackPoint[];
  unavailable?: boolean;
  mmsi?: number;
  hours?: number;
};

export type VesselTrackSummary = {
  pointCount: number;
  fromLabel: string | null;
  toLabel: string | null;
};

function isValidCoord(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** Normalize API track points to map polylines (chronological, deduped). */
export function trackPointsToPath(points: VesselTrackPoint[] | undefined): LatLngTuple[] {
  if (!points?.length) return [];
  const path: LatLngTuple[] = [];
  let prevKey = '';
  for (const point of points) {
    const lat = point.latitude;
    const lng = point.longitude;
    if (!isValidCoord(lat, lng)) continue;
    const key = `${lat.toFixed(5)}|${lng.toFixed(5)}`;
    if (key === prevKey) continue;
    prevKey = key;
    path.push([lat, lng]);
  }
  return unwrapLongitudePath(path);
}

export function summarizeVesselTrack(points: VesselTrackPoint[] | undefined): VesselTrackSummary {
  const valid = (points ?? []).filter((p) => isValidCoord(p.latitude, p.longitude));
  const from = valid[0]?.received_at ?? null;
  const to = valid[valid.length - 1]?.received_at ?? null;
  const fmt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
  };
  return {
    pointCount: valid.length,
    fromLabel: fmt(from),
    toLabel: fmt(to),
  };
}
