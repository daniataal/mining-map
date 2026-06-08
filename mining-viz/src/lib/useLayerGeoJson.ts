/**
 * Generic viewport-scoped GeoJSON data hook.
 *
 * Replaces four near-identical hooks:
 *   - useGemPipelineGeoJson  → /api/petroleum/gem-pipelines
 *   - useGemPlantGeoJson     → /api/petroleum/gem-plants
 *   - useGemLngGeoJson       → /api/petroleum/gem-lng-terminals
 *   - useOsmPetroleumLayerGeoJson (per-layer variant)
 *
 * All shared the same pattern: bbox + zoom params, staleTime 1h,
 * keepPreviousData, refetchOnWindowFocus: false.
 */
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient } from './api';
import type { PetroleumViewportBounds } from './petroleumViewportBounds';

export interface BaseGeoJsonResponse {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
}

/** @internal — shared bbox+zoom param builder */
function buildParams(
  bbox: PetroleumViewportBounds | null,
  zoom?: number,
): Record<string, number | string> {
  return {
    ...(bbox
      ? {
          south: bbox.south,
          west: bbox.west,
          north: bbox.north,
          east: bbox.east,
        }
      : {}),
    ...(zoom != null && Number.isFinite(zoom)
      ? { zoom: Math.round(zoom * 10) / 10 }
      : {}),
  };
}

/**
 * Fetch a viewport-bounded GeoJSON layer from any petroleum API endpoint.
 *
 * @param endpoint   Full API path, e.g. '/api/petroleum/gem-pipelines'
 * @param bbox       Viewport bounding box — query disabled when null
 * @param enabled    Master switch; when false the query does not fire
 * @param zoom       Optional map zoom passed as 'zoom' query param
 * @param extraKeys  Extra values to include in the React Query key (e.g. layer id)
 */
export function useLayerGeoJson<T extends BaseGeoJsonResponse>(
  endpoint: string,
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  zoom?: number,
  extraKeys?: unknown[],
): UseQueryResult<T> {
  return useQuery<T>({
    queryKey: [endpoint, bbox, zoom, ...(extraKeys ?? [])],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<T>(endpoint, {
        signal,
        params: buildParams(bbox, zoom),
      });
      return data;
    },
    enabled: enabled && Boolean(bbox),
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
