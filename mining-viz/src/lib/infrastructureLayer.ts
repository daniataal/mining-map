import type { OsmPetroleumLayerId } from './osmPetroleumLayers';

/** Infrastructure features unlock at this zoom unless the user toggles a layer on earlier. */
export const INFRASTRUCTURE_MIN_DETAIL_ZOOM = 9;

/** OSM pipeline MVT tiles are generated from this zoom (catalog min_zoom=4). */
export const PIPELINE_MVT_MIN_ZOOM = 4;

/** Refineries are strategic anchor assets and can be shown before dense point layers. */
export const REFINERY_MVT_MIN_ZOOM = 6;

/** Individual OSM storage points are too dense globally; aggregate canvas handles low zoom. */
export const STORAGE_INDIVIDUAL_MIN_ZOOM = 10;

/** Lightweight MVT overview keeps tank farms visible without the global cyan carpet. */
export const STORAGE_OVERVIEW_MIN_ZOOM = 4;

/** Leaflet GeoJSON fallback only — viewport fetch; GeoJSON API is slow at scale. */
export const PIPELINE_LEAFLET_MIN_ZOOM = 5;

/** Port markers are omitted below this zoom to avoid world-scale dot clutter. */
export const PORT_MARKERS_MIN_ZOOM = 6;

/** Hide OSM storage MVT circles once interactive tank-farm markers are shown. */
export const STORAGE_MVT_HIDE_MIN_ZOOM = 10;

export const INFRASTRUCTURE_BOL_TIER = 'infrastructure_open' as const;

export const INFRASTRUCTURE_DISCLAIMER_EN =
  'OpenStreetMap community map data — not verified facility ownership, throughput, or regulatory status. Confirm against operator filings and on-site intelligence before trading decisions.';

export const INFRASTRUCTURE_DISCLAIMER_HE =
  'נתוני מפה קהילתיים מ-OpenStreetMap — לא אומתו בעלות, תפוקה או סטטוס רגולטורי. יש לאמת מול דיווחי מפעיל ומודיעין שטח לפני החלטות מסחר.';

export function infrastructureLayerExplicitlyEnabled(
  visibility: Partial<Record<OsmPetroleumLayerId, boolean>>,
): boolean {
  return Object.values(visibility).some(Boolean);
}

/** Layer checkbox is on and zoom / explicit-toggle rules allow fetch + render. */
export function infrastructureLayerShouldRender(
  layerId: OsmPetroleumLayerId,
  mapZoom: number | undefined,
  visibility: Partial<Record<OsmPetroleumLayerId, boolean>>,
  forcedLayers: Partial<Record<OsmPetroleumLayerId, boolean>>,
): boolean {
  if (!visibility[layerId]) return false;
  if (Boolean(forcedLayers[layerId]) && layerId !== 'storage_terminals') return true;
  const minZoom =
    layerId === 'pipelines'
      ? PIPELINE_MVT_MIN_ZOOM
      : layerId === 'refineries'
        ? REFINERY_MVT_MIN_ZOOM
        : STORAGE_INDIVIDUAL_MIN_ZOOM;
  return mapZoom != null && mapZoom >= minZoom;
}

export function pipelineLeafletShouldFetch(
  mapZoom: number | undefined,
  visible: boolean,
): boolean {
  if (!visible) return false;
  return mapZoom != null && mapZoom >= PIPELINE_LEAFLET_MIN_ZOOM;
}

export function storageMvtOverviewShouldRender(
  mapZoom: number | undefined,
  visible: boolean,
): boolean {
  return osmPointMvtOverviewShouldRender(mapZoom, visible);
}

/**
 * Keep OSM MVT storage dots when canvas has no replacement entities in view.
 * Hide MVT overview only once interactive canvas markers cover the same viewport.
 */
export function storageOsmMvtShouldRender(
  mapZoom: number | undefined,
  visible: boolean,
  canvasEntitiesInView: number,
): boolean {
  if (!storageMvtOverviewShouldRender(mapZoom, visible)) return false;
  if (canvasEntitiesInView <= 0) return true;
  if (mapZoom == null || mapZoom < STORAGE_MVT_HIDE_MIN_ZOOM) return true;
  return false;
}

/** Lightweight MVT circles for refineries and storage — visible at regional zoom without dense dots. */
export function osmPointMvtOverviewShouldRender(
  mapZoom: number | undefined,
  visible: boolean,
): boolean {
  if (!visible) return false;
  return mapZoom != null && mapZoom >= STORAGE_OVERVIEW_MIN_ZOOM;
}

export function refineryMvtOverviewShouldRender(
  mapZoom: number | undefined,
  visible: boolean,
): boolean {
  return osmPointMvtOverviewShouldRender(mapZoom, visible);
}

/** True when a specific OSM petroleum layer is toggled on for the active map view. */
export function osmInfrastructureLayerVisible(
  layerId: OsmPetroleumLayerId,
  opts: {
    isOilAndGasView: boolean;
    showInfrastructureLayers: boolean;
    isLiveDataView: boolean;
    infrastructureLayerVisibility?: Partial<Record<OsmPetroleumLayerId, boolean>>;
    showOsmPetroleum: boolean;
    osmLayerVisibility?: Partial<Record<OsmPetroleumLayerId, boolean>>;
    osmLayerIds?: OsmPetroleumLayerId[];
  },
): boolean {
  if (
    opts.showInfrastructureLayers &&
    !opts.isOilAndGasView &&
    !opts.isLiveDataView
  ) {
    return Boolean(opts.infrastructureLayerVisibility?.[layerId]);
  }
  if (!opts.isOilAndGasView || !opts.showOsmPetroleum) return false;
  return opts.osmLayerVisibility?.[layerId] ?? opts.osmLayerIds?.includes(layerId) ?? true;
}

/** True when OSM pipeline layer is toggled on (independent of GEM visibility). */
export function osmPipelinesLayerVisible(
  opts: {
    isOilAndGasView: boolean;
    showInfrastructureLayers: boolean;
    isLiveDataView: boolean;
    infrastructurePipelinesOn: boolean;
    showOsmPetroleum: boolean;
    osmLayerVisibility?: Partial<Record<OsmPetroleumLayerId, boolean>>;
    osmLayerIds?: OsmPetroleumLayerId[];
  },
): boolean {
  if (
    opts.showInfrastructureLayers &&
    !opts.isOilAndGasView &&
    !opts.isLiveDataView &&
    opts.infrastructurePipelinesOn
  ) {
    return true;
  }
  return osmInfrastructureLayerVisible('pipelines', opts);
}

export function portMarkersShouldRender(
  mapZoom: number | undefined,
  portsEnabled: boolean,
): boolean {
  if (!portsEnabled) return false;
  return mapZoom != null && mapZoom >= PORT_MARKERS_MIN_ZOOM;
}

export function infrastructureLayersPanelHint(
  mapZoom: number | undefined,
  visibility: Partial<Record<OsmPetroleumLayerId, boolean>>,
  forcedLayers: Partial<Record<OsmPetroleumLayerId, boolean>>,
): 'zoom' | 'off' | null {
  if (!infrastructureLayerExplicitlyEnabled(visibility)) return null;
  const anyRenderable = (['pipelines', 'refineries', 'storage_terminals'] as const).some((id) =>
    infrastructureLayerShouldRender(id, mapZoom, visibility, forcedLayers),
  );
  if (anyRenderable) return null;
  return mapZoom != null && mapZoom < INFRASTRUCTURE_MIN_DETAIL_ZOOM ? 'zoom' : 'off';
}
