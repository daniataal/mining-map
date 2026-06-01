import type { EsgConservationZone } from '../esgConservationZones';
import type { LegalEvent } from '../../types';
import type { MaritimeFeedIssue } from './maritimeFeedStatus';
import type { MaritimeVessel, MaritimeVesselFeedResponse, MaritimeViewportBounds } from './types';

export type VesselAlertKind =
  | 'ais_stale'
  | 'ais_key_missing'
  | 'ais_worker_down'
  | 'ais_snapshot_empty'
  | 'persian_gulf_gap'
  | 'ais_viewport_gap'
  | 'vessel_proximity'
  | 'esg_zone'
  | 'sanctions';

export type VesselAlertSeverity = 'critical' | 'warning' | 'info';

export interface VesselAlert {
  id: string;
  kind: VesselAlertKind;
  severity: VesselAlertSeverity;
  titleEn: string;
  titleHe: string;
  messageEn: string;
  messageHe: string;
  sourceLabel: string;
  observedAt: string | null;
  vesselId?: string | null;
  vesselName?: string | null;
  distanceKm?: number | null;
}

export interface NearbyVesselSignal {
  vessel: MaritimeVessel;
  distanceKm: number;
  isDemo: boolean;
}

/** Persian Gulf core bbox (south, west, north, east) — mirrors backend maritime_intel. */
export const PERSIAN_GULF_CORE_BBOX: [number, number, number, number] = [22.0, 47.0, 30.5, 60.0];

export const DEFAULT_PROXIMITY_ALERT_RADIUS_KM = 150;
export const DEFAULT_PROXIMITY_CRITICAL_KM = 50;
export const DEFAULT_LICENSE_VIEWPORT_PADDING_DEG = 2.0;

