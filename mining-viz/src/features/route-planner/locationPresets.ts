import type { MiningLicense } from '../../types';
import { countriesList } from '../../data/countries';
import { normalizeCountryFocusQuery, resolveCountryFocusToken } from '../../lib/countryFocusMatch';

export interface LocationPreset {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country?: string;
  licenseId?: string;
  commodity?: string;
  sector?: string;
  group: 'licenses' | 'ports' | 'buyers' | 'catalog';
}

/** Mirrors backend MARITIME_HUBS in route_planner.py */
export const MARITIME_HUB_PRESETS: LocationPreset[] = [
  { id: 'hub-dar', name: 'Dar es Salaam Port', lat: -6.823, lng: 39.289, country: 'Tanzania', group: 'catalog' },
  { id: 'hub-beira', name: 'Port of Beira', lat: -19.823, lng: 34.838, country: 'Mozambique', group: 'catalog' },
  { id: 'hub-durban', name: 'Port of Durban', lat: -29.868, lng: 31.05, country: 'South Africa', group: 'catalog' },
  { id: 'hub-maputo', name: 'Port of Maputo', lat: -25.967, lng: 32.567, country: 'Mozambique', group: 'catalog' },
  { id: 'hub-walvis', name: 'Port of Walvis Bay', lat: -22.957, lng: 14.505, country: 'Namibia', group: 'catalog' },
  { id: 'hub-mombasa', name: 'Port of Mombasa', lat: -4.043, lng: 39.668, country: 'Kenya', group: 'catalog' },
  { id: 'hub-tema', name: 'Port of Tema', lat: 5.64, lng: 0.018, country: 'Ghana', group: 'catalog' },
  { id: 'hub-lagos', name: 'Port of Lagos', lat: 6.45, lng: 3.39, country: 'Nigeria', group: 'catalog' },
  { id: 'hub-abidjan', name: 'Port of Abidjan', lat: 5.292, lng: -4.013, country: "Cote d'Ivoire", group: 'catalog' },
  { id: 'hub-dakar', name: 'Port of Dakar', lat: 14.681, lng: -17.432, country: 'Senegal', group: 'catalog' },
  { id: 'hub-portsaid', name: 'Port Said', lat: 31.265, lng: 32.301, country: 'Egypt', group: 'catalog' },
  { id: 'hub-jebelali', name: 'Jebel Ali Port', lat: 24.996, lng: 55.06, country: 'United Arab Emirates', group: 'catalog' },
  { id: 'hub-mumbai', name: 'Mumbai JNPT', lat: 18.944, lng: 72.954, country: 'India', group: 'catalog' },
  { id: 'hub-singapore', name: 'Port of Singapore', lat: 1.264, lng: 103.84, country: 'Singapore', group: 'catalog' },
  { id: 'hub-shanghai', name: 'Port of Shanghai', lat: 31.23, lng: 121.473, country: 'China', group: 'catalog' },
  { id: 'hub-rotterdam', name: 'Port of Rotterdam', lat: 51.924, lng: 4.477, country: 'Netherlands', group: 'catalog' },
  { id: 'hub-antwerp', name: 'Port of Antwerp', lat: 51.219, lng: 4.402, country: 'Belgium', group: 'catalog' },
  { id: 'hub-hamburg', name: 'Port of Hamburg', lat: 53.545, lng: 9.97, country: 'Germany', group: 'catalog' },
  { id: 'hub-houston', name: 'Port of Houston', lat: 29.735, lng: -95.275, country: 'United States', group: 'catalog' },
  { id: 'hub-la', name: 'Port of Los Angeles', lat: 33.729, lng: -118.269, country: 'United States', group: 'catalog' },
  { id: 'hub-santos', name: 'Port of Santos', lat: -23.96, lng: -46.333, country: 'Brazil', group: 'catalog' },
  { id: 'hub-haifa', name: 'Haifa Port', lat: 32.819, lng: 34.99, country: 'Israel', group: 'catalog' },
  { id: 'hub-eilat', name: 'Port of Eilat', lat: 29.557, lng: 34.952, country: 'Israel', group: 'catalog' },
  { id: 'hub-ashdod', name: 'Port of Ashdod', lat: 31.801, lng: 34.645, country: 'Israel', group: 'catalog' },
];

