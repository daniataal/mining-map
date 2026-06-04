import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from './api';
import type { PetroleumViewportBounds } from './petroleumLayers';

export type OsmPetroleumLayerId = 'pipelines' | 'refineries' | 'storage_terminals';

export interface OsmPetroleumCatalogLayer {
  id: OsmPetroleumLayerId;
  tile_url_template?: string;
  source_layer?: string;
  min_zoom?: number;
  render_mode?: string;
}

export interface OsmPetroleumCatalog {
  layers: OsmPetroleumCatalogLayer[];
  render_mode?: string;
}

export interface OsmPetroleumLayerGeoJson {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  layer_id: OsmPetroleumLayerId;
  label?: string;
  feature_count?: number;
  attribution?: string;
  license_note?: string;
  limitations?: string[];
  source?: string;
  read_path?: string;
  coverage_gap?: boolean;
  stale?: boolean;
  hint?: string;
  db_feature_total?: number;
}

/** User-facing note when the OSM snapshot is empty or stale in Postgres. */
export function osmPetroleumCoverageGapMessage(payload?: OsmPetroleumLayerGeoJson | null): string | null {
  if (!payload?.coverage_gap) return null;
  return (
    payload.hint ??
    'OSM infrastructure snapshot empty — run petroleum-osm worker or graph-sync.'
  );
}

export const OSM_PETROLEUM_LAYER_IDS: OsmPetroleumLayerId[] = [
  'pipelines',
  'refineries',
  'storage_terminals',
];

export const DEFAULT_OSM_LAYER_VISIBILITY: Record<OsmPetroleumLayerId, boolean> = {
  pipelines: false,
  refineries: false,
  storage_terminals: false,
};

/** When Mapbox is off, default OSM pipelines on (refineries / storage still opt-in). */
export function defaultOsmLayerVisibility(mapboxDisabled: boolean): Record<OsmPetroleumLayerId, boolean> {
  if (!mapboxDisabled) return { ...DEFAULT_OSM_LAYER_VISIBILITY };
  return { pipelines: true, refineries: false, storage_terminals: false };
}

export function useOsmPetroleumCatalog(enabled = true) {
  return useQuery<OsmPetroleumCatalog>({
    queryKey: ['osm-petroleum-catalog'],
    queryFn: async () => {
      const startedAt = Date.now();
      try {
        const { data, status } = await apiClient.get<OsmPetroleumCatalog>('/api/petroleum/osm-layers');
        // #region agent log
        fetch('http://127.0.0.1:7847/ingest/4a545e2b-07f1-4d20-ade6-14997117a3cb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'cd3deb' },
          body: JSON.stringify({
            sessionId: 'cd3deb',
            hypothesisId: 'H2',
            location: 'osmPetroleumLayers.ts:useOsmPetroleumCatalog',
            message: 'osm_catalog_fetch_ok',
            data: { httpStatus: status, elapsedMs: Date.now() - startedAt, layerCount: data?.layers?.length ?? 0 },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        return data;
      } catch (err) {
        const axStatus =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;
        // #region agent log
        fetch('http://127.0.0.1:7847/ingest/4a545e2b-07f1-4d20-ade6-14997117a3cb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'cd3deb' },
          body: JSON.stringify({
            sessionId: 'cd3deb',
            hypothesisId: 'H2',
            location: 'osmPetroleumLayers.ts:useOsmPetroleumCatalog',
            message: 'osm_catalog_fetch_error',
            data: {
              httpStatus: axStatus ?? null,
              elapsedMs: Date.now() - startedAt,
              error: err instanceof Error ? err.message : String(err),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        throw err;
      }
    },
    enabled,
    staleTime: 60 * 60_000,
  });
}

export function useOsmPetroleumLayerGeoJson(
  layerId: OsmPetroleumLayerId,
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  mapZoom?: number,
) {
  return useQuery<OsmPetroleumLayerGeoJson>({
    queryKey: ['osm-petroleum-layer', layerId, bbox, mapZoom],
    queryFn: async ({ signal }) => {
      const startedAt = Date.now();
      try {
        const { data } = await apiClient.get<OsmPetroleumLayerGeoJson>(
          `/api/petroleum/osm-layers/${layerId}`,
          {
            signal,
            params: {
              ...(bbox
                ? {
                    south: bbox.south,
                    west: bbox.west,
                    north: bbox.north,
                    east: bbox.east,
                  }
                : {}),
              ...(mapZoom != null && Number.isFinite(mapZoom)
                ? { zoom: Math.round(mapZoom * 10) / 10 }
                : {}),
            },
          },
        );
        // #region agent log
        fetch('http://127.0.0.1:7847/ingest/4a545e2b-07f1-4d20-ade6-14997117a3cb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'cd3deb' },
          body: JSON.stringify({
            sessionId: 'cd3deb',
            hypothesisId: 'H1',
            location: 'osmPetroleumLayers.ts:useOsmPetroleumLayerGeoJson',
            message: 'osm_layer_fetch_ok',
            data: {
              layerId,
              elapsedMs: Date.now() - startedAt,
              featureCount: data?.features?.length ?? data?.feature_count ?? 0,
              coverageGap: Boolean(data?.coverage_gap),
              hasBbox: bbox != null,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        return data;
      } catch (err) {
        // #region agent log
        const axStatus =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;
        fetch('http://127.0.0.1:7847/ingest/4a545e2b-07f1-4d20-ade6-14997117a3cb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'cd3deb' },
          body: JSON.stringify({
            sessionId: 'cd3deb',
            hypothesisId: 'H1',
            location: 'osmPetroleumLayers.ts:useOsmPetroleumLayerGeoJson',
            message: 'osm_layer_fetch_error',
            data: {
              layerId,
              elapsedMs: Date.now() - startedAt,
              hasBbox: bbox != null,
              httpStatus: axStatus ?? null,
              error: err instanceof Error ? err.message : String(err),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        throw err;
      }
    },
    enabled: enabled && Boolean(bbox),
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
