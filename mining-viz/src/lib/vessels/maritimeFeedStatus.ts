import type { MaritimeVesselFeedResponse } from './types';

/** Why Maritime Watch shows degraded or empty AIS (ordered for UI precedence). */
export type MaritimeFeedIssue =
  | 'key_missing'
  | 'worker_down'
  | 'snapshot_empty'
  | 'snapshot_stale'
  | 'viewport_empty'
  | null;

function workerStatus(feed: MaritimeVesselFeedResponse | null | undefined): string {
  const raw = feed?.worker;
  if (!raw || typeof raw !== 'object') return 'unknown';
  const status = (raw as { status?: unknown }).status;
  return typeof status === 'string' ? status.trim().toLowerCase() : 'unknown';
}

export function resolveMaritimeFeedIssue(
  feed: MaritimeVesselFeedResponse | null | undefined,
  options: {
    layerEnabled: boolean;
    vesselsInView: number;
    snapshotTotal: number;
  },
): MaritimeFeedIssue {
  if (!options.layerEnabled || !feed) return null;

  if (feed.live_positions_enabled) {
    if (options.vesselsInView === 0 && options.snapshotTotal > 0) {
      return 'viewport_empty';
    }
    return null;
  }

  if (feed.aisstream_configured === false) {
    return 'key_missing';
  }

  const status = workerStatus(feed);
  const sparse = options.snapshotTotal < 100;

  if (status === 'error' || (sparse && status === 'unknown')) {
    return 'worker_down';
  }
  if (sparse) {
    return 'snapshot_empty';
  }
  return 'snapshot_stale';
}

export interface MaritimeStatusMessages {
  headlineHe: string;
  headlineEn: string;
  detailHe: string;
  detailEn: string;
  sparseWarningHe: string | null;
  sparseWarningEn: string | null;
}