/** Mirrors backend AIR_HUBS in route_planner.py */
export const AIR_HUB_PRESETS: LocationPreset[] = [
  { id: 'air-lun', name: 'Kenneth Kaunda International Airport', lat: -15.33, lng: 28.452, country: 'Zambia', group: 'catalog' },
  { id: 'air-jnb', name: 'OR Tambo International Airport', lat: -26.133, lng: 28.242, country: 'South Africa', group: 'catalog' },
  { id: 'air-dar', name: 'Julius Nyerere International Airport', lat: -6.878, lng: 39.202, country: 'Tanzania', group: 'catalog' },
  { id: 'air-acc', name: 'Kotoka International Airport', lat: 5.605, lng: -0.167, country: 'Ghana', group: 'catalog' },
  { id: 'air-nbo', name: 'Jomo Kenyatta International Airport', lat: -1.319, lng: 36.928, country: 'Kenya', group: 'catalog' },
  { id: 'air-cai', name: 'Cairo International Airport', lat: 30.122, lng: 31.406, country: 'Egypt', group: 'catalog' },
  { id: 'air-hrg', name: 'Hurghada International Airport', lat: 27.178, lng: 33.799, country: 'Egypt', group: 'catalog' },
  { id: 'air-dxb', name: 'Dubai International Airport', lat: 25.253, lng: 55.365, country: 'United Arab Emirates', group: 'catalog' },
  { id: 'air-bru', name: 'Brussels Airport', lat: 50.901, lng: 4.484, country: 'Belgium', group: 'catalog' },
  { id: 'air-ams', name: 'Amsterdam Schiphol Airport', lat: 52.31, lng: 4.768, country: 'Netherlands', group: 'catalog' },
  { id: 'air-fra', name: 'Frankfurt Airport', lat: 50.037, lng: 8.562, country: 'Germany', group: 'catalog' },
  { id: 'air-lhr', name: 'London Heathrow Airport', lat: 51.47, lng: -0.454, country: 'United Kingdom', group: 'catalog' },
  { id: 'air-sin', name: 'Singapore Changi Airport', lat: 1.364, lng: 103.991, country: 'Singapore', group: 'catalog' },
  { id: 'air-pvg', name: 'Shanghai Pudong Airport', lat: 31.144, lng: 121.808, country: 'China', group: 'catalog' },
  { id: 'air-tlv', name: 'Ben Gurion Airport (TLV)', lat: 32.011, lng: 34.87, country: 'Israel', group: 'catalog' },
];

/** Route-map hub caps — profile with React DevTools "Highlight updates" on MapComponent. */
export const MAX_HUB_MARKERS_PER_COUNTRY = 40;
export const MAX_TOTAL_HUB_MARKERS = 120;
/** Hard cap while route planner panel is open (ports + airports combined budget). */
export const MAX_ROUTE_MODE_TOTAL_HUB_MARKERS = 40;
/** Cap dropdown options per group to keep preset builds responsive. */
export const MAX_DROPDOWN_PRESETS_PER_GROUP = 40;
/** Searchable location picker — never render more than this many rows. */
export const MAX_PRESET_SEARCH_RESULTS = 20;
/** Route planner dropdown — catalog + API ports only (no license scan). */
export const MAX_ROUTE_PRESET_ITEMS = 30;

const ISO2_ROUTE_COUNTRY_OVERRIDES: Record<string, string> = {
  CD: 'Democratic Republic of the Congo',
  CG: 'Congo (Congo-Brazzaville)',
  CI: "Cote d'Ivoire",
  GB: 'United Kingdom',
  IL: 'Israel',
  IS: 'Iceland',
  TZ: 'Tanzania',
  US: 'United States of America',
};

function countryFromIso2(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const override = ISO2_ROUTE_COUNTRY_OVERRIDES[code];
  if (override) return override;
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    return display?.trim() || null;
  } catch {
    return null;
  }
}

