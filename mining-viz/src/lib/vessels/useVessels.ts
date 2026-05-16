import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../api';
import type {
  MaritimeVesselFeedResponse,
  MaritimeVesselScope,
  MaritimeViewportBounds,
} from './types';
import { normalizeMaritimeVessels } from './normalize';

export interface MaritimeVesselQueryOptions {
  enabled?: boolean;
  maxVessels?: number;
  captureWindowSeconds?: number;
  scope?: MaritimeVesselScope;
  offset?: number;
  bbox?: MaritimeViewportBounds | null;
}

async function fetchMaritimeVesselFeed(options: Required<Pick<MaritimeVesselQueryOptions, 'maxVessels' | 'captureWindowSeconds' | 'scope' | 'offset'>> & {
  bbox: MaritimeViewportBounds | null;
}): Promise<MaritimeVesselFeedResponse> {
  const params = new URLSearchParams({
    max_vessels: String(options.maxVessels),
    capture_window_seconds: String(options.captureWindowSeconds),
    scope: options.scope,
    offset: String(options.offset),
  });
  if (options.bbox) {
    params.set('south', String(options.bbox.south));
    params.set('west', String(options.bbox.west));
    params.set('north', String(options.bbox.north));
    params.set('east', String(options.bbox.east));
  }

  const response = await fetch(`${API_BASE}/api/maritime/vessels?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Vessel feed failed (${response.status})`);
  }
  const data = (await response.json()) as MaritimeVesselFeedResponse;
  return {
    ...data,
    vessels: normalizeMaritimeVessels(data.vessels ?? []),
  };
}

export function useMaritimeVessels({
  enabled = true,
  maxVessels = 5000,
  captureWindowSeconds = 10,
  scope = 'all_vessels',
  offset = 0,
  bbox = null,
}: MaritimeVesselQueryOptions = {}) {
  return useQuery<MaritimeVesselFeedResponse>({
    queryKey: ['maritime-vessels', scope, maxVessels, captureWindowSeconds, offset, bbox],
    queryFn: () =>
      fetchMaritimeVesselFeed({
        maxVessels,
        captureWindowSeconds,
        scope,
        offset,
        bbox,
      }),
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 90_000 : false,
    placeholderData: (previousData) => previousData,
  });
}
