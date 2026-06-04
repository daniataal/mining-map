import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from './api';
import type { PetroleumViewportBounds } from './petroleumViewportBounds';

export { gemLngMarkerStyle } from './gemLngMapStyle';

export interface GemLngGeoJson {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  layer_id?: string;
  label?: string;
  feature_count?: number;
  attribution?: string;
  limitations?: string[];
  coverage_gap?: boolean;
}

export function useGemLngGeoJson(
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  mapZoom?: number,
) {
  return useQuery<GemLngGeoJson>({
    queryKey: ['gem-lng-terminals', bbox, mapZoom],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<GemLngGeoJson>('/api/petroleum/gem-lng-terminals', {
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
      });
      return data;
    },
    enabled: enabled && Boolean(bbox),
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