export function canonicalRouteHubCountry(country: string | undefined): string | null {
  const raw = country?.trim();
  if (!raw) return null;
  const isoCountry = countryFromIso2(raw);
  if (isoCountry) return resolveCountryFocusToken(isoCountry, countriesList) ?? isoCountry;
  return resolveCountryFocusToken(raw, countriesList) ?? raw;
}

/** Slice the license pool to route-corridor countries before preset/marker builds (avoids 15k scans). */
export function filterLicensesForRouteHubs(
  licenses: readonly MiningLicense[],
  countries: readonly string[],
): MiningLicense[] {
  if (!countries.length) return [];
  return licenses.filter((item) => licenseMatchesRouteHubFilter(item, countries));
}

export function countriesMatchRouteHubFilter(
  markerCountry: string | undefined,
  filterCountries: readonly string[],
): boolean {
  if (!filterCountries.length || !markerCountry?.trim()) return false;
  const markerCanon = canonicalRouteHubCountry(markerCountry);
  if (!markerCanon) return false;
  const markerKey = normalizeCountryFocusQuery(markerCanon);
  return filterCountries.some((c) => {
    const canon = canonicalRouteHubCountry(c);
    return canon != null && normalizeCountryFocusQuery(canon) === markerKey;
  });
}

/** Origin + destination countries for hub markers and dropdowns. Requires destination (buyer) country. */
export function resolveRouteHubCountries(
  supplierCountry?: string,
  buyerCountry?: string,
): string[] {
  const buyerCanon = canonicalRouteHubCountry(buyerCountry);
  if (!buyerCanon) return [];
  const out = new Set<string>([buyerCanon]);
  const supplierCanon = canonicalRouteHubCountry(supplierCountry);
  if (supplierCanon) out.add(supplierCanon);
  return Array.from(out);
}

export function buyerCountryRequiredForHubs(buyerCountry?: string): boolean {
  return !canonicalRouteHubCountry(buyerCountry);
}

function hubDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

/** Nearest catalog port or airport in the given country (for buyer country sync). */
export function findNearestHubInCountry(
  lat: number,
  lng: number,
  country: string,
): LocationPreset | null {
  const canon = canonicalRouteHubCountry(country);
  if (!canon) return null;
  const hubs = [...MARITIME_HUB_PRESETS, ...AIR_HUB_PRESETS].filter((hub) =>
    countriesMatchRouteHubFilter(hub.country, [canon]),
  );
  if (!hubs.length) return null;
  let best = hubs[0];
  let bestKm = Infinity;
  for (const hub of hubs) {
    const km = hubDistanceKm({ lat, lng }, hub);
    if (km < bestKm) {
      bestKm = km;
      best = hub;
    }
  }
  return best;
}

export const WORLD_TRADE_PRESETS: LocationPreset[] = [
  { id: 'p-rotterdam', name: 'Rotterdam, Netherlands', lat: 51.924, lng: 4.477, country: 'Netherlands', group: 'ports' },
  { id: 'p-antwerp', name: 'Antwerp, Belgium', lat: 51.219, lng: 4.402, country: 'Belgium', group: 'ports' },
  { id: 'p-hamburg', name: 'Hamburg, Germany', lat: 53.545, lng: 9.97, country: 'Germany', group: 'ports' },
  { id: 'p-shanghai', name: 'Shanghai, China', lat: 31.23, lng: 121.473, country: 'China', group: 'ports' },
  { id: 'p-singapore', name: 'Singapore', lat: 1.352, lng: 103.819, country: 'Singapore', group: 'ports' },
  { id: 'p-houston', name: 'Houston, USA', lat: 29.735, lng: -95.275, country: 'United States', group: 'ports' },
  { id: 'p-dubai', name: 'Jebel Ali, UAE', lat: 24.996, lng: 55.06, country: 'United Arab Emirates', group: 'ports' },
  { id: 'p-mumbai', name: 'Mumbai (JNPT), India', lat: 18.944, lng: 72.954, country: 'India', group: 'ports' },
  { id: 'p-busan', name: 'Busan, South Korea', lat: 35.115, lng: 129.071, country: 'South Korea', group: 'ports' },
  { id: 'p-losangeles', name: 'Los Angeles, USA', lat: 33.729, lng: -118.269, country: 'United States', group: 'ports' },
  { id: 'p-valcambi', name: 'Valcambi Refinery, Switzerland', lat: 46.024, lng: 8.951, country: 'Switzerland', group: 'buyers' },
  { id: 'p-rand', name: 'Rand Refinery, South Africa', lat: -26.248, lng: 28.163, country: 'South Africa', group: 'buyers' },
  { id: 'p-tesla', name: 'Tesla Gigafactory Nevada, USA', lat: 39.539, lng: -119.231, country: 'United States', group: 'buyers' },
  { id: 'p-bp', name: 'BP Trading Hub, London', lat: 51.507, lng: -0.127, country: 'United Kingdom', group: 'buyers' },
];

