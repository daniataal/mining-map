import { useQuery } from '@tanstack/react-query';
import { getVesselTrack } from '../api/oilLiveApi';
import { summarizeVesselTrack, trackPointsToPath, type VesselTrackResponse } from '../lib/vessels/vesselTrack';

const DEFAULT_TRACK_HOURS = 24;

export function useVesselTrack(mmsi: string | null | undefined, hours = DEFAULT_TRACK_HOURS, enabled = true) {
  const mmsiStr = String(mmsi ?? '').trim();
  const query = useQuery<VesselTrackResponse>({
    queryKey: ['vessel-track', mmsiStr, hours],
    queryFn: () => getVesselTrack(mmsiStr, hours),
    enabled: enabled && Boolean(mmsiStr && mmsiStr !== '0'),
    staleTime: 60_000,
    retry: false,
  });

  const points = query.data?.points ?? [];
  const path = trackPointsToPath(points);
  const summary = summarizeVesselTrack(points);

  return {
    ...query,
    path,
    summary,
    unavailable: query.data?.unavailable,
  };
}
