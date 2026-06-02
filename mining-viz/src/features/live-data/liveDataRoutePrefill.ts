import type { LiveDataRoutePrefillPayload, MeridianCargoRecord, OilOpportunity } from '../../api/oilLiveApi';
import {
  MARITIME_HUB_PRESETS,
  WORLD_TRADE_PRESETS,
  canonicalRouteHubCountry,
  type LocationPreset,
} from '../route-planner/locationPresets';
import type { RoutePartyLocation } from '../route-planner/useRoutePlanner';

export type LiveDataRouteHints = {
  load_port_name?: string;
  load_country?: string;
  discharge_port_name?: string;
  discharge_country?: string;
  load_lat?: number;
  load_lng?: number;
  discharge_lat?: number;
  discharge_lng?: number;
  commodity_family?: string;
  opportunity_id?: string;
};

const PORT_PRESETS: LocationPreset[] = [
  ...MARITIME_HUB_PRESETS,
  ...WORLD_TRADE_PRESETS.filter((p) => p.group === 'ports'),
];

function normalizePortLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/^port of\s+/i, '')
    .replace(/\s+port$/i, '')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match MCR / terminal port names to catalog hub coordinates. */
export function matchPortPreset(
  portName: string | undefined,
  country?: string,
): LocationPreset | null {
  const needle = normalizePortLabel(portName ?? '');
  if (!needle) return null;

  const canonCountry = country ? canonicalRouteHubCountry(country) : null;
  let best: { preset: LocationPreset; score: number } | null = null;

  for (const preset of PORT_PRESETS) {
    const hay = normalizePortLabel(preset.name);
    const hayShort = hay.split(',')[0]?.trim() ?? hay;
    let score = 0;

    if (hay === needle || hayShort === needle) score = 100;
    else if (hay.includes(needle) || needle.includes(hayShort)) score = 80;
    else {
      const tokens = needle.split(' ').filter((t) => t.length > 3);
      const hits = tokens.filter((t) => hay.includes(t)).length;
      if (hits > 0) score = 20 + hits * 10;
    }

    if (canonCountry && preset.country) {
      const presetCountry = canonicalRouteHubCountry(preset.country);
      if (presetCountry && presetCountry === canonCountry) score += 15;
    }

    if (score > (best?.score ?? 0)) best = { preset, score };
  }

  return best && best.score >= 25 ? best.preset : null;
}

function presetToParty(preset: LocationPreset, label?: string): RoutePartyLocation {
  return {
    lat: preset.lat,
    lng: preset.lng,
    label: label ?? preset.name,
    country: preset.country,
  };
}

function coordsToParty(
  lat: number | undefined,
  lng: number | undefined,
  label: string,
  country?: string,
): RoutePartyLocation | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label, country };
}

function countryHubFallbackParty(country?: string): RoutePartyLocation | null {
  const canonCountry = country ? canonicalRouteHubCountry(country) : null;
  if (!canonCountry) return null;
  const fallback = PORT_PRESETS.find((preset) => {
    if (!preset.country) return false;
    const presetCountry = canonicalRouteHubCountry(preset.country);
    return presetCountry === canonCountry;
  });
  if (!fallback) return null;
  return {
    lat: fallback.lat,
    lng: fallback.lng,
    label: fallback.name,
    country: fallback.country ?? canonCountry,
  };
}

export function resolveRoutePartyFromPort(
  portName: string | undefined,
  country?: string,
  coords?: { lat?: number; lng?: number },
): RoutePartyLocation | null {
  const preset = matchPortPreset(portName, country);
  if (preset) return presetToParty(preset, portName?.trim() || preset.name);
  const withCoords = coordsToParty(coords?.lat, coords?.lng, portName?.trim() || 'Port', country);
  if (withCoords) return withCoords;
  return countryHubFallbackParty(country);
}

export function buildRoutePlannerHintsFromCargo(record: MeridianCargoRecord): LiveDataRouteHints {
  return {
    load_port_name: record.load_port_name,
    load_country: record.load_country,
    discharge_port_name: record.discharge_hint,
    discharge_country: record.discharge_country,
    load_lat: record.corridor_load_lat,
    load_lng: record.corridor_load_lng,
    discharge_lat: record.corridor_discharge_lat,
    discharge_lng: record.corridor_discharge_lng,
    commodity_family: record.commodity_family,
    opportunity_id: record.opportunity_id,
  };
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function buildRoutePlannerHintsFromOpportunity(opp: OilOpportunity): LiveDataRouteHints {
  const raw: LiveDataRoutePrefillPayload = opp.route_prefill ?? {};
  return {
    load_port_name: str(raw.load_port_name) ?? opp.terminal_name,
    load_country: str(raw.load_country) ?? opp.terminal_country,
    discharge_port_name: str(raw.discharge_port_name),
    discharge_country: str(raw.discharge_country),
    load_lat: num(raw.load_lat),
    load_lng: num(raw.load_lng),
    discharge_lat: num(raw.discharge_lat),
    discharge_lng: num(raw.discharge_lng),
    commodity_family: str(raw.commodity_family),
    opportunity_id: opp.id,
  };
}

export function applyLiveDataRouteHints(
  hints: LiveDataRouteHints,
  prefillSupplier: (lat: number, lng: number, label: string, meta?: Partial<RoutePartyLocation>) => void,
  prefillBuyer: (lat: number, lng: number, label: string, meta?: Partial<RoutePartyLocation>) => void,
): { supplier: boolean; buyer: boolean } {
  const supplierParty = resolveRoutePartyFromPort(
    hints.load_port_name,
    hints.load_country,
    { lat: hints.load_lat, lng: hints.load_lng },
  );
  const buyerParty = resolveRoutePartyFromPort(
    hints.discharge_port_name,
    hints.discharge_country,
    { lat: hints.discharge_lat, lng: hints.discharge_lng },
  );

  if (supplierParty) prefillSupplier(supplierParty.lat, supplierParty.lng, supplierParty.label, supplierParty);
  if (buyerParty) prefillBuyer(buyerParty.lat, buyerParty.lng, buyerParty.label, buyerParty);

  return { supplier: Boolean(supplierParty), buyer: Boolean(buyerParty) };
}

export function routeProductFromCommodityFamily(family: string | undefined): string | undefined {
  if (!family) return undefined;
  const f = family.toLowerCase();
  if (f.includes('crude') || f.includes('refined') || f.includes('gas') || f.includes('lng')) {
    return 'petroleum_products';
  }
  if (f.includes('sulfur')) return 'sulfur';
  return undefined;
}