const ROUTE_PORT_SUBTYPES = new Set([
  'port',
  'port_adm',
  'terminal',
]);

const ROUTE_NON_PORT_SUBTYPES = new Set([
  'logistics_hub',
  'rail_terminal',
  'depot',
]);

function routeHubCountryForLicense(item: MiningLicense): string | undefined {
  const rawCountry = item.country?.trim();
  if (rawCountry && normalizeCountryFocusQuery(rawCountry) !== 'global') {
    const canon = canonicalRouteHubCountry(rawCountry);
    if (canon) return canon;
  }
  const isoCountry = canonicalRouteHubCountry(item.countryIso2);
  return isoCountry ?? rawCountry ?? item.countryIso2 ?? undefined;
}

function licenseMatchesRouteHubFilter(item: MiningLicense, countries: readonly string[]): boolean {
  if (!countries.length || isGlobalFallbackLicense(item)) return false;
  const candidates = [item.countryIso2, item.country].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  return candidates.some((country) => countriesMatchRouteHubFilter(country, countries));
}

export function isRouteSelectablePortLicense(item: MiningLicense): boolean {
  if (isGlobalFallbackLicense(item)) return false;
  const kind = (item.entityKind || '').toLowerCase();
  const sub = (item.entitySubtype || '').toLowerCase();
  if (kind === 'logistics_node' || ROUTE_NON_PORT_SUBTYPES.has(sub)) return false;
  if (kind === 'port' || ROUTE_PORT_SUBTYPES.has(sub)) return true;

  const sector = (item.sector || '').toLowerCase();
  if (!sector.includes('port')) return false;
  const label = `${item.company || ''} ${item.region || ''} ${item.licenseType || ''} ${item.commodity || ''}`.toLowerCase();
  return /\b(port|harbou?r|seaport|maritime|marine|quay|wharf|berth|dock)\b/.test(label);
}

export function isPortLikeLicense(item: MiningLicense): boolean {
  return isRouteSelectablePortLicense(item);
}

export function licenseToPreset(item: MiningLicense): LocationPreset | null {
  if (item.lat == null || item.lng == null || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) {
    return null;
  }
  const country = routeHubCountryForLicense(item);
  const region = item.region || country || '';
  return {
    id: `lic-${item.id}`,
    name: `${item.company || 'Unknown'} — ${region}`,
    lat: item.lat,
    lng: item.lng,
    country,
    licenseId: item.id,
    commodity: item.commodity,
    sector: item.sector,
    group: isPortLikeLicense(item) ? 'ports' : 'licenses',
  };
}

function isGlobalFallbackLicense(item: MiningLicense): boolean {
  const country = normalizeCountryFocusQuery(item.country || '');
  const recordOrigin = String(item.recordOrigin || '').toLowerCase();
  const sourceKind = String(item.sourceKind || '').toLowerCase();
  return country === 'global' || recordOrigin.includes('global') || sourceKind.includes('global');
}

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

