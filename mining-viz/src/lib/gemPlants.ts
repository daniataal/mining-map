import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from './api';
import type { PetroleumViewportBounds } from './petroleumViewportBounds';

export { gemPlantMarkerStyle } from './gemPlantMapStyle';

export interface GemPlantGeoJson {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  layer_id?: string;
  label?: string;
  feature_count?: number;
  data_as_of?: string;
  attribution?: string;
  license_note?: string;
  limitations?: string[];
  coverage_gap?: boolean;
  hint?: string;
  db_feature_total?: number;
}

export function useGemPlantGeoJson(
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  mapZoom?: number,
) {
  return useQuery<GemPlantGeoJson>({
    queryKey: ['gem-plants', bbox, mapZoom],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<GemPlantGeoJson>('/api/petroleum/gem-plants', {
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
