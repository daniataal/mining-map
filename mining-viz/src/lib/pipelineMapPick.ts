import type { InfrastructureFeatureSelection } from '../features/infrastructure/InfrastructureFeatureDrawer';
import type { PetroleumLayerId } from './petroleumLayers';
import { pipelineClickCoordinates } from './petroleumFeatureFields';
import { classifyPipelineSubstance, pipelineSubstancePopupLayerId } from './pipelineSubstance';

export type PipelinePickCandidate = {
  feature: GeoJSON.Feature;
  popupLayerId: PetroleumLayerId;
  osmLayerId: 'pipelines';
  distanceM: number;
};

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in meters between two WGS84 points. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distance from point P to segment AB in meters (equirectangular approx). */
export function pointToSegmentMeters(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const cosLat = Math.cos(toRad((aLat + bLat + pLat) / 3));
  const ax = aLng * cosLat;
  const ay = aLat;
  const bx = bLng * cosLat;
  const by = bLat;
  const px = pLng * cosLat;
  const py = pLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-18) {
    return haversineMeters(pLat, pLng, aLat, aLng);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const cLng = cx / cosLat;
  return haversineMeters(pLat, pLng, cy, cLng);
}

function lineStringsFromGeometry(geometry: GeoJSON.Geometry): [number, number][][] {
  if (geometry.type === 'LineString') {
    return [geometry.coordinates as [number, number][]];
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates as [number, number][][];
  }
  return [];
}

/** Pick nearest pipeline feature to a map click within tolerance. */
export function pickNearestPipelineFeature(
  features: GeoJSON.Feature[],
  lat: number,
  lng: number,
  maxDistanceM: number,
): PipelinePickCandidate | null {
  let best: PipelinePickCandidate | null = null;

  for (const feature of features) {
    if (!feature.geometry) continue;
    const lines = lineStringsFromGeometry(feature.geometry);
    if (!lines.length) continue;

    const props = (feature.properties || {}) as Record<string, unknown>;
    const popupLayerId = pipelineSubstancePopupLayerId(classifyPipelineSubstance(props));

    let featureBest = Infinity;
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const [lng0, lat0] = line[i];
        const [lng1, lat1] = line[i + 1];
        if (
          !Number.isFinite(lat0) ||
          !Number.isFinite(lng0) ||
          !Number.isFinite(lat1) ||
          !Number.isFinite(lng1)
        ) {
          continue;
        }
        const d = pointToSegmentMeters(lat, lng, lat0, lng0, lat1, lng1);
        if (d < featureBest) featureBest = d;
      }
    }

    if (featureBest <= maxDistanceM && (!best || featureBest < best.distanceM)) {
      best = {
        feature,
        popupLayerId,
        osmLayerId: 'pipelines',
        distanceM: featureBest,
      };
    }
  }

  return best;
}

export function pipelineSelectionFromPick(
  pick: PipelinePickCandidate,
  click: { lat: number; lng: number },
): InfrastructureFeatureSelection {
  const props = (pick.feature.properties || {}) as Record<string, unknown>;
  return {
    layerId: 'pipelines',
    popupLayerId: pick.popupLayerId,
    properties: props,
    geometry: pick.feature.geometry ?? null,
    coordinates: pipelineClickCoordinates(pick.feature.geometry ?? null, click),
  };
}

/** Zoom-aware click tolerance — wider when zoomed out. */
export function pipelinePickToleranceM(mapZoom: number | undefined): number {
  const z = mapZoom ?? 8;
  if (z >= 12) return 800;
  if (z >= 9) return 1500;
  if (z >= 6) return 3000;
  return 6000;
}
