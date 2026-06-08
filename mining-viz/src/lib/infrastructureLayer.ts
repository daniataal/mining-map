import type { OsmPetroleumLayerId } from './osmPetroleumLayers';

/** Infrastructure features unlock at this zoom unless the user toggles a layer on earlier. */
export const INFRASTRUCTURE_MIN_DETAIL_ZOOM = 9;

/** OSM pipeline MVT tiles are generated from this zoom (catalog min_zoom=4). */
export const PIPELINE_MVT_MIN_ZOOM = 4;

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
  if (Boolean(forcedLayers[layerId])) return true;
  const minZoom =
    layerId === 'pipelines' ? PIPELINE_MVT_MIN_ZOOM : INFRASTRUCTURE_MIN_DETAIL_ZOOM;
  return mapZoom != null && mapZoom >= minZoom;
}

export function pipelineLeafletShouldFetch(
  mapZoom: number | undefined,
  visible: boolean,
): boolean {
  if (!visible) return false;
  return mapZoom != null && mapZoom >= PIPELINE_LEAFLET_MIN_ZOOM;
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
  if (!opts.isOilAndGasView || !opts.showOsmPetroleum) return false;
  return opts.osmLayerVisibility?.pipelines ?? opts.osmLayerIds?.includes('pipelines') ?? true;
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
