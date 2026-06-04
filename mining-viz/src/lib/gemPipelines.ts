import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from './api';
import type { PetroleumViewportBounds } from './petroleumViewportBounds';

export {
  gemFuelGroupToPopupLayerId,
  gemPipelineStyle,
} from './gemPipelineMapStyle';

export interface GemPipelineGeoJson {
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

export interface GemPipelineCoverageReport {
  gem_segment_total: number;
  osm_pipeline_total: number;
  gem_in_viewport?: number;
  osm_in_viewport?: number;
  gem_only_in_viewport?: number;
  osm_only_in_viewport?: number;
  both_within_match_distance?: number;
  coverage_gap?: boolean;
  match_distance_m?: number;
  limitations?: string[];
}

export function useGemPipelineGeoJson(
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  mapZoom?: number,
) {
  return useQuery<GemPipelineGeoJson>({
    queryKey: ['gem-pipelines', bbox, mapZoom],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<GemPipelineGeoJson>('/api/petroleum/gem-pipelines', {
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

export function useGemPipelineCoverage(
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
) {
  return useQuery<GemPipelineCoverageReport>({
    queryKey: ['gem-pipelines-coverage', bbox],
    queryFn: async () => {
      const { data } = await apiClient.get<GemPipelineCoverageReport>(
        '/api/petroleum/gem-pipelines/coverage',
        {
          params: bbox
            ? {
                south: bbox.south,
                west: bbox.west,
                north: bbox.north,
                east: bbox.east,
              }
            : {},
        },
      );
      return data;
    },
    enabled: enabled && Boolean(bbox),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
