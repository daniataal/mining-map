import { useQuery, type QueryClient } from '@tanstack/react-query';
import { API_BASE } from '../api';
import type {
  MaritimeVesselFeedResponse,
  MaritimeVesselScope,
} from './types';
import { normalizeMaritimeVessels } from './normalize';
import {
  readMaritimeSnapshotCache,
  writeMaritimeSnapshotCache,
} from './maritimeSnapshotCache';

export const MARITIME_VESSEL_SNAPSHOT_QUERY_KEY = 'maritime-vessels-snapshot';

export interface MaritimeVesselQueryOptions {
  enabled?: boolean;
  maxVessels?: number;
  captureWindowSeconds?: number;
  scope?: MaritimeVesselScope;
}

export interface MaritimeSnapshotFetchOptions {
  maxVessels: number;
  captureWindowSeconds: number;
  scope: MaritimeVesselScope;
}

export function maritimeVesselSnapshotQueryKey(options: MaritimeSnapshotFetchOptions) {
  return [
    MARITIME_VESSEL_SNAPSHOT_QUERY_KEY,
    options.scope,
    options.maxVessels,
    options.captureWindowSeconds,
  ] as const;
}

export async function fetchMaritimeVesselSnapshot(
  options: MaritimeSnapshotFetchOptions,
): Promise<MaritimeVesselFeedResponse> {
  const params = new URLSearchParams({
    max_vessels: String(options.maxVessels),
    capture_window_seconds: String(options.captureWindowSeconds),
    scope: options.scope,
    offset: '0',
  });

  const response = await fetch(`${API_BASE}/api/maritime/vessels?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Vessel feed failed (${response.status})`);
  }
  const data = (await response.json()) as MaritimeVesselFeedResponse;
  const normalized: MaritimeVesselFeedResponse = {
    ...data,
    vessels: normalizeMaritimeVessels(data.vessels ?? []),
  };
  writeMaritimeSnapshotCache(normalized);
  return normalized;
}

export function prefetchMaritimeVesselSnapshot(
  queryClient: QueryClient,
  options: MaritimeSnapshotFetchOptions,
) {
  return queryClient.prefetchQuery({
    queryKey: maritimeVesselSnapshotQueryKey(options),
    queryFn: () => fetchMaritimeVesselSnapshot(options),
    staleTime: 120_000,
  });
}

export function useMaritimeVessels({
  enabled = true,
  maxVessels = 15000,
  captureWindowSeconds = 10,
  scope = 'all_vessels',
}: MaritimeVesselQueryOptions = {}) {
  const snapshotOptions: MaritimeSnapshotFetchOptions = {
    maxVessels,
    captureWindowSeconds,
    scope,
  };

  return useQuery<MaritimeVesselFeedResponse>({
    queryKey: maritimeVesselSnapshotQueryKey(snapshotOptions),
    queryFn: () => fetchMaritimeVesselSnapshot(snapshotOptions),
    enabled,
    staleTime: 120_000,
    gcTime: 30 * 60_000,
    refetchInterval: enabled ? 90_000 : false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData ?? readMaritimeSnapshotCache() ?? undefined,
  });
}