export function dedupePresets(presets: LocationPreset[]): LocationPreset[] {
  const seen = new Set<string>();
  const out: LocationPreset[] = [];
  for (const p of presets) {
    const key = `${p.id}:${coordKey(p.lat, p.lng)}`;
    const geo = coordKey(p.lat, p.lng);
    if (seen.has(geo)) continue;
    seen.add(geo);
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function buildLicensePresets(allLicenses: MiningLicense[], limit = 200): LocationPreset[] {
  const portLike: LocationPreset[] = [];
  const other: LocationPreset[] = [];
  for (const item of allLicenses) {
    const preset = licenseToPreset(item);
    if (!preset) continue;
    if (preset.group === 'ports') {
      if (portLike.length < limit) portLike.push(preset);
    } else if (other.length < limit) {
      other.push(preset);
    }
    if (portLike.length >= limit && other.length >= limit) break;
  }
  return dedupePresets([...portLike, ...other]);
}

export function buildPortPresetsFromEntities(
  entities: MiningLicense[],
  limit = MAX_DROPDOWN_PRESETS_PER_GROUP,
): LocationPreset[] {
  const presets: LocationPreset[] = [];
  for (const item of entities) {
    if (presets.length >= limit) break;
    if (!isRouteSelectablePortLicense(item)) continue;
    const preset = licenseToPreset(item);
    if (!preset) continue;
    presets.push({ ...preset, id: `db-port-${item.id}`, group: 'ports' as const });
  }
  return dedupePresets(presets);
}

function presetMatchesCountries(p: LocationPreset, countries: readonly string[]): boolean {
  return p.country != null && countriesMatchRouteHubFilter(p.country, countries);
}

export function filterLocationPresetsByCountries(
  presets: LocationPreset[],
  countries: readonly string[],
): LocationPreset[] {
  if (!countries.length) {
    return presets.filter((p) => p.group === 'licenses' || p.group === 'buyers');
  }
  return presets.filter((p) => presetMatchesCountries(p, countries));
}

/** Countries used to filter each location block's dropdown. */
export function resolveRolePresetCountries(
  role: 'supplier' | 'buyer',
  supplierCountry?: string,
  buyerCountry?: string,
): string[] {
  if (role === 'supplier') {
    const supplierCanon = canonicalRouteHubCountry(supplierCountry);
    return supplierCanon ? [supplierCanon] : [];
  }
  const buyerCanon = canonicalRouteHubCountry(buyerCountry);
  return buyerCanon ? [buyerCanon] : [];
}

function capPresetsByGroup(presets: LocationPreset[], maxPerGroup: number): LocationPreset[] {
  const counts = new Map<LocationPreset['group'], number>();
  const out: LocationPreset[] = [];
  for (const p of presets) {
    const n = counts.get(p.group) ?? 0;
    if (n >= maxPerGroup) continue;
    counts.set(p.group, n + 1);
    out.push(p);
  }
  return out;
}

/**
 * Fast hub list for Route Intelligence dropdowns — static catalog + DB ports only.
 * Never scans the global license pool (avoids 15k+ main-thread filters).
 */
export function buildRouteHubPresets(
  portEntities: MiningLicense[] = [],
  options?: { countries?: readonly string[] },
): LocationPreset[] {
  const countryList = options?.countries ?? [];
  if (!countryList.length) return [];

  const catalogMaritime = MARITIME_HUB_PRESETS.filter((p) => presetMatchesCountries(p, countryList));
  const catalogAir = AIR_HUB_PRESETS.filter((p) => presetMatchesCountries(p, countryList));
  const portsFromDb = buildPortPresetsFromEntities(
    portEntities.filter((item) => licenseMatchesRouteHubFilter(item, countryList)),
    Math.min(15, MAX_ROUTE_PRESET_ITEMS),
  );

  return dedupePresets([...catalogMaritime, ...catalogAir, ...portsFromDb]).slice(0, MAX_ROUTE_PRESET_ITEMS);
}

export function buildAllLocationPresets(
  allLicenses: MiningLicense[],
  portEntities: MiningLicense[] = [],
  options?: { countries?: readonly string[] },
): LocationPreset[] {
  const countries = options?.countries;
  const hasCountryFilter = countries !== undefined;
  const countryList = countries ?? [];

  if (hasCountryFilter && !countryList.length) {
    // Skip scanning the full global license pool until a country is chosen.
    return [];
  }

  const licensesForBuild =
    hasCountryFilter && countryList.length
      ? allLicenses.filter(
          (item) =>
            licenseMatchesRouteHubFilter(item, countryList),
        )
      : allLicenses;

  const portsForBuild =
    hasCountryFilter && countryList.length
      ? portEntities.filter((item) => licenseMatchesRouteHubFilter(item, countryList))
      : hasCountryFilter
        ? []
        : portEntities;

  const catalogMaritime =
    !hasCountryFilter || !countryList.length
      ? MARITIME_HUB_PRESETS
      : MARITIME_HUB_PRESETS.filter((p) => presetMatchesCountries(p, countryList));

  const catalogAir =
    !hasCountryFilter || !countryList.length
      ? AIR_HUB_PRESETS
      : AIR_HUB_PRESETS.filter((p) => presetMatchesCountries(p, countryList));

  const worldTrade =
    !hasCountryFilter || !countryList.length
      ? WORLD_TRADE_PRESETS
      : WORLD_TRADE_PRESETS.filter((p) => presetMatchesCountries(p, countryList));

  const merged = dedupePresets([
    ...buildLicensePresets(licensesForBuild),
    ...buildPortPresetsFromEntities(portsForBuild),
    ...catalogMaritime,
    ...catalogAir,
    ...worldTrade,
  ]);

  const filtered = hasCountryFilter
    ? filterLocationPresetsByCountries(merged, countryList)
    : merged;

  return capPresetsByGroup(filtered, MAX_DROPDOWN_PRESETS_PER_GROUP);
}

export function matchPresetId(
  presets: LocationPreset[],
  lat: number,
  lng: number,
): string {
  const m = presets.find((p) => Math.abs(p.lat - lat) < 1e-4 && Math.abs(p.lng - lng) < 1e-4);
  return m ? m.id : 'custom';
}

/** Fast typeahead for RoutePresetPicker — avoids mounting hundreds of DOM nodes. */
export function searchLocationPresets(
  presets: LocationPreset[],
  query: string,
  limit = MAX_PRESET_SEARCH_RESULTS,
): LocationPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: LocationPreset[] = [];
  for (const p of presets) {
    if (out.length >= limit) break;
    const hay = `${p.name} ${p.country ?? ''} ${p.commodity ?? ''}`.toLowerCase();
    if (hay.includes(q)) out.push(p);
  }
  return out;
}

export function groupPresetsByKind(
  presets: LocationPreset[],
  showBuyerGroups: boolean,
): { key: LocationPreset['group']; labelHe: string; labelEn: string; items: LocationPreset[] }[] {
  const licenses = presets.filter((p) => p.group === 'licenses');
  const ports = presets.filter(
    (p) => p.group === 'ports' || (p.group === 'catalog' && !p.id.startsWith('air-')),
  );
  const airports = presets.filter((p) => p.group === 'catalog' && p.id.startsWith('air-'));
  const buyers = showBuyerGroups ? presets.filter((p) => p.group === 'buyers') : [];
  const groups: { key: LocationPreset['group']; labelHe: string; labelEn: string; items: LocationPreset[] }[] = [];
  if (licenses.length) {
    groups.push({
      key: 'licenses',
      labelHe: 'הנכסים והזיכיונות שלך',
      labelEn: 'Your Concessions & Assets',
      items: licenses,
    });
  }
  if (ports.length) {
    groups.push({
      key: 'ports',
      labelHe: 'נמלים ומרכזי סחר',
      labelEn: 'Ports & trade hubs',
      items: ports,
    });
  }
  if (airports.length) {
    groups.push({
      key: 'catalog',
      labelHe: 'שדות תעופה',
      labelEn: 'Airports',
      items: airports,
    });
  }
  if (buyers.length) {
    groups.push({
      key: 'buyers',
      labelHe: 'קונים ומזקקות',
      labelEn: 'Refineries & Buyers',
      items: buyers,
    });
  }
  return groups;
}

export interface RoutePlannerHubMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country?: string;
  hubType: 'port' | 'airport';
  source: 'catalog' | 'database' | 'license';
}

