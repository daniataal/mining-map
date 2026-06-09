import type { GeoJSONFeature, Map as MaplibreMap } from 'maplibre-gl';

export type LeafletMapClickEvent = {
  latlng: { lat: number; lng: number };
  originalEvent: MouseEvent;
};
import type { InfrastructureFeatureSelection } from '../features/infrastructure/InfrastructureFeatureDrawer';
import type { PetroleumLayerId } from './petroleumLayers';
import type { OsmPetroleumLayerId } from './osmPetroleumLayers';
import { fetchOsmInfrastructureFeature } from './osmPetroleumLayers';
import {
  OSM_VECTOR_CLICK_LAYERS,
  STYLE_LAYER_IDS,
} from './osmPetroleumVectorStyle';
import {
  classifyPipelineSubstance,
  pipelineSubstancePopupLayerId,
} from './pipelineSubstance';
import {
  buildPipelineHoverSummary,
  isGemPipelineFeature,
} from './petroleumFeatureFields';
import { fetchNearestGemPipeline } from './infrastructureCoverage';
import { gemFuelGroupToPopupLayerId } from './gemPipelineMapStyle';
import { getFeatureCoordinates } from './geojsonUtils';
import {
  pickNearestPipelineFeature,
  pipelinePickToleranceM,
  pipelineSelectionFromPick,
  haversineMeters,
} from './pipelineMapPick';
import { escapeHtml } from './htmlUtils';

const POINT_LAYER_IDS = new Set([
  STYLE_LAYER_IDS.refineries,
  STYLE_LAYER_IDS.storage,
]);

function mvtQueryPadPx(mapZoom: number | undefined): number {
  const z = mapZoom ?? 8;
  if (z >= 14) return 36;
  if (z >= 11) return 30;
  return 24;
}
const OSM_VECTOR_LAYER_ID_SET = new Set<string>(OSM_VECTOR_CLICK_LAYERS);

let registeredMvtMap: MaplibreMap | null = null;

/** Register the MapLibre map used for OSM MVT rendering (visual-only canvas). */
export function registerOsmMvtMaplibreMap(map: MaplibreMap): void {
  registeredMvtMap = map;
}

/** Unregister when the MVT layer is removed. */
export function unregisterOsmMvtMaplibreMap(map: MaplibreMap): void {
  if (registeredMvtMap === map) {
    registeredMvtMap = null;
  }
}

export function getRegisteredOsmMvtMaplibreMap(): MaplibreMap | null {
  return registeredMvtMap;
}

export function leafletPointToMaplibre(
  e: LeafletMapClickEvent,
  mlMap: MaplibreMap,
): { x: number; y: number } {
  const rect = mlMap.getContainer().getBoundingClientRect();
  return {
    x: e.originalEvent.clientX - rect.left,
    y: e.originalEvent.clientY - rect.top,
  };
}

export function queryOsmFeaturesAtPoint(
  map: MaplibreMap,
  point: { x: number; y: number },
  layers: string[],
  mapZoom?: number,
): GeoJSONFeature[] {
  const pad = mvtQueryPadPx(mapZoom);
  const box: [[number, number], [number, number]] = [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ];
  let features = layers.length ? map.queryRenderedFeatures(box, { layers }) : [];
  if (!features.length) {
    features = map
      .queryRenderedFeatures(box)
      .filter((feature) => OSM_VECTOR_LAYER_ID_SET.has(feature.layer.id));
  }
  return features as GeoJSONFeature[];
}

/** Prefer point features over pipeline lines when both overlap at the same pixel. */
export function pickTopOsmMvtFeature(features: GeoJSONFeature[]): GeoJSONFeature | null {
  if (!features.length) return null;
  const pointHit = features.find((f) => POINT_LAYER_IDS.has(f.layer.id));
  return pointHit ?? features[0];
}

export function osmLayerFromProperties(props: Record<string, unknown>): OsmPetroleumLayerId {
  const layerId = String(props.layer_id ?? '');
  if (layerId === 'refineries' || layerId === 'storage_terminals' || layerId === 'pipelines') {
    return layerId;
  }
  return 'pipelines';
}

export function osmLayerToPopupLayerId(
  layerId: OsmPetroleumLayerId,
  props: Record<string, unknown>,
): PetroleumLayerId {
  if (layerId === 'pipelines') {
    return pipelineSubstancePopupLayerId(classifyPipelineSubstance(props));
  }
  return 'refineries';
}

/** OSM point features use Leaflet popups; pipelines keep the side drawer. */
export function infrastructureSelectionUsesPopup(
  selection: InfrastructureFeatureSelection,
): boolean {
  return selection.layerId === 'refineries' || selection.layerId === 'storage_terminals';
}

export function featureSelectionFromMvt(
  props: Record<string, unknown>,
  lngLat: { lng: number; lat: number } | null,
): InfrastructureFeatureSelection {
  const layerId = osmLayerFromProperties(props);
  return {
    layerId,
    popupLayerId: osmLayerToPopupLayerId(layerId, props),
    properties: props,
    geometry: lngLat
      ? { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }
      : null,
    coordinates: lngLat ? { lat: lngLat.lat, lng: lngLat.lng } : null,
  };
}

