import { useQuery } from '@tanstack/react-query';
import { getOilLiveSyncStatus } from '../api/oilLiveApi';

/** Live Data map overlay — sync-status chip (debounced map pan does not refetch). */
export function useOilLiveMapSyncStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['oil-live-sync-status-map'],
    queryFn: getOilLiveSyncStatus,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
