import type { RouteLeg, RoutePlanOption, RoutePlannerApiResponse, CostLineItem, DueDiligenceCheck } from './types';

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

/** Great-circle segment (matches backend routing_geometry.great_circle_geometry). */
function greatCircleLeg(
  a: [number, number],
  b: [number, number],
  steps = 14,
): [number, number][] {
  const [aLat, aLng] = a;
  const [bLat, bLng] = b;
  const lat1 = (aLat * Math.PI) / 180;
  const lng1 = (aLng * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const lng2 = (bLng * Math.PI) / 180;
  const delta =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
      ),
    );
  if (delta < 1e-9) return [a, b];
  const out: [number, number][] = [];
  const n = Math.max(2, steps);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const aa = Math.sin((1 - f) * delta) / Math.sin(delta);
    const bb = Math.sin(f * delta) / Math.sin(delta);
    const x = aa * Math.cos(lat1) * Math.cos(lng1) + bb * Math.cos(lat2) * Math.cos(lng2);
    const y = aa * Math.cos(lat1) * Math.sin(lng1) + bb * Math.cos(lat2) * Math.sin(lng2);
    const z = aa * Math.sin(lat1) + bb * Math.sin(lat2);
    const lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
    const lng = (Math.atan2(y, x) * 180) / Math.PI;
    out.push([lat, lng]);
  }
  return out;
}

function concatPaths(...segments: [number, number][][]): [number, number][] {
  const out: [number, number][] = [];
  for (const segment of segments) {
    if (!segment.length) continue;
    if (!out.length) {
      out.push(...segment);
      continue;
    }
    out.push(...segment.slice(1));
  }
  return out;
}

/** Offshore waypoints aligned with backend route_planner SEA_ANCHORS. */
const SEA_OFFSHORE_ANCHORS: Record<string, { lat: number; lng: number }> = {
  west_africa: { lat: 3, lng: -12 },
  atlantic_africa: { lat: 20, lng: -15 },
  gibraltar: { lat: 35.96, lng: -5.6 },
  western_med: { lat: 36.5, lng: 5 },
  east_med: { lat: 34.2, lng: 27 },
  english_channel: { lat: 50.05, lng: 1.2 },
  bab_el_mandeb: { lat: 12.61, lng: 43.33 },
  suez: { lat: 29.96, lng: 32.55 },
  cape: { lat: -35, lng: 18.2 },
  mid_atlantic: { lat: 38, lng: -35 },
};

/** OSRM driving profile: Haifa Port → Ben Gurion (TLV), coastal Route 2 corridor. */
const HAIFA_TO_TLV_ROAD: [number, number][] = [
  [32.81903, 34.98993],
  [32.81747, 34.99938],
  [32.81135, 35.00438],
  [32.79787, 35.02739],
  [32.78937, 35.03699],
  [32.7482, 35.07694],
  [32.72392, 35.0991],
  [32.72502, 35.10031],
  [32.70851, 35.10002],
  [32.67117, 35.10132],
  [32.65327, 35.09372],
  [32.6385, 35.06605],
  [32.60234, 35.04419],
  [32.57395, 35.04376],
  [32.54561, 35.03106],
  [32.52224, 35.02672],
  [32.48408, 35.0329],
  [32.44961, 35.03643],
  [32.3838, 35.01865],
  [32.30005, 35.01115],
  [32.14835, 34.96253],
  [32.07174, 34.93391],
  [32.06821, 34.90361],
  [32.02407, 34.90792],
  [31.99137, 34.90431],
  [31.98975, 34.89691],
  [31.98748, 34.89165],
  [31.99678, 34.87359],
  [32.00578, 34.86467],
  [32.00819, 34.86824],
];

const SIM_AIR_HUBS: Array<{ name: string; lat: number; lng: number; country: string }> = [
  { name: 'Kotoka International Airport', lat: 5.605, lng: -0.167, country: 'Ghana' },
  { name: 'Ben Gurion Airport (TLV)', lat: 32.011, lng: 34.87, country: 'Israel' },
  { name: 'OR Tambo International Airport', lat: -26.133, lng: 28.242, country: 'South Africa' },
  { name: 'Amsterdam Schiphol Airport', lat: 52.31, lng: 4.768, country: 'Netherlands' },
  { name: 'Brussels Airport', lat: 50.901, lng: 4.484, country: 'Belgium' },
];

