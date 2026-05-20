import { useQuery, type QueryClient } from '@tanstack/react-query';
import { API_BASE } from '../api';
import type {
  MaritimeVesselFeedResponse,
  MaritimeVesselScope,
  MaritimeViewportBounds,
} from './types';
import { normalizeMaritimeVessels } from './normalize';
import {
  clearMaritimeSnapshotCache,
  readMaritimeSnapshotCache,
  writeMaritimeSnapshotCache,
} from './maritimeSnapshotCache';

export const MARITIME_VESSEL_SNAPSHOT_QUERY_KEY = 'maritime-vessels-snapshot';

/** @deprecated Prefer MARITIME_INCLUDE_COASTAL_DEMO_LOCALSTORAGE_KEY; still read for one-time migration. */
export const MARITIME_INCLUDE_GULF_DEMO_LOCALSTORAGE_KEY = 'mining_include_gulf_demo_vessels';

/** Browser localStorage key for sparse-feed coastal demo (Gulf + Africa) opt-in. */
export const MARITIME_INCLUDE_COASTAL_DEMO_LOCALSTORAGE_KEY = 'mining_include_coastal_demo_vessels';

export function readMaritimeIncludeGulfDemoPreference(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(MARITIME_INCLUDE_GULF_DEMO_LOCALSTORAGE_KEY) === '1';
}

export function readMaritimeIncludeCoastalDemoPreference(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.localStorage.getItem(MARITIME_INCLUDE_COASTAL_DEMO_LOCALSTORAGE_KEY) === '1') {
    return true;
  }
  return readMaritimeIncludeGulfDemoPreference();
}

export interface MaritimeVesselQueryOptions {
  enabled?: boolean;
  maxVessels?: number;
  captureWindowSeconds?: number;
  scope?: MaritimeVesselScope;
  viewport?: MaritimeViewportBounds | null;
  /** Passes include_gulf_demo=1 (Hormuz-only forced merge; legacy). */
  includeGulfDemo?: boolean;
  /** Passes include_coastal_demo=1 (Gulf + Africa-adjacent demo merge when server allows). */
  includeCoastalDemo?: boolean;
  /** When false (default), queries wait until viewport bounds are set. */
  allowWithoutViewport?: boolean;
}

export interface MaritimeSnapshotFetchOptions {
  maxVessels: number;
  captureWindowSeconds: number;
  scope: MaritimeVesselScope;
  viewport?: MaritimeViewportBounds | null;
  includeGulfDemo?: boolean;
  includeCoastalDemo?: boolean;
}

function viewportQueryKey(viewport?: MaritimeViewportBounds | null): string {
  if (!viewport) return 'global';
  return [
    viewport.south.toFixed(3),
    viewport.west.toFixed(3),
    viewport.north.toFixed(3),
    viewport.east.toFixed(3),
  ].join(',');
}

export function maritimeVesselSnapshotQueryKey(options: MaritimeSnapshotFetchOptions) {
  return [
    MARITIME_VESSEL_SNAPSHOT_QUERY_KEY,
    options.scope,
    options.maxVessels,
    options.captureWindowSeconds,
    viewportQueryKey(options.viewport),
    Boolean(options.includeGulfDemo),
    Boolean(options.includeCoastalDemo),
  ] as const;
}

/** Prefetches global vessel feed; backend serves pre-built Redis snapshots when available. */
export async function fetchMaritimeVesselSnapshot(
  options: MaritimeSnapshotFetchOptions,
): Promise<MaritimeVesselFeedResponse> {
  const params = new URLSearchParams({
    max_vessels: String(options.maxVessels),
    capture_window_seconds: String(options.captureWindowSeconds),
    scope: options.scope,
    offset: '0',
  });
  if (options.includeGulfDemo) {
    params.set('include_gulf_demo', 'true');
  }
  if (options.includeCoastalDemo) {
    params.set('include_coastal_demo', 'true');
  }
  const vp = options.viewport;
  if (vp) {
    params.set('south', String(vp.south));
    params.set('west', String(vp.west));
    params.set('north', String(vp.north));
    params.set('east', String(vp.east));
  }

  const response = await fetch(`${API_BASE}/api/maritime/vessels?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Vessel feed failed (${response.status})`);
  }
  const data = (await response.json()) as MaritimeVesselFeedResponse;
  const normalized: MaritimeVesselFeedResponse = {
    ...data,
    vessels: normalizeMaritimeVessels(data.vessels ?? []),
  };
  if (!options.includeGulfDemo && !options.includeCoastalDemo) {
    clearMaritimeSnapshotCache();
  }
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
  viewport = null,
  includeGulfDemo = false,
  includeCoastalDemo = false,
  allowWithoutViewport = false,
}: MaritimeVesselQueryOptions = {}) {
  const snapshotOptions: MaritimeSnapshotFetchOptions = {
    maxVessels,
    captureWindowSeconds,
    scope,
    viewport,
    includeGulfDemo,
    includeCoastalDemo,
  };

  return useQuery<MaritimeVesselFeedResponse>({
    queryKey: maritimeVesselSnapshotQueryKey(snapshotOptions),
    queryFn: () => fetchMaritimeVesselSnapshot(snapshotOptions),
    enabled: enabled && (allowWithoutViewport || viewport != null),
    staleTime: 120_000,
    gcTime: 30 * 60_000,
    refetchInterval: enabled ? 90_000 : false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData ?? readMaritimeSnapshotCache() ?? undefined,
  });
}
