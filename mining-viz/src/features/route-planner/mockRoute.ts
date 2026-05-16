import type { RoutePlannerApiResponse } from './types';

function interpolateLeg(
  a: [number, number],
  b: [number, number],
  steps: number,
): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.max(1, steps);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function buildDemoMap(
  supplier: { lat: number; lng: number },
  hub: { lat: number; lng: number },
  buyer: { lat: number; lng: number },
) {
  return {
    legs: [
      { path: interpolateLeg([supplier.lat, supplier.lng], [hub.lat, hub.lng], 10) },
      { path: interpolateLeg([hub.lat, hub.lng], [buyer.lat, buyer.lng], 12) },
    ],
    waypoints: [
      {
        lat: supplier.lat,
        lng: supplier.lng,
        role: 'origin' as const,
        label: ['ספק (מוצא)', 'Supplier (origin)'],
      },
      {
        lat: hub.lat,
        lng: hub.lng,
        role: 'transit' as const,
        label: ['מעבר (נקודת ימית)', 'Transit (ocean waypoint)'],
      },
      {
        lat: buyer.lat,
        lng: buyer.lng,
        role: 'destination' as const,
        label: ['קונה (יעד)', 'Buyer (destination)'],
      },
    ],
  };
}

/** Deterministic midpoint so legs arc slightly offshore */
function corridorHubFor(supplier: { lat: number; lng: number }, buyer: { lat: number; lng: number }) {
  const mx = (supplier.lat + buyer.lat) / 2;
  const my = (supplier.lng + buyer.lng) / 2;
  return {
    lat: Math.max(-60, Math.min(75, mx + 6)),
    lng: Math.max(-180, Math.min(180, my - 12)),
  };
}

/** Demo corridor seeded for West Africa → NW Europe preview */
export function getMockRouteResponse(): RoutePlannerApiResponse {
  const supplier = { lat: 5.548, lng: -0.192 };
  const buyer = { lat: 51.924, lng: 4.478 };
  const hub = corridorHubFor(supplier, buyer);

  return {
    source: 'mock',
    map: buildDemoMap(supplier, hub, buyer),
    breakdown: [
      {
        id: 'origin_dray',
        labelHe: 'הובלה מהמוצא (קילומטר ראשון)',
        labelEn: 'Origin dray / first mile',
        amountUsd: 4200,
        note: ['הערכת שער אופייני לנמל המוצא', 'Indicative port gate haul rate'],
      },
      {
        id: 'ocean',
        labelHe: 'משלוח ימי (FCL)',
        labelEn: 'Ocean FCL freight',
        amountUsd: 12800,
      },
      {
        id: 'insurance',
        labelHe: 'ביטוח מטען',
        labelEn: 'Cargo insurance',
        amountUsd: 910,
      },
      {
        id: 'duty',
        labelHe: 'עמילות ומסיסי יבוא',
        labelEn: 'Customs & import handling',
        amountUsd: 2400,
      },
    ],
    dueDiligence: [
      {
        id: 'supplier_kyb',
        labelHe: 'בדיקת ספק (KYB)',
        labelEn: 'Supplier KYB',
        status: 'pass',
        detail: ['רישום מתאים לשם המסחר', 'Trading name aligns with registry'],
      },
      {
        id: 'sanctions',
        labelHe: 'סנקציות משלוח/קונה',
        labelEn: 'Shipment / buyer sanctions',
        status: 'warn',
        detail: ['בעלי שליטה משניים טעונים בדיקה', 'Indirect ownership flagged for manual review'],
      },
      {
        id: 'incoterms',
        labelHe: 'התאמת Incoterms',
        labelEn: 'Incoterms alignment',
        status: 'pass',
      },
      {
        id: 'corridor_cover',
        labelHe: 'דרישות מבטח מסדרון',
        labelEn: 'Corridor insurer appetite',
        status: 'fail',
        detail: ['כיסוי מוגבל לפריקה בשטח מאושר', 'Discharge geography limited versus planned berth'],
      },
    ],
  };
}

/** Recomputes geometry from user picks; costs/DD cloned from seeded mock with light scaling hints */
export function mockResponseForPayload(supplier: { lat: number; lng: number }, buyer: { lat: number; lng: number }) {
  const base = getMockRouteResponse();
  const hub = corridorHubFor(supplier, buyer);
  const geoDist =
    Math.hypot(buyer.lat - supplier.lat, buyer.lng - supplier.lng) || 1;
  const factor = Math.min(2.25, Math.max(0.35, geoDist / 55));
  const map = buildDemoMap(supplier, hub, buyer);

  const breakdown = base.breakdown.map((line) =>
    line.id === 'ocean' || line.id === 'duty'
      ? { ...line, amountUsd: Math.round(line.amountUsd * factor) }
      : line,
  );

  return {
    ...base,
    source: 'mock' as const,
    map,
    breakdown,
  };
}