function isEurope(lat: number, lng: number): boolean {
  return lat >= 35 && lat <= 72 && lng >= -15 && lng <= 45;
}

function isEasternMediterranean(lat: number, lng: number): boolean {
  return lat >= 28 && lat < 35 && lng >= 25 && lng <= 42;
}

function isMediterraneanDestination(lat: number, lng: number): boolean {
  return isEurope(lat, lng) || isEasternMediterranean(lat, lng);
}

function isWestAfrica(lat: number, lng: number): boolean {
  return lat >= -10 && lat <= 25 && lng >= -25 && lng <= 20;
}

function isEastOrSouthAfrica(lat: number, lng: number): boolean {
  return lat >= -36 && lat <= 16 && lng >= 20 && lng <= 55;
}

function atlanticToMediterraneanAnchorIds(destLat: number, destLng: number): string[] {
  const base = ['west_africa', 'atlantic_africa', 'gibraltar', 'western_med'];
  return isEasternMediterranean(destLat, destLng) ? [...base, 'east_med'] : [...base, 'english_channel'];
}

function seaAnchorIds(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): string[] {
  const { lat: oLat, lng: oLng } = origin;
  const { lat: dLat, lng: dLng } = destination;
  if (isMediterraneanDestination(dLat, dLng)) {
    if (isWestAfrica(oLat, oLng)) return atlanticToMediterraneanAnchorIds(dLat, dLng);
    if (isEastOrSouthAfrica(oLat, oLng)) {
      return isEasternMediterranean(dLat, dLng)
        ? ['bab_el_mandeb', 'suez', 'east_med']
        : ['bab_el_mandeb', 'suez', 'east_med', 'gibraltar', 'english_channel'];
    }
    if (isEurope(oLat, oLng)) {
      return isEasternMediterranean(dLat, dLng)
        ? ['english_channel', 'gibraltar', 'western_med', 'east_med']
        : ['english_channel', 'gibraltar', 'western_med'];
    }
    if (isEasternMediterranean(oLat, oLng) && isEurope(dLat, dLng)) {
      return ['east_med', 'western_med', 'gibraltar', 'english_channel'];
    }
  }
  return [];
}

function buildSeaCorridorPath(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): [number, number][] {
  const anchorIds = seaAnchorIds(from, to);
  const waypoints: [number, number][] = [[from.lat, from.lng]];
  for (const id of anchorIds) {
    const anchor = SEA_OFFSHORE_ANCHORS[id];
    if (anchor) waypoints.push([anchor.lat, anchor.lng]);
  }
  waypoints.push([to.lat, to.lng]);
  const segments: [number, number][][] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    segments.push(greatCircleLeg(waypoints[i], waypoints[i + 1], 14));
  }
  return concatPaths(...segments);
}

function isAirportDestination(buyer: { lat: number; lng: number; label?: string }): boolean {
  const label = (buyer.label ?? '').toLowerCase();
  return label.includes('airport') || label.includes('ben gurion') || label.includes('(tlv)');
}

function nearPoint(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  maxKm: number,
): boolean {
  return distanceKm(a, b) <= maxKm;
}

function haifaTlvRoadPath(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): [number, number][] | null {
  const haifa = { lat: 32.819, lng: 34.99 };
  const tlv = { lat: 32.011, lng: 34.87 };
  if (nearPoint(from, haifa, 30) && nearPoint(to, tlv, 30)) return [...HAIFA_TO_TLV_ROAD];
  if (nearPoint(from, tlv, 30) && nearPoint(to, haifa, 30)) return [...HAIFA_TO_TLV_ROAD].reverse();
  return null;
}

function buildRoadPath(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): [number, number][] {
  const corridor = haifaTlvRoadPath(from, to);
  if (corridor) return corridor;
  const dist = distanceKm(from, to);
  const steps = Math.max(8, Math.min(24, Math.round(dist / 12)));
  return interpolateLeg([from.lat, from.lng], [to.lat, to.lng], steps);
}

