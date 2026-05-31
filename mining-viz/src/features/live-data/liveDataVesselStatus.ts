import type { OilLiveSyncStatus } from '../../api/oilLiveApi';
import type { MaritimeStatusMessages } from '../../lib/vessels/maritimeFeedStatus';
import { OIL_LIVE_MAP_VESSEL_FETCH_CAP } from './liveDataMapDefaults';

export type LiveDataVesselStatus = {
  headlineEn: string;
  headlineHe: string;
  detailEn: string | null;
  detailHe: string | null;
};

export function resolveLiveDataVesselStatus(options: {
  vesselsInView: number;
  syncStatus?: OilLiveSyncStatus | null;
  allMaritimeEnabled?: boolean;
  maritimeMessages?: MaritimeStatusMessages | null;
  inPersianGulfViewport?: boolean;
  vesselMeta?: {
    total_available?: number;
    returned_count?: number;
    cap_applied?: boolean;
    limit?: number;
  } | null;
}): LiveDataVesselStatus {
  const cap = options.vesselMeta?.limit ?? OIL_LIVE_MAP_VESSEL_FETCH_CAP;
  const inView = options.vesselsInView;
  const totalAvailable = options.vesselMeta?.total_available;
  const capApplied = Boolean(options.vesselMeta?.cap_applied);
  const dbLive = options.syncStatus?.live_vessel_count;
  const gapZones = options.syncStatus?.coverage_gap_watch_zone_count ?? 0;

  if (options.allMaritimeEnabled && options.maritimeMessages) {
    const m = options.maritimeMessages;
    const headlineEn =
      m.headlineEn.trim() ||
      `${inView.toLocaleString()} in view · cap ${cap.toLocaleString()} (global AIS)`;
    const headlineHe =
      m.headlineHe.trim() ||
      `${inView.toLocaleString()} בתצוגה · מגבלה ${cap.toLocaleString()} (AIS גלובלי)`;
  return {
      headlineEn,
      headlineHe,
      detailEn: m.sparseWarningEn ?? m.detailEn ?? null,
      detailHe: m.sparseWarningHe ?? m.detailHe ?? null,
    };
  }

  const headlineEn = `${inView.toLocaleString()} tankers in view · API cap ${cap.toLocaleString()}`;
  const headlineHe = `${inView.toLocaleString()} מכליות בתצוגה · מגבלת API ${cap.toLocaleString()}`;

  const sparseInView = inView === 0;
  const sparseLedger = dbLive != null && dbLive < 5;
  const gulfSparse = Boolean(options.inPersianGulfViewport && (sparseInView || sparseLedger));

  let detailEn: string | null = null;
  let detailHe: string | null = null;

  if (gulfSparse) {
    detailEn =
      'Open AIS is sparse in the Persian Gulf — empty map does not mean no traffic. Enable AIS coverage layer or run oil-live-intel-worker; demo seeds are off.';
    detailHe =
      'AIS פתוח דליל במפרץ הפרסי — מפה ריקה לא אומרת שאין תנועה. הפעילו שכבת כיסוי AIS או oil-live-intel-worker; נתוני הדגמה כבויים.';
  } else if (sparseInView && gapZones > 0) {
    detailEn = `No tankers in this view; ${gapZones} AIS gap watch zone(s) in the ledger — check the coverage layer.`;
    detailHe = `אין מכליות בתצוגה; ${gapZones} אזור(י) חוסר AIS במאגר — בדקו שכבת כיסוי.`;
  } else if (sparseInView) {
    detailEn =
      'No oil-live tankers in view — pan/zoom or wait for ingest; counts respect the 500-vessel fetch cap.';
    detailHe =
      'אין מכליות oil-live בתצוגה — הזיזו מפה או המתינו ל-ingest; הספירה מכבדת מגבלת 500 כלי שיט.';
  } else if (capApplied && totalAvailable != null) {
    detailEn = `${totalAvailable.toLocaleString()} vessels in bbox; API returned ${inView.toLocaleString()} (cap ${cap.toLocaleString()}, tankers prioritized).`;
    detailHe = `${totalAvailable.toLocaleString()} כלי שיט ב-bbox; ה-API החזיר ${inView.toLocaleString()} (מגבלה ${cap.toLocaleString()}, מכליות בעדיפות).`;
  } else if (inView >= cap * 0.9) {
    detailEn = `Near fetch cap (${cap}) — map shows a subset of live tankers in this bbox.`;
    detailHe = `קרוב למגבלת fetch (${cap}) — המפה מציגה תת-קבוצה של מכליות חיות ב-bbox זה.`;
  }

  return { headlineEn, headlineHe, detailEn, detailHe };
}
