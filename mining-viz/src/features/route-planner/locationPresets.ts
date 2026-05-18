import type { MiningLicense } from '../../types';

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
];

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

const PORT_LIKE_SUBTYPES = new Set([
  'port',
  'storage_terminal',
  'port_adm',
  'terminal',
  'logistics_hub',
  'rail_terminal',
]);

export function isPortLikeLicense(item: MiningLicense): boolean {
  const kind = (item.entityKind || '').toLowerCase();
  if (kind === 'port' || kind === 'logistics_node') return true;
  const sub = (item.entitySubtype || '').toLowerCase();
  if (PORT_LIKE_SUBTYPES.has(sub)) return true;
  const sector = (item.sector || '').toLowerCase();
  return sector === 'ports' || sector === 'logistics';
}

export function licenseToPreset(item: MiningLicense): LocationPreset | null {
  if (item.lat == null || item.lng == null || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) {
    return null;
  }
  return {
    id: `lic-${item.id}`,
    name: `${item.company || 'Unknown'} — ${item.region || item.country || ''}`,
    lat: item.lat,
    lng: item.lng,
    country: item.country,
    licenseId: item.id,
    commodity: item.commodity,
    sector: item.sector,
    group: isPortLikeLicense(item) ? 'ports' : 'licenses',
  };
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
    if (preset.group === 'ports') portLike.push(preset);
    else other.push(preset);
  }
  return dedupePresets([...portLike, ...other.slice(0, limit)]);
}

export function buildPortPresetsFromEntities(entities: MiningLicense[]): LocationPreset[] {
  return dedupePresets(
    entities
      .map((item) => {
        const preset = licenseToPreset(item);
        if (!preset) return null;
        return { ...preset, id: `db-port-${item.id}`, group: 'ports' as const };
      })
      .filter((p): p is LocationPreset => p != null),
  );
}

export function buildAllLocationPresets(
  allLicenses: MiningLicense[],
  portEntities: MiningLicense[] = [],
): LocationPreset[] {
  return dedupePresets([
    ...buildLicensePresets(allLicenses),
    ...buildPortPresetsFromEntities(portEntities),
    ...MARITIME_HUB_PRESETS,
    ...WORLD_TRADE_PRESETS,
  ]);
}

export function matchPresetId(
  presets: LocationPreset[],
  lat: number,
  lng: number,
): string {
  const m = presets.find((p) => Math.abs(p.lat - lat) < 1e-4 && Math.abs(p.lng - lng) < 1e-4);
  return m ? m.id : 'custom';
}

export interface RoutePlannerPortMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country?: string;
  source: 'catalog' | 'database' | 'license';
}

export function buildRoutePlannerPortMarkers(
  allLicenses: MiningLicense[],
  portEntities: MiningLicense[] = [],
): RoutePlannerPortMarker[] {
  const markers: RoutePlannerPortMarker[] = [];
  const seen = new Set<string>();

  const add = (id: string, name: string, lat: number, lng: number, country: string | undefined, source: RoutePlannerPortMarker['source']) => {
    const key = coordKey(lat, lng);
    if (seen.has(key)) return;
    seen.add(key);
    markers.push({ id, name, lat, lng, country, source });
  };

  for (const hub of MARITIME_HUB_PRESETS) {
    add(hub.id, hub.name, hub.lat, hub.lng, hub.country, 'catalog');
  }
  for (const p of WORLD_TRADE_PRESETS.filter((x) => x.group === 'ports')) {
    add(p.id, p.name, p.lat, p.lng, p.country, 'catalog');
  }
  for (const item of portEntities) {
    if (item.lat == null || item.lng == null) continue;
    add(`db-${item.id}`, item.company || item.region || 'Port', item.lat, item.lng, item.country, 'database');
  }
  for (const item of allLicenses) {
    if (!isPortLikeLicense(item) || item.lat == null || item.lng == null) continue;
    add(`lic-${item.id}`, item.company || 'Port', item.lat, item.lng, item.country, 'license');
  }

  return markers;
}