export function buildMaritimeStatusMessages(
  feed: MaritimeVesselFeedResponse | null | undefined,
  options: {
    layerEnabled: boolean;
    vesselsInView: number;
    snapshotTotal: number;
    isLoading: boolean;
    hasError: boolean;
  },
): MaritimeStatusMessages | null {
  const totalLabel = options.snapshotTotal.toLocaleString();
  const inViewLabel = options.vesselsInView.toLocaleString();

  if (!options.layerEnabled) {
    return {
      headlineHe: '',
      headlineEn: '',
      detailHe:
        'כלי השיט כבויים כברירת מחדל. הפעל כדי להציג מיקומי AIS — הנתונים נטענים ברקע מראש.',
      detailEn:
        'Vessels stay off until you enable the layer. AIS data is prefetched in the background for instant display.',
      sparseWarningHe: null,
      sparseWarningEn: null,
    };
  }

  if (options.isLoading && !feed) {
    return {
      headlineHe: 'טוען מעקב כלי שיט…',
      headlineEn: 'Loading vessel watch…',
      detailHe: 'טוען מעקב כלי שיט עבור התצוגה הנוכחית...',
      detailEn: 'Loading vessel watch for the current view...',
      sparseWarningHe: null,
      sparseWarningEn: null,
    };
  }

  if (options.hasError) {
    return {
      headlineHe: 'טעינה נכשלה',
      headlineEn: 'Load failed',
      detailHe: 'טעינת כלי השיט נכשלה. נסה רענון או שנה היקף/תצוגה.',
      detailEn: 'Vessel loading failed. Try refresh or adjust the view/scope.',
      sparseWarningHe: null,
      sparseWarningEn: null,
    };
  }

  const issue = resolveMaritimeFeedIssue(feed, {
    layerEnabled: options.layerEnabled,
    vesselsInView: options.vesselsInView,
    snapshotTotal: options.snapshotTotal,
  });

  if (issue === 'viewport_empty') {
    return {
      headlineHe: `0 בתצוגה · ${totalLabel} במאגר`,
      headlineEn: `0 in view · ${totalLabel} in feed`,
      detailHe:
        'לא נמצאו כלי שיט בתצוגה ובחלון הלכידה הנוכחיים. נסה להזיז מפה, להגדיל חלון או לעבור לכל כלי השיט.',
      detailEn:
        'No vessels were observed in the current view and capture window. Pan/zoom, widen the window, or switch to all vessels.',
      sparseWarningHe: null,
      sparseWarningEn: null,
    };
  }

  if (feed?.live_positions_enabled) {
    return {
      headlineHe: `${inViewLabel} בתצוגה · ${totalLabel} במאגר`,
      headlineEn: `${inViewLabel} in view · ${totalLabel} in feed`,
      detailHe: `נצפו ${feed.returned_count ?? options.vesselsInView} כלי שיט בתצוגה הנוכחית.`,
      detailEn: `${feed.returned_count ?? options.vesselsInView} vessels observed in the current watch.`,
      sparseWarningHe: null,
      sparseWarningEn: null,
    };
  }

  const headlineHe = `${totalLabel} כלי שיט (AIS לא חי)`;
  const headlineEn = `${totalLabel} vessels (live AIS unavailable)`;

  const detailByIssue: Record<
    Exclude<MaritimeFeedIssue, null | 'viewport_empty'>,
    { detailHe: string; detailEn: string; sparseHe: string; sparseEn: string }
  > = {
    key_missing: {
      detailHe:
        'מפתח AISStream חסר ב-backend. הוסף AISSTREAM_API_KEY ל-backend.env או ל-.env בשורש הפרויקט, ואז הפעל מחדש את backend ו-maritime-worker.',
      detailEn:
        'AISStream API key is missing in the backend. Add AISSTREAM_API_KEY to backend.env or the repo-root .env, then recreate backend and maritime-worker.',
      sparseHe:
        'מפתח AISStream חסר. הגדר AISSTREAM_API_KEY ב-backend.env (פרודקשן) או ב-.env (מקומי).',
      sparseEn:
        'AISStream API key is missing. Set AISSTREAM_API_KEY in backend.env (production) or .env (local).',
    },
    worker_down: {
      detailHe:
        'אין צילום AIS עדכני. הפעל docker compose up -d maritime-worker וודא שה-worker רץ (docker compose ps maritime-worker).',
      detailEn:
        'No fresh AIS snapshot. Run docker compose up -d maritime-worker and confirm it is running (docker compose ps maritime-worker).',
      sparseHe:
        'מאגר כלי השיט ריק או ישן — הפעל maritime-worker (docker compose up -d maritime-worker).',
      sparseEn:
        'Vessel feed is empty or stale — start maritime-worker (docker compose up -d maritime-worker).',
    },
    snapshot_empty: {
      detailHe:
        'maritime-worker רץ אך המאגר עדיין דליל. המתן מחזורי לכידה (כ-30–60 שניות) או בדוק /api/maritime/stats.',
      detailEn:
        'maritime-worker is running but the feed is still sparse. Wait for ingest cycles (~30–60s) or check /api/maritime/stats.',
      sparseHe:
        'מאגר דליל — ה-worker עשוי להיות בתחילת ריצה; המתן מחזור ingest או בדוק לוגי maritime-worker.',
      sparseEn:
        'Sparse feed — worker may still be warming up; wait for an ingest cycle or check maritime-worker logs.',
    },
    snapshot_stale: {
      detailHe:
        'צילום AIS ישן מדי. בדוק ש-maritime-worker רץ וש-AISSTREAM_API_KEY תקין (לוגים: docker compose logs maritime-worker --tail 50).',
      detailEn:
        'AIS snapshot is too old. Ensure maritime-worker is running and AISSTREAM_API_KEY is valid (docker compose logs maritime-worker --tail 50).',
      sparseHe:
        'צילום ישן — הפעל מחדש maritime-worker אם הוא נעצר.',
      sparseEn: 'Stale snapshot — restart maritime-worker if it stopped.',
    },
  };

  const degradedIssue =
    issue === 'key_missing' || issue === 'worker_down' || issue === 'snapshot_empty' || issue === 'snapshot_stale'
      ? issue
      : 'snapshot_stale';
  const copy = detailByIssue[degradedIssue];
  const showSparse = options.snapshotTotal < 100;

  return {
    headlineHe,
    headlineEn,
    detailHe: copy.detailHe,
    detailEn: copy.detailEn,
    sparseWarningHe: showSparse ? copy.sparseHe : null,
    sparseWarningEn: showSparse ? copy.sparseEn : null,
  };
}
