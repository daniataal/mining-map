import { useQuery, type QueryClient } from '@tanstack/react-query';
import { API_BASE } from '../api';
import type {
  MaritimeVesselFeedResponse,
  MaritimeVesselScope,
  MaritimeTankerView,
  MaritimeViewportBounds,
} from './types';
import { normalizeMaritimeVessels } from './normalize';
import {
  clearMaritimeSnapshotCache,
  readMaritimeSnapshotCache,
  writeMaritimeSnapshotCache,
} from './maritimeSnapshotCache';

export const MARITIME_VESSEL_SNAPSHOT_QUERY_KEY = 'maritime-vessels-snapshot';

export interface MaritimeVesselQueryOptions {
  enabled?: boolean;
  maxVessels?: number;
  captureWindowSeconds?: number;
  scope?: MaritimeVesselScope;
  view?: MaritimeTankerView;
  viewport?: MaritimeViewportBounds | null;
  /** When false (default), queries wait until viewport bounds are set. */
  allowWithoutViewport?: boolean;
}

export interface MaritimeSnapshotFetchOptions {
  maxVessels: number;
  captureWindowSeconds: number;
  scope: MaritimeVesselScope;
  view?: MaritimeTankerView;
  viewport?: MaritimeViewportBounds | null;
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
    options.view ?? 'legacy',
    options.maxVessels,
    options.captureWindowSeconds,
    viewportQueryKey(options.viewport),
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
  const vp = options.viewport;
  if (vp) {
    params.set('south', String(vp.south));
    params.set('west', String(vp.west));
    params.set('north', String(vp.north));
    params.set('east', String(vp.east));
  }

  // Use the existing production read path
  const response = await fetch(`${API_BASE}/api/maritime/vessels?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Vessel feed failed (${response.status})`);
  }
  const data = (await response.json()) as MaritimeVesselFeedResponse;

  if (options.scope === 'oil_tankers') {
    try {
      const covRes = await fetch(`${API_BASE}/api/oil-live/coverage/status?region=${options.view ?? 'worldwide'}`);
      if (covRes.ok) {
        data.coverage = await covRes.json();
      }
    } catch (e) {
      console.warn("Failed to fetch coverage status", e);
    }

    if (options.view && options.view !== 'worldwide' && options.view !== 'legacy' && !vp) {
      const bboxes: Record<string, number[]> = {
        'middle_east':      [32.0, 12.0, 62.0, 32.0],
        'persian_gulf':     [48.0, 24.0, 57.0, 30.0],
        'strait_of_hormuz': [54.0, 25.5, 57.0, 27.0],
        'gulf_of_oman':     [56.0, 22.0, 60.0, 26.0],
        'fujairah':         [56.2, 25.0, 56.6, 25.4],
        'dubai_jebel_ali':  [54.8, 24.9, 55.4, 25.3],
        'ras_tanura':       [49.9, 26.5, 50.3, 27.0],
      };
      const box = bboxes[options.view];
      if (box && data.vessels) {
        data.vessels = data.vessels.filter(v => 
          v.lng >= box[0] && v.lat >= box[1] && v.lng <= box[2] && v.lat <= box[3]
        );
      }
    }
  }

  const normalized: MaritimeVesselFeedResponse = {
    ...data,
    vessels: normalizeMaritimeVessels(data.vessels ?? []),
  };
  clearMaritimeSnapshotCache();
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
  view = 'worldwide',
  viewport = null,
  allowWithoutViewport = false,
}: MaritimeVesselQueryOptions = {}) {
  const snapshotOptions: MaritimeSnapshotFetchOptions = {
    maxVessels,
    captureWindowSeconds,
    scope,
    view,
    viewport,
  };

  return useQuery<MaritimeVesselFeedResponse>({
    queryKey: maritimeVesselSnapshotQueryKey(snapshotOptions),
    queryFn: () => fetchMaritimeVesselSnapshot(snapshotOptions),
    enabled: enabled && (scope === 'oil_tankers' || allowWithoutViewport || viewport != null),
    staleTime: 120_000,
    gcTime: 30 * 60_000,
    refetchInterval: enabled ? 90_000 : false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData ?? readMaritimeSnapshotCache() ?? undefined,
  });
}
