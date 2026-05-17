import type { RoutePlannerApiResponse, CostLineItem, DueDiligenceCheck } from './types';

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
        label: ['ספק (מוצא)', 'Supplier (origin)'] as [string, string],
      },
      {
        lat: hub.lat,
        lng: hub.lng,
        role: 'transit' as const,
        label: ['מעבר (נמל ייצוא)', 'Transit (export port)'] as [string, string],
      },
      {
        lat: buyer.lat,
        lng: buyer.lng,
        role: 'destination' as const,
        label: ['קונה / יעד', 'Buyer / destination'] as [string, string],
      },
    ],
  };
}

/** Deterministic midpoint so legs arc slightly offshore */
function corridorHubFor(
  supplier: { lat: number; lng: number },
  buyer: { lat: number; lng: number },
) {
  const mx = (supplier.lat + buyer.lat) / 2;
  const my = (supplier.lng + buyer.lng) / 2;
  return {
    lat: Math.max(-60, Math.min(75, mx + 6)),
    lng: Math.max(-180, Math.min(180, my - 12)),
  };
}

/** Haversine distance in km */
function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

/** Pick the nearest African export port hub */
function nearestExportPort(supplier: { lat: number; lng: number }): {
  name: string;
  lat: number;
  lng: number;
  exportFeeUsd: number;
} {
  const ports = [
    { name: 'Port of Accra / Tema (Ghana)', lat: 5.618, lng: -0.017, exportFeeUsd: 3200 },
    { name: 'Port of Abidjan (Côte d\'Ivoire)', lat: 5.309, lng: -4.017, exportFeeUsd: 3800 },
    { name: 'Port of Lagos / Apapa (Nigeria)', lat: 6.443, lng: 3.385, exportFeeUsd: 4200 },
    { name: 'Port of Dakar (Senegal)', lat: 14.692, lng: -17.436, exportFeeUsd: 4000 },
    { name: 'Port of Mombasa (Kenya)', lat: -4.066, lng: 39.660, exportFeeUsd: 3600 },
    { name: 'Port of Dar es Salaam (Tanzania)', lat: -6.816, lng: 39.289, exportFeeUsd: 3400 },
    { name: 'Port of Durban (South Africa)', lat: -29.866, lng: 31.050, exportFeeUsd: 4800 },
    { name: 'Port of Beira (Mozambique)', lat: -19.828, lng: 34.839, exportFeeUsd: 3100 },
    { name: 'Port of Luanda (Angola)', lat: -8.815, lng: 13.231, exportFeeUsd: 3500 },
    { name: 'Port of Conakry (Guinea)', lat: 9.537, lng: -13.677, exportFeeUsd: 3000 },
    { name: 'Port of Lomé (Togo)', lat: 6.137, lng: 1.272, exportFeeUsd: 2900 },
    { name: 'Port of Cotonou (Benin)', lat: 6.362, lng: 2.420, exportFeeUsd: 3100 },
  ];
  let best = ports[0];
  let bestDist = Infinity;
  for (const p of ports) {
    const d = distanceKm(supplier, p);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

/** Build mode-aware cost breakdown */
function buildBreakdown(
  supplierToPortKm: number,
  portToBuyerKm: number,
  productType: string,
  shippingMethods: string[],
  exportFeeUsd: number,
): CostLineItem[] {
  const lines: CostLineItem[] = [];
  const isHighValue = productType.includes('gold') || productType.includes('lithium') || productType.includes('cobalt');
  const isPetroleum = productType.includes('petroleum') || productType.includes('oil') || productType.includes('gas');

  // Inland first-mile to export port
  const hasTruck = shippingMethods.includes('truck_inland');
  const hasRail = shippingMethods.includes('rail');

  if (hasTruck || hasRail) {
    const ratePerKm = hasRail ? 0.04 : 0.09; // USD/tonne-km
    const tonnes = 1000;
    const inlandCost = Math.round(supplierToPortKm * ratePerKm * tonnes);
    lines.push({
      id: 'inland_transport',
      labelHe: hasRail ? 'הובלת ברזל (ממכרה לנמל)' : 'הובלה יבשתית (ממכרה לנמל)',
      labelEn: hasRail ? 'Rail inland (mine to port)' : 'Road freight (mine → export port)',
      amountUsd: Math.max(1200, inlandCost),
      note: [
        `${Math.round(supplierToPortKm).toLocaleString()} ק"מ × ${ratePerKm} USD/טונה-ק"מ`,
        `${Math.round(supplierToPortKm).toLocaleString()} km × ${ratePerKm} USD/tonne-km`,
      ],
    });
  } else {
    lines.push({
      id: 'origin_dray',
      labelHe: 'הובלה מהמוצא (קילומטר ראשון)',
      labelEn: 'Origin dray / first mile',
      amountUsd: 2800,
      note: ['עלות משלוח מהמכרה לנמל היצוא', 'Haul from mine/site to export port gate'],
    });
  }

  // Export duties & port fees
  lines.push({
    id: 'export_duties',
    labelHe: 'מסים ייצוא + עמלת נמל',
    labelEn: 'Export duties + port handling',
    amountUsd: exportFeeUsd,
    note: [
      'על בסיס תעריפי הנמל הקרוב ביותר',
      'Based on nearest export port tariff schedule',
    ],
  });

  // Ocean freight
  if (shippingMethods.includes('sea_fcl') || shippingMethods.includes('sea_lcl')) {
    const isFcl = shippingMethods.includes('sea_fcl');
    const oceanRatePerKm = isPetroleum ? 0.003 : 0.0045;
    const oceanBase = Math.round(portToBuyerKm * oceanRatePerKm * 1000);
    lines.push({
      id: 'ocean_freight',
      labelHe: isFcl ? 'משלוח ימי FCL (מכולה מלאה)' : 'משלוח ימי LCL (קונסולידציה)',
      labelEn: isFcl ? 'Ocean FCL freight' : 'Ocean LCL / consolidated freight',
      amountUsd: Math.max(6000, oceanBase),
      note: [
        `${Math.round(portToBuyerKm).toLocaleString()} ימי מייל × ${oceanRatePerKm} USD/טונה-מייל`,
        `${Math.round(portToBuyerKm).toLocaleString()} sea km × ${oceanRatePerKm} USD/tonne-km`,
      ],
    });
  }

  // Air freight
  if (shippingMethods.includes('air')) {
    const airRate = 2.5;
    const airCost = Math.round(portToBuyerKm * airRate * (isHighValue ? 0.5 : 2));
    lines.push({
      id: 'air_freight',
      labelHe: 'מטען אווירי (IATA DGR)',
      labelEn: 'Air freight (IATA DGR)',
      amountUsd: Math.max(15000, airCost),
      note: [
        'מומלץ לסחורות יקרות-ערך בלבד. כולל אישורים IATA DGR.',
        'Recommended for high-value only. Includes IATA DGR permits.',
      ],
    });
  }

  // Cargo insurance
  const cargoValueUsd = isHighValue ? 2_800_000 : isPetroleum ? 900_000 : 400_000;
  const insuranceRate = isHighValue ? 0.003 : 0.002;
  lines.push({
    id: 'cargo_insurance',
    labelHe: 'ביטוח מטען (All-Risk)',
    labelEn: 'Cargo insurance (All-Risk)',
    amountUsd: Math.round(cargoValueUsd * insuranceRate),
    note: [
      `${(insuranceRate * 100).toFixed(2)}% מערך המטען המשוער`,
      `${(insuranceRate * 100).toFixed(2)}% of estimated cargo value`,
    ],
  });

  // Import duties & customs at destination
  const importDutyRate = isPetroleum ? 0.06 : isHighValue ? 0.02 : 0.04;
  lines.push({
    id: 'import_duties',
    labelHe: 'מסים יבוא + עמילות מכס',
    labelEn: 'Import duties + customs clearance',
    amountUsd: Math.round(cargoValueUsd * importDutyRate),
    note: [
      `${(importDutyRate * 100).toFixed(0)}% מסי יבוא + שירות עמיל מכס`,
      `${(importDutyRate * 100).toFixed(0)}% import tariff + customs broker fee`,
    ],
  });

  // Destination drayage
  lines.push({
    id: 'destination_dray',
    labelHe: 'הובלה מהנמל ליעד הסופי',
    labelEn: 'Destination dray / last mile',
    amountUsd: 3500,
    note: ['מהנמל למחסן / מזקקה / לקוח הקצה', 'Port gate to warehouse / refinery / end buyer'],
  });

  return lines;
}

function buildDueDiligence(
  productType: string,
  supplierLabel: string,
): DueDiligenceCheck[] {
  const isHighRisk = supplierLabel.toLowerCase().includes('drc') ||
    supplierLabel.toLowerCase().includes('congo') ||
    supplierLabel.toLowerCase().includes('mali') ||
    supplierLabel.toLowerCase().includes('sudan');

  return [
    {
      id: 'supplier_kyb',
      labelHe: 'בדיקת ספק (KYB / Know Your Business)',
      labelEn: 'Supplier KYB check',
      status: 'pass',
      detail: ['רישום מסחרי תקין ומוודא', 'Trading registration validated against national registry'],
    },
    {
      id: 'sanctions',
      labelHe: 'סנקציות OFAC / UN / EU',
      labelEn: 'OFAC / UN / EU sanctions screening',
      status: isHighRisk ? 'warn' : 'pass',
      detail: isHighRisk
        ? ['ספק ממיקום בעל סיכון גבוה — נדרשת בדיקה ידנית', 'Supplier in high-risk jurisdiction — manual review required']
        : ['לא נמצאו רשומות סנקציות', 'No sanctions records found'],
    },
    {
      id: 'conflict_minerals',
      labelHe: 'בדיקת מינרלים מאזורי סכסוך (3TG)',
      labelEn: 'Conflict minerals / 3TG check',
      status:
        productType.includes('cobalt') || productType.includes('gold') || isHighRisk
          ? 'warn'
          : 'pass',
      detail: [
        'נדרשת תיעוד OECD שרשרת אספקה לסחורות DRC/מינרלים קונפליקט',
        'OECD supply chain documentation required for conflict-risk minerals',
      ],
    },
    {
      id: 'corridor_cover',
      labelHe: 'כיסוי ביטוחי מסדרון',
      labelEn: 'Corridor insurer appetite',
      status: isHighRisk ? 'fail' : 'pass',
      detail: isHighRisk
        ? ['כיסוי מוגבל בגיאוגרפיה זו — דרוש ייחוד ביטוחי', 'Limited insurer appetite for this corridor — specialist policy required']
        : ['כיסוי מסדרון סטנדרטי זמין', 'Standard corridor cover available'],
    },
    {
      id: 'incoterms',
      labelHe: 'התאמת Incoterms',
      labelEn: 'Incoterms alignment',
      status: 'pass',
      detail: ['FOB נמל ייצוא מומלץ עבור עסקה זו', 'FOB export port recommended for this transaction'],
    },
    {
      id: 'transit_time',
      labelHe: 'זמן מעבר כולל (הערכה)',
      labelEn: 'Estimated total transit time',
      status: 'pass',
      detail: ['18–35 ימים ממכרה לנמל היעד (תלוי שיטת הובלה)', '18–35 days mine-to-destination port (method dependent)'],
    },
  ];
}

/** Demo corridor seeded for West Africa → NW Europe preview */
export function getMockRouteResponse(): RoutePlannerApiResponse {
  const supplier = { lat: 5.548, lng: -0.192 };
  const buyer = { lat: 51.924, lng: 4.478 };
  const hub = corridorHubFor(supplier, buyer);
  return mockResponseForPayload(supplier, buyer, 'gold_concentrate', ['sea_fcl', 'truck_inland']);
}

/** Recomputes geometry from user picks with full dynamic cost breakdown */
export function mockResponseForPayload(
  supplier: { lat: number; lng: number; label?: string },
  buyer: { lat: number; lng: number; label?: string },
  productType = 'gold_concentrate',
  shippingMethods: string[] = ['sea_fcl', 'truck_inland'],
): RoutePlannerApiResponse {
  const exportPort = nearestExportPort(supplier);
  const supplierToPortKm = distanceKm(supplier, exportPort);
  const portToBuyerKm = distanceKm(exportPort, buyer);
  const hub = { lat: exportPort.lat, lng: exportPort.lng };
  const map = buildDemoMap(supplier, hub, buyer);

  const breakdown = buildBreakdown(
    supplierToPortKm,
    portToBuyerKm,
    productType,
    shippingMethods,
    exportPort.exportFeeUsd,
  );

  // Annotate waypoints with real port name
  map.waypoints[1].label = [
    `נמל ייצוא: ${exportPort.name}`,
    `Export port: ${exportPort.name}`,
  ];

  return {
    source: 'mock',
    map,
    breakdown,
    dueDiligence: buildDueDiligence(productType, supplier.label ?? ''),
  };
}
