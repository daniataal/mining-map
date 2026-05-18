import { useQuery } from '@tanstack/react-query';
import { API_BASE } from './api';

export interface PlatformHealthResponse {
  api: string;
  status?: 'ok' | 'degraded' | string;
  redis?: {
    enabled?: boolean;
    ok?: boolean | null;
    error?: string | null;
  };
  maritime_snapshot?: {
    available?: boolean;
    stale?: boolean;
    count?: number;
    age_seconds?: number | null;
    error?: string;
  };
  maritime_worker?: {
    status?: string;
    last_error?: string | null;
    last_success_at?: string | null;
  };
}

export async function fetchPlatformHealth(): Promise<PlatformHealthResponse> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as PlatformHealthResponse;
  } finally {
    window.clearTimeout(timer);
  }
}

export function usePlatformHealth(enabled = true) {
  return useQuery({
    queryKey: ['platform-health'],
    queryFn: fetchPlatformHealth,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function platformHealthIssues(payload: PlatformHealthResponse | undefined): string[] {
  if (!payload) return [];
  const issues: string[] = [];
  if (payload.redis?.enabled && payload.redis.ok === false) {
    issues.push(payload.redis.error || 'Redis unreachable');
  }
  const snap = payload.maritime_snapshot;
  if (snap && snap.available === false) {
    issues.push('Maritime vessel snapshot not in Redis yet');
  } else if (snap?.stale) {
    issues.push('Maritime snapshot is stale — start maritime-worker');
  }
  const workerStatus = payload.maritime_worker?.status;
  if (workerStatus && !['ok', 'running', 'idle'].includes(workerStatus)) {
    issues.push(
      payload.maritime_worker?.last_error
        ? `Maritime worker: ${workerStatus} (${payload.maritime_worker.last_error})`
        : `Maritime worker: ${workerStatus}`,
    );
  }
  return issues;
}