function nearestAirHub(
  point: { lat: number; lng: number },
  country?: string,
): { name: string; lat: number; lng: number } {
  const countryKey = country?.trim().toLowerCase();
  const pool = countryKey
    ? SIM_AIR_HUBS.filter((h) => h.country.toLowerCase() === countryKey)
    : SIM_AIR_HUBS;
  const hubs = pool.length ? pool : SIM_AIR_HUBS;
  let best = hubs[0];
  let bestDist = Infinity;
  for (const hub of hubs) {
    const d = distanceKm(point, hub);
    if (d < bestDist) {
      bestDist = d;
      best = hub;
    }
  }
  return best;
}

function inlandMethod(shippingMethods: string[]): RouteLeg['method'] {
  return shippingMethods.includes('rail') ? 'rail' : 'road';
}

/** Staged map overlay aligned with backend route_planner (inland → trunk → inland). */
function buildDemoMap(
  supplier: { lat: number; lng: number; label?: string },
  exportPort: { lat: number; lng: number; name: string },
  buyer: { lat: number; lng: number; label?: string },
  shippingMethods: string[],
) {
  const hasSea = shippingMethods.includes('sea_fcl') || shippingMethods.includes('sea_lcl');
  const hasAir = shippingMethods.includes('air');
  const inland = inlandMethod(shippingMethods);
  const legs: RouteLeg[] = [];
  const transitWaypoints: Array<{
    lat: number;
    lng: number;
    role: 'transit';
    label: [string, string];
  }> = [];

  if (hasAir && !hasSea) {
    const exportAirport = nearestAirHub(supplier);
    const importAirport = nearestAirHub(buyer);
    legs.push(
      {
        path: buildRoadPath(supplier, exportAirport),
        method: inland,
        label: `Road: supplier → ${exportAirport.name}`,
        toName: exportAirport.name,
        toKind: 'airport',
        hubLabel: exportAirport.name,
      },
      {
        path: greatCircleLeg(
          [exportAirport.lat, exportAirport.lng],
          [importAirport.lat, importAirport.lng],
          24,
        ),
        method: 'air',
        label: `Air: ${exportAirport.name} → ${importAirport.name}`,
        toName: importAirport.name,
        toKind: 'airport',
        hubLabel: importAirport.name,
      },
      {
        path: buildRoadPath(importAirport, buyer),
        method: inland,
        label: `Road: ${importAirport.name} → buyer`,
      },
    );
    transitWaypoints.push(
      { lat: exportAirport.lat, lng: exportAirport.lng, role: 'transit', label: ['נמל תעופה ייצוא', 'Export airport'] },
      { lat: importAirport.lat, lng: importAirport.lng, role: 'transit', label: ['נמל תעופה יבוא', 'Import airport'] },
    );
  } else if (hasSea) {
    const importPort = resolveImportPort(buyer);
    const needsPortDelivery = distanceKm(importPort, buyer) > 8 || isAirportDestination(buyer);
    legs.push(
      {
        path: buildRoadPath(supplier, exportPort),
        method: inland,
        label: `Road to port: ${exportPort.name}`,
        toName: exportPort.name,
        toKind: 'port',
        hubLabel: exportPort.name,
      },
      {
        path: buildSeaCorridorPath(exportPort, importPort),
        method: 'sea',
        label: `Sea leg: ${exportPort.name} → ${importPort.name}`,
        toName: importPort.name,
        toKind: 'port',
        hubLabel: importPort.name,
      },
    );
    if (needsPortDelivery) {
      legs.push({
        path: buildRoadPath(importPort, buyer),
        method: 'road',
        label: isAirportDestination(buyer)
          ? `Road: ${importPort.name} → ${buyer.label ?? 'airport'}`
          : `Road: ${importPort.name} → buyer`,
        toName: buyer.label,
        toKind: isAirportDestination(buyer) ? 'airport' : 'destination',
      });
    }
    transitWaypoints.push({
      lat: exportPort.lat,
      lng: exportPort.lng,
      role: 'transit',
      label: [`נמל ייצוא: ${exportPort.name}`, `Export port: ${exportPort.name}`],
    });
    if (needsPortDelivery) {
      transitWaypoints.push({
        lat: importPort.lat,
        lng: importPort.lng,
        role: 'transit',
        label: [`נמל יבוא: ${importPort.name}`, `Import port: ${importPort.name}`],
      });
    }
  } else {
    legs.push({
      path: interpolateLeg([supplier.lat, supplier.lng], [buyer.lat, buyer.lng], 14),
      method: inland,
      label: 'Road: direct inland route',
    });
  }

  return {
    legs,
    waypoints: [
      {
        lat: supplier.lat,
        lng: supplier.lng,
        role: 'origin' as const,
        label: ['ספק (מוצא)', 'Supplier (origin)'] as [string, string],
      },
      ...transitWaypoints,
      {
        lat: buyer.lat,
        lng: buyer.lng,
        role: 'destination' as const,
        label: ['קונה / יעד', 'Buyer / destination'] as [string, string],
      },
    ],
  };
}

