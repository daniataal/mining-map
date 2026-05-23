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

  if (workerStatus === 'stale_error') {
    return {
      kind: 'tls_expired',
      messageHe:
        'אין AIS חי — סטטוס ingest ישן (תעודת AISStream תקפה). הפעילו מחדש maritime-worker ו-oil-live-intel-worker.',
      messageEn:
        'No live AIS — stale ingest status (AISStream TLS is valid upstream). Force-recreate maritime-worker and oil-live-intel-worker.',
    };
  }

  if (workerErr.includes('certificate has expired') || workerErr.includes('CERTIFICATE_VERIFY_FAILED')) {
    return {
      kind: 'tls_expired',
      messageHe:
        'אין AIS חי — שגיאת TLS של AISStream. פרטים בשורת מצב הפלטפורמה; הפעילו מחדש maritime-worker עם MARITIME_SSL_AUTO_FALLBACK=1.',
      messageEn:
        'No live AIS — AISStream TLS error. See the platform status bar; recreate maritime-worker with MARITIME_SSL_AUTO_FALLBACK=1.',
    };
  }

  if (workerStatus === 'error' && workerErr) {
    const short =
      workerErr.length > 140 ? `${workerErr.slice(0, 140)}…` : workerErr;
    return {
      kind: 'worker_error',
      messageHe: `maritime-worker: ${short}`,
      messageEn: `maritime-worker: ${short}`,
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
