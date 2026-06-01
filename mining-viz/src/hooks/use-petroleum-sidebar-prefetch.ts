import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getEiaHistoricMap,
  getEiaHistoricSummary,
  type EiaHistoricSummary,
} from '../api/eiaHistoricApi';
import { getOilLiveSyncStatus } from '../api/oilLiveApi';
import { prefetchOilAndGasLicensesHub } from '../lib/api';

export const EIA_HISTORIC_STALE_MS = 120_000;

export const eiaHistoricSummaryQueryKey = (importer = '') =>
  ['eia-historic-summary', importer] as const;

export const eiaHistoricMapQueryKey = (year: number, importer = '') =>
  ['eia-historic-map', year, importer] as const;

/** Warm EIA historic summary + default-year map arcs (used by Historic sidebar). */
export async function prefetchEiaHistoricData(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<{ year: number; summary: EiaHistoricSummary | undefined }> {
  const summary = await queryClient.fetchQuery({
    queryKey: eiaHistoricSummaryQueryKey(''),
    queryFn: () => getEiaHistoricSummary({}),
    staleTime: EIA_HISTORIC_STALE_MS,
  });
  const year = summary?.year_max ?? summary?.year_min ?? 2020;
  await queryClient.prefetchQuery({
    queryKey: eiaHistoricMapQueryKey(year, ''),
    queryFn: () => getEiaHistoricMap({ year, limit: 80 }),
    staleTime: EIA_HISTORIC_STALE_MS,
  });
  return { year, summary };
}

function prefetchPetroleumSidebarBundles(): void {
  void import('../features/live-data/EiaHistoricImportsPanel');
  void import('../features/live-data/LiveDataIntelPanel');
}

/**
 * After login, prefetch Historic/Live sidebar data in the background so tab switches feel instant.
 * Does not block initial map paint.
 */
export function usePetroleumSidebarPrefetch(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const run = async () => {
      prefetchPetroleumSidebarBundles();

      void queryClient.prefetchQuery({
        queryKey: ['oil-live-sync-status'],
        queryFn: getOilLiveSyncStatus,
        staleTime: 60_000,
      });

      void prefetchOilAndGasLicensesHub(queryClient);

      try {
        await prefetchEiaHistoricData(queryClient);
      } catch {
        /* EIA tables may be empty locally — Historic panel shows ingest hint */
      }

    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => void run(), { timeout: 4000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }

    const timer = window.setTimeout(() => void run(), 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, queryClient]);
}