export function hoverHtmlForOsmFeature(
  props: Record<string, unknown>,
  layerId: OsmPetroleumLayerId,
): string {
  if (layerId === 'pipelines') {
    const summary = buildPipelineHoverSummary(props);
    return `<span class="font-semibold">${escapeHtml(summary.title)}</span>${
      summary.subtitle
        ? `<br/><span class="text-slate-300/90">${escapeHtml(summary.subtitle)}</span>`
        : ''
    }`;
  }
  const name = String(props.name ?? '').trim();
  if (name) return escapeHtml(name);
  const operator = String(props.operator ?? '').trim();
  if (operator) return escapeHtml(operator);
  if (layerId === 'refineries') return 'OSM refinery';
  return 'OSM storage';
}

export function markMapFeatureClickHandled(e: LeafletMapClickEvent): void {
  const oe = e.originalEvent as MouseEvent & { __mapFeatureClickHandled?: boolean };
  if (oe) oe.__mapFeatureClickHandled = true;
}

export function pointPickToleranceM(mapZoom: number | undefined): number {
  const z = mapZoom ?? 8;
  if (z >= 14) return 900;
  if (z >= 12) return 1200;
  if (z >= 9) return 1800;
  if (z >= 6) return 2800;
  return 4500;
}

function pointCoordsFromGeometry(geometry: GeoJSON.Geometry): { lat: number; lng: number } | null {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length) {
    const [lng, lat] = geometry.coordinates[0] as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return getFeatureCoordinates(geometry);
}

export type PointPickCandidate = {
  feature: GeoJSON.Feature;
  layerId: OsmPetroleumLayerId;
  distanceM: number;
};

export function pickNearestPointFeature(
  features: GeoJSON.Feature[],
  lat: number,
  lng: number,
  maxDistanceM: number,
  layerId: OsmPetroleumLayerId,
): PointPickCandidate | null {
  let best: PointPickCandidate | null = null;

  for (const feature of features) {
    if (!feature.geometry) continue;
    const coords = pointCoordsFromGeometry(feature.geometry);
    if (!coords) continue;
    const d = haversineMeters(lat, lng, coords.lat, coords.lng);
    if (d <= maxDistanceM && (!best || d < best.distanceM)) {
      best = { feature, layerId, distanceM: d };
    }
  }

  return best;
}

export function pointSelectionFromPick(
  pick: PointPickCandidate,
): InfrastructureFeatureSelection {
  const props = (pick.feature.properties || {}) as Record<string, unknown>;
  const geometry = pick.feature.geometry ?? null;
  return {
    layerId: pick.layerId,
    popupLayerId: osmLayerToPopupLayerId(pick.layerId, props),
    properties: props,
    geometry,
    coordinates: getFeatureCoordinates(geometry),
  };
}

export type InfrastructurePickResult =
  | { kind: 'mvt'; feature: GeoJSONFeature; layerId: OsmPetroleumLayerId }
  | { kind: 'point'; pick: PointPickCandidate }
  | { kind: 'pipeline'; pick: ReturnType<typeof pickNearestPipelineFeature> & object };

function pickMvtPointFeature(
  mvtMap: MaplibreMap,
  leafletEvent: LeafletMapClickEvent,
  mapZoom?: number,
): InfrastructurePickResult | null {
  const pointLayers = OSM_VECTOR_CLICK_LAYERS.filter(
    (id) => POINT_LAYER_IDS.has(id) && mvtMap.getLayer(id),
  );
  if (!pointLayers.length) return null;
  const point = leafletPointToMaplibre(leafletEvent, mvtMap);
  const mvtFeatures = queryOsmFeaturesAtPoint(mvtMap, point, pointLayers, mapZoom);
  const top = pickTopOsmMvtFeature(mvtFeatures);
  if (!top) return null;
  const props = (top.properties ?? {}) as Record<string, unknown>;
  const layerId = osmLayerFromProperties(props);
  if (layerId !== 'refineries' && layerId !== 'storage_terminals') return null;
  return { kind: 'mvt', feature: top, layerId };
}

function pickMvtPipelineFeature(
  mvtMap: MaplibreMap,
  leafletEvent: LeafletMapClickEvent,
  mapZoom?: number,
): InfrastructurePickResult | null {
  const pipelineLayers = OSM_VECTOR_CLICK_LAYERS.filter(
    (id) => !POINT_LAYER_IDS.has(id) && mvtMap.getLayer(id),
  );
  if (!pipelineLayers.length) return null;
  const point = leafletPointToMaplibre(leafletEvent, mvtMap);
  const mvtFeatures = queryOsmFeaturesAtPoint(mvtMap, point, pipelineLayers, mapZoom);
  const top = pickTopOsmMvtFeature(mvtFeatures);
  if (!top) return null;
  const props = (top.properties ?? {}) as Record<string, unknown>;
  return {
    kind: 'mvt',
    feature: top,
    layerId: osmLayerFromProperties(props),
  };
}

