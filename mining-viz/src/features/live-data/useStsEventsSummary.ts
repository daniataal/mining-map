import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getStsEventsSummary, stsViewportBbox } from '../../api/stsEventsApi';
import type { MaritimeViewportBounds } from '../../types';

const STS_SUMMARY_STALE_MS = 90_000;
const STS_SUMMARY_REFETCH_MS = 120_000;

/** Viewport-scoped STS counts — debounced bbox should be passed from map trackers. */
export function useStsEventsSummary(
  viewport: MaritimeViewportBounds | null | undefined,
  enabled: boolean,
) {
  const bbox = viewport ? stsViewportBbox(viewport) : undefined;

  return useQuery({
    queryKey: ['oil-live-sts-events-summary', bbox],
    queryFn: () => getStsEventsSummary(bbox!),
    enabled: enabled && Boolean(bbox),
    staleTime: STS_SUMMARY_STALE_MS,
    refetchInterval: enabled && bbox ? STS_SUMMARY_REFETCH_MS : false,
    placeholderData: keepPreviousData,
  });
}
