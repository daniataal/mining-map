import { useQuery } from '@tanstack/react-query';
import { API_BASE } from './api';

export type AiProviderConfigState = 'configured' | 'missing' | 'invalid_template';

export interface AiProvidersHealth {
  groq?: AiProviderConfigState;
  openrouter?: AiProviderConfigState;
  pollinations_enabled?: boolean;
  ready?: boolean;
  env?: Record<string, 'SET' | 'MISSING'>;
}

export interface PlatformHealthResponse {
  api: string;
  status?: 'ok' | 'degraded' | string;
  ai_providers?: AiProvidersHealth;
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
  oil_live_intel?: {
    ok?: boolean | null;
    error?: string | null;
    url?: string | null;
    terminal_count?: number | null;
    cargo_record_count?: number | null;
  };
}

export async function fetchPlatformHealth(): Promise<PlatformHealthResponse> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as PlatformHealthResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Health check timed out — backend may still be starting (EIA ingest, graph-sync)');
    }
    throw err;
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

/** Keep top banner readable — never dump full TLS stack traces. */
export function shortenMaritimeWorkerError(raw: string | undefined | null): string {
  const err = (raw ?? '').trim();
  if (!err) return '';
  if (
    err.includes('CERTIFICATE_VERIFY_FAILED') ||
    err.includes('certificate has expired') ||
    err.includes('stream.aisstream.io')
  ) {
    return (
      'AISStream TLS certificate expired (stream.aisstream.io). ' +
      'Set MARITIME_SSL_AUTO_FALLBACK=1 and recreate maritime-worker + oil-live-intel-worker.'
    );
  }
  return err.length > 160 ? `${err.slice(0, 160)}…` : err;
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
    const shortErr = shortenMaritimeWorkerError(payload.maritime_worker?.last_error);
    issues.push(
      shortErr
        ? `Maritime worker: ${workerStatus} — ${shortErr}`
        : `Maritime worker: ${workerStatus}`,
    );
  }
  const oilLive = payload.oil_live_intel;
  if (oilLive?.ok === false) {
    issues.push(
      oilLive.error
        ? `Live Data (oil-live-intel) unreachable: ${oilLive.error}. Check oil-live-intel container and use port :8080 (Caddy) or :5173 with /api/oil-live proxy — not :8000 alone.`
        : 'Live Data (oil-live-intel) unreachable — Live Data map counts will show unavailable until oil-live-intel is healthy.',
    );
  }
  const ai = payload.ai_providers;
  if (ai && ai.ready === false) {
    const env = ai.env ?? {};
    const envSummary = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'DISABLE_POLLINATIONS_FALLBACK']
      .map((key) => `${key}=${env[key] ?? 'MISSING'}`)
      .join(', ');
    const groqHint =
      ai.groq === 'invalid_template'
        ? 'Groq key looks like an unresolved template'
        : ai.groq === 'missing'
          ? 'Groq key missing'
          : null;
    const openrouterHint =
      ai.openrouter === 'invalid_template'
        ? 'OpenRouter key looks like an unresolved template'
        : ai.openrouter === 'missing'
          ? 'OpenRouter key missing'
          : null;
    const hints = [groqHint, openrouterHint].filter(Boolean).join('; ');
    issues.push(
      hints
        ? `AI dossier analysis unavailable (${hints}). Backend env: ${envSummary}.`
        : `AI dossier analysis unavailable. Backend env: ${envSummary}.`,
    );
  }
  return issues;
}