const EARTH_RADIUS_KM = 6371;

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function isPointInBbox(
  lat: number,
  lng: number,
  bbox: [number, number, number, number],
): boolean {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

export function licenseViewportBounds(
  lat: number,
  lng: number,
  paddingDeg = DEFAULT_LICENSE_VIEWPORT_PADDING_DEG,
): MaritimeViewportBounds {
  return {
    south: lat - paddingDeg,
    west: lng - paddingDeg,
    north: lat + paddingDeg,
    east: lng + paddingDeg,
  };
}

export function isDemoMaritimeVessel(vessel: MaritimeVessel): boolean {
  const id = (vessel.id || '').trim().toLowerCase();
  if (id.startsWith('demo:')) return true;
  const source = (vessel.source_label || '').toLowerCase();
  return source.includes('demo') || source.includes('synthetic');
}

export function findNearbyVessels(
  vessels: MaritimeVessel[],
  licenseLat: number,
  licenseLng: number,
  maxRadiusKm = DEFAULT_PROXIMITY_ALERT_RADIUS_KM,
  includeDemo = false,
): NearbyVesselSignal[] {
  const signals: NearbyVesselSignal[] = [];
  for (const vessel of vessels) {
    if (!Number.isFinite(vessel.lat) || !Number.isFinite(vessel.lng)) continue;
    const demo = isDemoMaritimeVessel(vessel);
    if (demo && !includeDemo) continue;
    const distanceKm = haversineDistanceKm(licenseLat, licenseLng, vessel.lat, vessel.lng);
    if (distanceKm > maxRadiusKm) continue;
    signals.push({ vessel, distanceKm, isDemo: demo });
  }
  return signals.sort((a, b) => a.distanceKm - b.distanceKm);
}

function isOpenSanctionsEvent(event: LegalEvent): boolean {
  const discovered = (event.discoveredBy || '').toLowerCase();
  const sourceType = (event.sourceType || '').toLowerCase();
  const sourceName = (event.sourceName || '').toLowerCase();
  return (
    discovered === 'opensanctions' ||
    discovered === 'open_sanctions' ||
    sourceType === 'opensanctions' ||
    sourceName.includes('opensanctions')
  );
}

function fmtSpeedKnots(speed?: number | null): string {
  if (speed == null || !Number.isFinite(speed)) return 'n/a';
  return `${speed.toFixed(1)} kn`;
}

export interface BuildVesselAlertsInput {
  feed: MaritimeVesselFeedResponse | null | undefined;
  feedIssue: MaritimeFeedIssue;
  licenseLat?: number | null;
  licenseLng?: number | null;
  nearbySignals?: NearbyVesselSignal[];
  esgZone?: EsgConservationZone | null;
  legalEvents?: LegalEvent[];
  proximityRadiusKm?: number;
  proximityCriticalKm?: number;
}

export function buildVesselAlerts(input: BuildVesselAlertsInput): VesselAlert[] {
  const alerts: VesselAlert[] = [];
  const feed = input.feed;
  const dataAsOf = feed?.data_as_of ?? null;
  const nearby = input.nearbySignals ?? [];
  const proximityRadiusKm = input.proximityRadiusKm ?? DEFAULT_PROXIMITY_ALERT_RADIUS_KM;
  const proximityCriticalKm = input.proximityCriticalKm ?? DEFAULT_PROXIMITY_CRITICAL_KM;

  if (input.feedIssue === 'key_missing') {
    alerts.push({
      id: 'ais-key-missing',
      kind: 'ais_key_missing',
      severity: 'warning',
      titleEn: 'AIS feed unavailable — API key missing',
      titleHe: 'מעקב AIS לא זמין — חסר מפתח API',
      messageEn:
        'AISStream is not configured on the backend. Add AISSTREAM_API_KEY and restart oil-live-intel-worker before vessel proximity alerts can use live positions.',
      messageHe:
        'AISStream לא מוגדר ב-backend. הוסיפו AISSTREAM_API_KEY והפעילו מחדש את oil-live-intel-worker לפני שאותות קרבה יכולים להשתמש במיקומים חיים.',
      sourceLabel: 'AISStream config',
      observedAt: dataAsOf,
    });
  } else if (input.feedIssue === 'worker_down') {
    alerts.push({
      id: 'ais-worker-down',
      kind: 'ais_worker_down',
      severity: 'warning',
      titleEn: 'AIS snapshot unavailable',
      titleHe: 'צילום AIS לא זמין',
      messageEn:
        'oil-live-intel-worker is not producing fresh AIS positions in Postgres. Proximity alerts rely on persisted AIS rows and may be empty until the worker recovers.',
      messageHe:
        'oil-live-intel-worker לא מייצר צילום כלי שיט עדכני. התרעות קרבה מסתמכות על שורות AIS שמורות ועשויות להיות ריקות עד שה-worker יחזור.',
      sourceLabel: 'oil-live-intel-worker',
      observedAt: feed?.worker && typeof feed.worker === 'object'
        ? String((feed.worker as { last_success_at?: unknown }).last_success_at ?? dataAsOf ?? '')
        : dataAsOf,
    });
  } else if (input.feedIssue === 'snapshot_empty') {
    alerts.push({
      id: 'ais-snapshot-empty',
      kind: 'ais_snapshot_empty',
      severity: 'info',
      titleEn: 'AIS snapshot still sparse',
      titleHe: 'צילום AIS עדיין דליל',
      messageEn:
        'The vessel feed has fewer than 100 persisted positions. Wait for ingest cycles or widen the capture window before expecting nearby-vessel alerts.',
      messageHe:
        'מאגר כלי השיט מכיל פחות מ-100 מיקומים שמורים. המתינו למחזורי ingest או הרחיבו את חלון הלכידה לפני ציפייה להתרעות קרבה.',
      sourceLabel: 'AIS snapshot',
      observedAt: dataAsOf,
    });
  } else if (input.feedIssue === 'snapshot_stale' || feed?.stale) {
    alerts.push({
      id: 'ais-stale',
      kind: 'ais_stale',
      severity: 'warning',
      titleEn: 'Stale AIS snapshot',
      titleHe: 'צילום AIS ישן',
      messageEn: feed?.snapshot_age_seconds != null
        ? `Latest persisted AIS snapshot is ${Math.round(feed.snapshot_age_seconds / 60)} minutes old. Treat proximity signals as delayed, not live.`
        : 'Latest persisted AIS snapshot is older than the configured TTL. Treat proximity signals as delayed, not live.',
      messageHe: feed?.snapshot_age_seconds != null
        ? `צילום AIS האחרון בן ${Math.round(feed.snapshot_age_seconds / 60)} דקות. התייחסו לאותות קרבה כמושהים, לא חיים.`
        : 'צילום AIS האחרון ישן מה-TTL המוגדר. התייחסו לאותות קרבה כמושהים, לא חיים.',
      sourceLabel: 'AIS snapshot',
      observedAt: dataAsOf,
    });
  }

  if (feed?.aisstream_persian_gulf_coverage_gap) {
    const inGulf =
      input.licenseLat != null &&
      input.licenseLng != null &&
      isPointInBbox(input.licenseLat, input.licenseLng, PERSIAN_GULF_CORE_BBOX);
    alerts.push({
      id: 'persian-gulf-gap',
      kind: 'persian_gulf_gap',
      severity: inGulf ? 'critical' : 'warning',
      titleEn: 'Persian Gulf AIS coverage gap',
      titleHe: 'פער כיסוי AIS במפרץ הפרסי',
      messageEn: inGulf
        ? 'AISStream upstream skips much of the Persian Gulf. Live vessel positions near this license may be missing even when the global feed looks healthy.'
        : 'AISStream upstream skips much of the Persian Gulf. Licenses in the Gulf may have incomplete nearby-vessel coverage.',
      messageHe: inGulf
        ? 'AISStream מדלג על חלקים גדולים מהמפרץ הפרסי. מיקומי כלי שיט חיים ליד רישיון זה עלולים להיות חסרים גם כשהמאגר הגלובלי נראה תקין.'
        : 'AISStream מדלג על חלקים גדולים מהמפרץ הפרסי. רישיונות במפרץ עלולים לקבל כיסוי קרבה לא שלם.',
      sourceLabel: 'AISStream upstream',
      observedAt: dataAsOf,
    });
  }

  if (feed?.viewport_ais_coverage_gap) {
    alerts.push({
      id: 'viewport-ais-gap',
      kind: 'ais_viewport_gap',
      severity: 'info',
      titleEn: 'No live AIS in this viewport',
      titleHe: 'אין AIS חי בתצוגה זו',
      messageEn:
        'The global vessel feed is healthy but no live AIS rows were observed in the bbox around this license. Pan the map or expand oil-live-intel-worker watches if you expect traffic here.',
      messageHe:
        'מאגר כלי השיט הגלובלי תקין אך לא נצפו שורות AIS חיות בתיבה סביב רישיון זה. הזיזו את המפה או הרחיבו את אזורי oil-live-intel-worker אם מצפים לתנועה כאן.',
      sourceLabel: 'AIS viewport',
      observedAt: dataAsOf,
    });
  }

  if (input.esgZone) {
    alerts.push({
      id: `esg-zone-${input.esgZone.name}`,
      kind: 'esg_zone',
      severity: 'warning',
      titleEn: 'License inside protected conservation buffer',
      titleHe: 'רישיון בתוך מרחב שמור',
      messageEn: `This concession intersects the ${input.esgZone.name} overlay (${input.esgZone.zoneType}). Vessel logistics near protected buffers may trigger additional ESG review.`,
      messageHe: `קונססיה זו חותכת את שכבת ${input.esgZone.name} (${input.esgZone.zoneType}). לוגיסטיקה ימית ליד מרחבים מוגנים עלולה לדרוש בדיקת ESG נוספת.`,
      sourceLabel: input.esgZone.source || 'ESG conservation overlay',
      observedAt: null,
    });
  }

  for (const event of input.legalEvents ?? []) {
    if (!isOpenSanctionsEvent(event)) continue;
    alerts.push({
      id: `sanctions-${event.id}`,
      kind: 'sanctions',
      severity: 'critical',
      titleEn: 'OpenSanctions match linked to entity',
      titleHe: 'התאמה ב-OpenSanctions מקושרת לישות',
      messageEn: event.summary || event.caseTitle || 'An OpenSanctions watchlist match is linked to this license entity.',
      messageHe: event.summary || event.caseTitle || 'התאמת רשימת מעקב OpenSanctions מקושרת לישות של רישיון זה.',
      sourceLabel: event.sourceName || 'OpenSanctions',
      observedAt: event.lastSeenAt || event.filedDate || event.createdAt || null,
    });
  }

  for (const signal of nearby) {
    const { vessel, distanceKm, isDemo } = signal;
    if (isDemo) continue;
    const observedAt = vessel.observed_at || vessel.last_seen_at || dataAsOf;
    alerts.push({
      id: `proximity-${vessel.id}`,
      kind: 'vessel_proximity',
      severity: distanceKm <= proximityCriticalKm ? 'critical' : 'warning',
      titleEn: `AIS vessel within ${distanceKm.toFixed(0)} km`,
      titleHe: `כלי שיט AIS במרחק ${distanceKm.toFixed(0)} ק"מ`,
      messageEn: `${vessel.vessel_name || vessel.mmsi} (${vessel.ship_type_label || 'Unknown type'}) observed ${distanceKm.toFixed(1)} km from the license at ${fmtSpeedKnots(vessel.speed_knots)}.`,
      messageHe: `${vessel.vessel_name || vessel.mmsi} (${vessel.ship_type_label || 'סוג לא ידוע'}) נצפה ${distanceKm.toFixed(1)} ק"מ מהרישיון במהירות ${fmtSpeedKnots(vessel.speed_knots)}.`,
      sourceLabel: vessel.source_label || 'AIS snapshot',
      observedAt,
      vesselId: vessel.id,
      vesselName: vessel.vessel_name,
      distanceKm,
    });
  }

  if (
    nearby.length === 0 &&
    input.licenseLat != null &&
    input.licenseLng != null &&
    input.feedIssue == null &&
    feed &&
    !feed.stale
  ) {
    // No alert row — empty state handled in UI. Only add informational note when feed is healthy but empty.
  }

  const severityRank: Record<VesselAlertSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return alerts.sort((a, b) => {
    const severityDiff = severityRank[a.severity] - severityRank[b.severity];
    if (severityDiff !== 0) return severityDiff;
    const aTime = a.observedAt ? Date.parse(a.observedAt) : 0;
    const bTime = b.observedAt ? Date.parse(b.observedAt) : 0;
    return bTime - aTime;
  });
}

export function filterAlertsWithinRadius(
  alerts: VesselAlert[],
  maxRadiusKm = DEFAULT_PROXIMITY_ALERT_RADIUS_KM,
): VesselAlert[] {
  return alerts.filter(
    (alert) => alert.kind !== 'vessel_proximity' || (alert.distanceKm ?? Infinity) <= maxRadiusKm,
  );
}
