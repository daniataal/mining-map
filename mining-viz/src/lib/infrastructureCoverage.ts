import { useQuery } from '@tanstack/react-query';
import { apiClient } from './api';
import type { PetroleumViewportBounds } from './petroleumViewportBounds';

export type {
  InfrastructureCoverageReport,
  InfrastructureCoverageViewport,
} from './infrastructureCoverageFormat';
export {
  formatInfrastructureCoverageBanner,
  infrastructureCoverageGapMessage,
  tankFarmEmptyHintMessage,
} from './infrastructureCoverageFormat';

import type { InfrastructureCoverageReport } from './infrastructureCoverageFormat';

export function useInfrastructureCoverage(
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
) {
  return useQuery<InfrastructureCoverageReport>({
    queryKey: ['infrastructure-coverage', bbox],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<InfrastructureCoverageReport>(
        '/api/petroleum/infrastructure-coverage',
        {
          signal,
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
    staleTime: 90_000,
    refetchOnWindowFocus: false,
  });
}

export interface NearestGemPipelineResponse {
  found: boolean;
  distance_m?: number;
  distance_km?: number;
  tags?: Record<string, unknown>;
  limitations?: string[];
}

export async function fetchNearestGemPipeline(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<NearestGemPipelineResponse> {
  const { data } = await apiClient.get<NearestGemPipelineResponse>(
    '/api/petroleum/gem-pipelines/nearest',
    { signal, params: { lat, lng } },
  );
  return data;
}
