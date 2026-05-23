import type { OsmPetroleumLayerId } from './osmPetroleumLayers';

/** Infrastructure features unlock at this zoom unless the user toggles a layer on earlier. */
export const INFRASTRUCTURE_MIN_DETAIL_ZOOM = 9;

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
  const zoomOk = mapZoom != null && mapZoom >= INFRASTRUCTURE_MIN_DETAIL_ZOOM;
  return zoomOk || Boolean(forcedLayers[layerId]);
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