/** @deprecated Use RoutePlannerHubMarker */
export type RoutePlannerPortMarker = RoutePlannerHubMarker;

function capMarkersByCountry<T extends { country?: string }>(
  markers: T[],
  maxPerCountry: number,
  maxTotal: number,
): T[] {
  const perCountry = new Map<string, number>();
  const out: T[] = [];
  for (const m of markers) {
    if (out.length >= maxTotal) break;
    const key = canonicalRouteHubCountry(m.country) ?? '_unknown';
    const n = perCountry.get(key) ?? 0;
    if (n >= maxPerCountry) continue;
    perCountry.set(key, n + 1);
    out.push(m);
  }
  return out;
}

export function buildRoutePlannerPortMarkers(
  allLicenses: MiningLicense[],
  portEntities: MiningLicense[] = [],
  options?: { countries?: readonly string[]; maxTotal?: number },
): RoutePlannerHubMarker[] {
  const countries = options?.countries;
  const hasCountryFilter = countries !== undefined;
  const markers: RoutePlannerHubMarker[] = [];
  const seen = new Set<string>();

  const add = (
    id: string,
    name: string,
    lat: number,
    lng: number,
    country: string | undefined,
    source: RoutePlannerHubMarker['source'],
  ) => {
    if (hasCountryFilter && (!countries!.length || !countriesMatchRouteHubFilter(country, countries!))) {
      return;
    }
    const key = coordKey(lat, lng);
    if (seen.has(key)) return;
    seen.add(key);
    markers.push({ id, name, lat, lng, country, hubType: 'port', source });
  };

  for (const hub of MARITIME_HUB_PRESETS) {
    add(hub.id, hub.name, hub.lat, hub.lng, hub.country, 'catalog');
  }
  for (const p of WORLD_TRADE_PRESETS.filter((x) => x.group === 'ports')) {
    add(p.id, p.name, p.lat, p.lng, p.country, 'catalog');
  }
  if (hasCountryFilter && countries!.length) {
    for (const item of portEntities) {
      if (item.lat == null || item.lng == null) continue;
      if (!isRouteSelectablePortLicense(item) || !licenseMatchesRouteHubFilter(item, countries!)) continue;
      add(`db-${item.id}`, item.company || item.region || 'Port', item.lat, item.lng, routeHubCountryForLicense(item), 'database');
    }
    for (const item of allLicenses) {
      if (!isPortLikeLicense(item) || item.lat == null || item.lng == null) continue;
      if (!licenseMatchesRouteHubFilter(item, countries!)) continue;
      add(`lic-${item.id}`, item.company || 'Port', item.lat, item.lng, routeHubCountryForLicense(item), 'license');
    }
  }

  const maxTotal = options?.maxTotal ?? MAX_TOTAL_HUB_MARKERS;
  return capMarkersByCountry(markers, MAX_HUB_MARKERS_PER_COUNTRY, maxTotal);
}

export function buildRoutePlannerAirportMarkers(options?: {
  countries?: readonly string[];
  maxTotal?: number;
}): RoutePlannerHubMarker[] {
  const countries = options?.countries;
  const hasCountryFilter = countries !== undefined;
  const markers: RoutePlannerHubMarker[] = AIR_HUB_PRESETS.filter((hub) => {
    if (!hasCountryFilter) return true;
    if (!countries!.length) return false;
    return countriesMatchRouteHubFilter(hub.country, countries!);
  }).map((hub) => ({
    id: hub.id,
    name: hub.name,
    lat: hub.lat,
    lng: hub.lng,
    country: hub.country,
    hubType: 'airport' as const,
    source: 'catalog' as const,
  }));
  const maxTotal = options?.maxTotal ?? MAX_TOTAL_HUB_MARKERS;
  return capMarkersByCountry(markers, MAX_HUB_MARKERS_PER_COUNTRY, maxTotal);
}
