import { apiClient } from '../lib/api';

export type LicenseOpenDataSyncRun = {
  id: number;
  source_id?: string | null;
  status: string;
  records_written?: number;
  records_fetched?: number;
  started_at?: string;
  finished_at?: string | null;
};

type SyncRunsResponse = {
  status?: string;
  runs?: LicenseOpenDataSyncRun[];
};

export async function fetchLicenseOpenDataSyncRuns(): Promise<LicenseOpenDataSyncRun[]> {
  const { data } = await apiClient.get<SyncRunsResponse>('/api/open-data/sync-runs', {
    params: { per_source_latest: 'true', limit: 100 },
  });
  if (!Array.isArray(data?.runs)) return [];
  return data.runs;
}