function countryKey(country?: string): string {
  return (country ?? '').trim().toLowerCase();
}

/** Export port from declared supplier country when known (matches backend canonical hubs). */
function exportPortForCountry(country?: string): { name: string; lat: number; lng: number; exportFeeUsd: number } | null {
  const key = countryKey(country);
  if (key.includes('ghana')) {
    return { name: 'Port of Accra / Tema (Ghana)', lat: 5.618, lng: -0.017, exportFeeUsd: 3200 };
  }
  if (key.includes('israel')) {
    return { name: 'Haifa Port', lat: 32.819, lng: 34.99, exportFeeUsd: 2800 };
  }
  return null;
}

/** Import seaport for simulation trunk termination (aligned with buyer region / country). */
function resolveImportPort(buyer: { lat: number; lng: number; label?: string; country?: string }): {
  name: string;
  lat: number;
  lng: number;
} {
  const key = countryKey(buyer.country);
  if (key.includes('israel') || isEasternMediterranean(buyer.lat, buyer.lng)) {
    return { name: 'Haifa Port', lat: 32.819, lng: 34.99 };
  }
  if (key.includes('ghana')) {
    return { name: 'Port of Accra / Tema (Ghana)', lat: 5.618, lng: -0.017 };
  }
  if (isEasternMediterranean(buyer.lat, buyer.lng)) {
    return { name: 'Haifa Port', lat: 32.819, lng: 34.99 };
  }
  if (buyer.lat >= 48 && buyer.lat <= 56 && buyer.lng >= -2 && buyer.lng <= 12) {
    return { name: 'Rotterdam', lat: 51.924, lng: 4.478 };
  }
  return {
    name: 'Import port',
    lat: buyer.lat,
    lng: Math.max(-180, Math.min(180, buyer.lng + (buyer.lng >= 0 ? -4 : 4))),
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

/** Pick export port: declared supplier country first, else nearest catalog port. */
function nearestExportPort(supplier: { lat: number; lng: number; country?: string }): {
  name: string;
  lat: number;
  lng: number;
  exportFeeUsd: number;
} {
  const byCountry = exportPortForCountry(supplier.country);
  if (byCountry) return byCountry;

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
  return mockResponseForPayload(supplier, buyer, 'gold_concentrate', ['sea_fcl', 'truck_inland']);
}

function isInlandOrigin(supplier: { lat: number; lng: number }): boolean {
  const port = nearestExportPort(supplier);
  return distanceKm(supplier, port) > 450;
}

function secondExportPort(supplier: { lat: number; lng: number }, primary: { name: string; lat: number; lng: number }) {
  const ports = [
    { name: 'Port of Dar es Salaam (Tanzania)', lat: -6.816, lng: 39.289, exportFeeUsd: 3400 },
    { name: 'Port of Durban (South Africa)', lat: -29.866, lng: 31.050, exportFeeUsd: 4800 },
    { name: 'Port of Beira (Mozambique)', lat: -19.828, lng: 34.839, exportFeeUsd: 3100 },
    { name: 'Port of Mombasa (Kenya)', lat: -4.066, lng: 39.660, exportFeeUsd: 3600 },
  ];
  const ranked = ports
    .filter((p) => p.name !== primary.name)
    .sort((a, b) => distanceKm(supplier, a) - distanceKm(supplier, b));
  return ranked[0] ?? primary;
}

/** Recomputes geometry from user picks with full dynamic cost breakdown */
export function mockResponseForPayload(
  supplier: { lat: number; lng: number; label?: string; country?: string },
  buyer: { lat: number; lng: number; label?: string; country?: string },
  productType = 'gold_concentrate',
  shippingMethods: string[] = ['sea_fcl', 'truck_inland'],
): RoutePlannerApiResponse {
  const exportPort = nearestExportPort(supplier);
  const supplierToPortKm = distanceKm(supplier, exportPort);
  const portToBuyerKm = distanceKm(exportPort, buyer);
  const map = buildDemoMap(supplier, exportPort, buyer, shippingMethods);
  const hasSea = shippingMethods.includes('sea_fcl') || shippingMethods.includes('sea_lcl');
  const mixedSeaAirportNotes =
    hasSea && isAirportDestination(buyer)
      ? [
          'Sea mode: trunk to Haifa Port (Israel), then road to Ben Gurion (TLV). For direct air trunk, use air freight only.',
        ]
      : [];

  const breakdown = buildBreakdown(
    supplierToPortKm,
    portToBuyerKm,
    productType,
    shippingMethods,
    exportPort.exportFeeUsd,
  );

  const totalCostUsd = breakdown.reduce((s, line) => s + line.amountUsd, 0);
  const inland = isInlandOrigin(supplier);
  const hasAir = shippingMethods.includes('air');

  const routeAlternatives: RoutePlanOption[] = [];
  if (inland && hasSea) {
    const altPort = secondExportPort(supplier, exportPort);
    const altMap = buildDemoMap(supplier, altPort, buyer, shippingMethods);
    const altBreakdown = buildBreakdown(
      distanceKm(supplier, altPort),
      distanceKm(altPort, buyer),
      productType,
      shippingMethods,
      altPort.exportFeeUsd,
    );
    routeAlternatives.push({
      id: `sea_${altPort.name.toLowerCase().replace(/\W+/g, '_').slice(0, 24)}`,
      label: `Alternative: export via ${altPort.name}`,
      labelHe: `חלופה: ייצוא דרך ${altPort.name}`,
      labelEn: `Alternative: export via ${altPort.name}`,
      isRecommended: false,
      map: altMap,
      breakdown: altBreakdown,
      totalCostUsd: altBreakdown.reduce((s, line) => s + line.amountUsd, 0),
    });
  }
  if (inland && hasAir && hasSea) {
    const airMap = buildDemoMap(supplier, exportPort, buyer, ['air', ...shippingMethods.filter((m) => m !== 'sea_fcl' && m !== 'sea_lcl')]);
    const airBreakdown = buildBreakdown(supplierToPortKm, portToBuyerKm, productType, ['air', 'truck_inland'], exportPort.exportFeeUsd);
    routeAlternatives.push({
      id: 'air',
      label: 'Alternative: via air freight',
      labelHe: 'חלופה: מטען אווירי',
      labelEn: 'Alternative: via air freight',
      isRecommended: false,
      map: airMap,
      breakdown: airBreakdown,
      totalCostUsd: airBreakdown.reduce((s, line) => s + line.amountUsd, 0),
    });
  }

  return {
    source: 'simulation',
    map,
    breakdown,
    recommendedPlanId: 'recommended',
    routeAlternatives,
    landlockedHint: inland
      ? 'Origin is inland or landlocked: compare export-port and trunk-mode alternatives separately before execution.'
      : undefined,
    dueDiligence: buildDueDiligence(productType, supplier.label ?? ''),
    limitations: [
      'Simulation mode: live route or due-diligence services were unavailable.',
      'Costs are deterministic planning estimates, not executable carrier quotes.',
      ...mixedSeaAirportNotes,
    ],
    routeAssumptions: [
      'Simulation approximates inland pickup to an export port, trunk movement, and final delivery.',
      routeAlternatives.length > 0
        ? 'Multiple sequential alternatives are available for comparison (sea vs air or second export port).'
        : 'Single sequential corridor in simulation.',
      'Use a live route run before using this for deal execution.',
    ],
    dueDiligenceRecommendation: 'escalate',
    blockers: [],
    warnings: [
      'Simulation results require live due-diligence verification before proceeding.',
    ],
    cargoValueUsd: undefined,
  };
}