export function pickInfrastructureAtClick(opts: {
  mvtMap: MaplibreMap | null;
  leafletEvent: LeafletMapClickEvent;
  mvtMode: boolean;
  pipelineFeatures: GeoJSON.Feature[];
  refineryFeatures: GeoJSON.Feature[];
  storageFeatures: GeoJSON.Feature[];
  mapZoom?: number;
  loadPipelines: boolean;
  loadRefineries: boolean;
  loadStorage: boolean;
}): InfrastructurePickResult | null {
  const { lat, lng } = opts.leafletEvent.latlng;
  const pointTol = pointPickToleranceM(opts.mapZoom);
  const pipelineTol = pipelinePickToleranceM(opts.mapZoom);

  const gemPipelineFeatures = opts.pipelineFeatures.filter((feature) =>
    isGemPipelineFeature((feature.properties ?? {}) as Record<string, unknown>),
  );
  if (opts.loadPipelines && gemPipelineFeatures.length) {
    const gemPick = pickNearestPipelineFeature(gemPipelineFeatures, lat, lng, pipelineTol);
    if (gemPick) return { kind: 'pipeline', pick: gemPick };
  }

  if (opts.mvtMode && opts.mvtMap?.loaded()) {
    const pointPick = pickMvtPointFeature(opts.mvtMap, opts.leafletEvent, opts.mapZoom);
    if (pointPick) return pointPick;
  }

  if (opts.loadRefineries && opts.refineryFeatures.length) {
    const refineryPick = pickNearestPointFeature(
      opts.refineryFeatures,
      lat,
      lng,
      pointTol,
      'refineries',
    );
    if (refineryPick) return { kind: 'point', pick: refineryPick };
  }
  if (opts.loadStorage && opts.storageFeatures.length) {
    const storagePick = pickNearestPointFeature(
      opts.storageFeatures,
      lat,
      lng,
      pointTol,
      'storage_terminals',
    );
    if (storagePick) return { kind: 'point', pick: storagePick };
  }

  if (opts.loadPipelines && opts.pipelineFeatures.length) {
    const pipelinePick = pickNearestPipelineFeature(opts.pipelineFeatures, lat, lng, pipelineTol);
    if (pipelinePick) return { kind: 'pipeline', pick: pipelinePick };
  }

  if (opts.loadPipelines && opts.mvtMode && opts.mvtMap?.loaded()) {
    const mvtPipeline = pickMvtPipelineFeature(opts.mvtMap, opts.leafletEvent, opts.mapZoom);
    if (mvtPipeline) return mvtPipeline;
  }

  return null;
}

/** When an OSM pipeline was picked, fuse nearby GEM commercial fields for the rich drawer. */
export async function enrichPipelineSelectionWithNearestGem(
  selection: InfrastructureFeatureSelection,
  signal?: AbortSignal,
): Promise<InfrastructureFeatureSelection> {
  if (selection.layerId !== 'pipelines') return selection;
  if (isGemPipelineFeature(selection.properties)) return selection;
  const coords = selection.coordinates;
  if (!coords) return selection;
  try {
    const nearest = await fetchNearestGemPipeline(coords.lat, coords.lng, signal);
    if (!nearest.found || !nearest.tags) return selection;
    const tags = nearest.tags;
    return {
      ...selection,
      popupLayerId: gemFuelGroupToPopupLayerId(String(tags.fuel_group || tags.Fuel || '')),
      properties: {
        ...tags,
        ...selection.properties,
        layer_id: 'gem_pipelines',
        source: tags.source ?? 'gem_goit_oil_ngl_pipelines_march_2025',
        gem_fused_from_osm: true,
        gem_match_distance_m: nearest.distance_m,
      },
    };
  } catch {
    return selection;
  }
}

export function selectionFromInfrastructurePick(
  result: InfrastructurePickResult,
  click: { lat: number; lng: number },
): InfrastructureFeatureSelection {
  if (result.kind === 'mvt') {
    const props = (result.feature.properties ?? {}) as Record<string, unknown>;
    return featureSelectionFromMvt(props, click);
  }
  if (result.kind === 'point') {
    return pointSelectionFromPick(result.pick);
  }
  return pipelineSelectionFromPick(result.pick, click);
}

/** Enrich OSM selection with full tags; returns updated properties or original on failure. */
export async function enrichOsmSelectionProperties(
  selection: InfrastructureFeatureSelection,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const props = selection.properties;
  const osmId = props.osm_id;
  const osmType = props.osm_type;
  if (osmId == null || osmType == null) return props;
  if (selection.layerId !== 'pipelines' && selection.layerId !== 'refineries' && selection.layerId !== 'storage_terminals') {
    return props;
  }
  try {
    const full = await fetchOsmInfrastructureFeature(
      selection.layerId,
      String(osmType),
      Number(osmId),
      signal,
    );
    if (full) {
      return { ...full, ...props, layer_id: selection.layerId };
    }
  } catch {
    /* viewport / MVT props are enough when detail lookup fails */
  }
  return props;
}
