import type { PlatformHealthResponse } from '../../lib/platformHealth';
import type { OilLiveSyncStatus } from '../../api/oilLiveApi';

export type LiveAisBannerKind =
  | 'none'
  | 'tls_expired'
  | 'worker_error'
  | 'key_missing'
  | 'no_vessels';

export type LiveAisBanner = {
  kind: LiveAisBannerKind;
  messageHe: string;
  messageEn: string;
};

export function resolveLiveAisBanner(
  syncStatus: OilLiveSyncStatus | undefined,
  options: {
    vesselsInView: number;
    platformHealth?: PlatformHealthResponse;
  },
): LiveAisBanner {
  const workerErr = (options.platformHealth?.maritime_worker?.last_error ?? '').trim();
  const workerStatus = (options.platformHealth?.maritime_worker?.status ?? '').toLowerCase();
  const keyMissing = options.platformHealth?.maritime_snapshot?.available === false && !workerErr;

  if (workerErr.includes('certificate has expired') || workerErr.includes('CERTIFICATE_VERIFY_FAILED')) {
    return {
      kind: 'tls_expired',
      messageHe:
        'תעודת TLS של AISStream (stream.aisstream.io) פגה. המערכת מנסה חיבור מחדש אוטומטית (MARITIME_SSL_AUTO_FALLBACK). הפעל מחדש: docker compose up -d --force-recreate maritime-worker oil-live-intel-worker',
      messageEn:
        'AISStream TLS certificate (stream.aisstream.io) has expired. Meridian auto-retries with MARITIME_SSL_AUTO_FALLBACK. Recreate workers: docker compose up -d --force-recreate maritime-worker oil-live-intel-worker',
    };
  }

  if (workerStatus === 'error' && workerErr) {
    return {
      kind: 'worker_error',
      messageHe: `maritime-worker: ${workerErr.slice(0, 220)}`,
      messageEn: `maritime-worker: ${workerErr.slice(0, 220)}`,
    };
  }

  if (workerStatus === 'not_configured' || keyMissing) {
    return {
      kind: 'key_missing',
      messageHe:
        'אין AIS חי — הגדירו AISSTREAM_API_KEY ב-backend.env והפעילו maritime-worker + oil-live-intel-worker.',
      messageEn:
        'No live AIS — set AISSTREAM_API_KEY in backend.env and start maritime-worker + oil-live-intel-worker.',
    };
  }

  const vesselsLow =
    syncStatus?.live_vessel_count != null
      ? syncStatus.live_vessel_count === 0
      : options.vesselsInView === 0;
  const portCallsLow =
    syncStatus?.live_ais_port_call_count != null
      ? syncStatus.live_ais_port_call_count < 3
      : (syncStatus?.port_call_count ?? 0) === 0;

  if (!syncStatus || (!vesselsLow && !portCallsLow)) {
    return { kind: 'none', messageHe: '', messageEn: '' };
  }

  return {
    kind: 'no_vessels',
    messageHe:
      'אין מכליות חיות בתצוגה — ודאו ש-maritime-worker ו-oil-live-intel-worker רצים (docker compose ps). נתוני הדגמה מושבתים.',
    messageEn:
      'No live tankers in view — ensure maritime-worker and oil-live-intel-worker are running (docker compose ps). Demo data is disabled.',
  };
}
