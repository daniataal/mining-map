/** Canonical 5-mode intelligence cockpit navigation. */

export type IntelligenceMode =
  | 'global_view'
  | 'assets'
  | 'supply_chain'
  | 'routes'
  | 'investigations';

export type GlobalSublayer = 'countries' | 'licenses' | 'trade_flows' | 'risk';
export type AssetsSublayer = 'mines' | 'oil_fields' | 'refineries' | 'tank_farms' | 'ports';
export type SupplyChainSublayer = 'suppliers' | 'buyers' | 'deal_packs';
export type RoutesSublayer = 'vessels' | 'pipelines' | 'hubs';

export type IntelligenceSublayer =
  | GlobalSublayer
  | AssetsSublayer
  | SupplyChainSublayer
  | RoutesSublayer;

/** Legacy viewMode keys still used by MapComponent and data hooks. */
export type LegacyViewMode =
  | 'global'
  | 'mining'
  | 'oil_and_gas'
  | 'ports'
  | 'investigations'
  | 'route_planner'
  | 'admin'
  | 'supply_chain'
  | 'workspace';

export const INTELLIGENCE_MODES: readonly IntelligenceMode[] = [
  'global_view',
  'assets',
  'supply_chain',
  'routes',
  'investigations',
] as const;

export const DEFAULT_SUBLAYER: Record<IntelligenceMode, IntelligenceSublayer> = {
  global_view: 'countries',
  assets: 'mines',
  supply_chain: 'suppliers',
  routes: 'vessels',
  investigations: 'countries',
};

export const SUBLAYERS_FOR_MODE: Record<IntelligenceMode, readonly IntelligenceSublayer[]> = {
  global_view: ['countries', 'licenses', 'trade_flows', 'risk'],
  assets: ['mines', 'oil_fields', 'refineries', 'tank_farms', 'ports'],
  supply_chain: ['suppliers', 'buyers', 'deal_packs'],
  routes: ['vessels', 'pipelines', 'hubs'],
  investigations: ['countries'],
};

export function intelligenceModeLabel(mode: IntelligenceMode): string {
  switch (mode) {
    case 'global_view':
      return 'Global';
    case 'assets':
      return 'Assets';
    case 'supply_chain':
      return 'Supply Chain';
    case 'routes':
      return 'Routes';
    case 'investigations':
      return 'Investigations';
  }
}

export function sublayerLabel(sublayer: IntelligenceSublayer): string {
  const labels: Record<string, string> = {
    countries: 'Countries',
    licenses: 'Licenses',
    trade_flows: 'Trade flows',
    risk: 'Risk (beta)',
    mines: 'Mines',
    oil_fields: 'Oil fields',
    refineries: 'Refineries',
    tank_farms: 'Tank farms',
    ports: 'Ports',
    suppliers: 'Suppliers',
    buyers: 'Buyers',
    deal_packs: 'Deal packs',
    vessels: 'Vessels',
    pipelines: 'Pipelines',
    hubs: 'Hubs',
  };
  return labels[sublayer] ?? sublayer;
}

/** Map cockpit mode + sublayer → MapComponent viewModeKey + license sector. */
export function resolveMapViewKey(
  mode: IntelligenceMode,
  sublayer: IntelligenceSublayer,
): LegacyViewMode {
  if (mode === 'global_view') return 'global';
  if (mode === 'supply_chain') return 'supply_chain';
  if (mode === 'routes') return 'route_planner';
  if (mode === 'investigations') return 'investigations';
  if (mode === 'assets') {
    if (sublayer === 'ports') return 'ports';
    if (sublayer === 'oil_fields' || sublayer === 'refineries' || sublayer === 'tank_farms') {
      return 'oil_and_gas';
    }
    return 'mining';
  }
  return 'global';
}

export function resolveLicenseSector(
  mode: IntelligenceMode,
  sublayer: IntelligenceSublayer,
): 'mining' | 'oil_and_gas' | undefined {
  const key = resolveMapViewKey(mode, sublayer);
  if (key === 'mining') return 'mining';
  if (key === 'oil_and_gas') return 'oil_and_gas';
  return undefined;
}

export function isSupplyChainMode(mode: IntelligenceMode): boolean {
  return mode === 'supply_chain';
}

export function isAssetsMode(mode: IntelligenceMode): boolean {
  return mode === 'assets';
}

export function isMapVisibleMode(mode: IntelligenceMode): boolean {
  return mode !== 'investigations';
}

export function isSidebarVisibleMode(mode: IntelligenceMode, mapSidebarTab: string): boolean {
  if (mode === 'global_view' || mode === 'assets') return true;
  if (mode === 'supply_chain' || mode === 'routes') return false;
  return mapSidebarTab === 'licenses' || mapSidebarTab === 'data_health';
}

export function maritimeActiveForMode(mode: IntelligenceMode, sublayer: IntelligenceSublayer): boolean {
  if (mode === 'routes') return true;
  if (mode === 'global_view' || mode === 'assets') return true;
  return false;
}

/** Migrate legacy viewMode → cockpit state (for rollback compat). */
export function legacyToIntelligence(
  legacy: LegacyViewMode,
): { mode: IntelligenceMode; sublayer: IntelligenceSublayer } {
  switch (legacy) {
    case 'mining':
      return { mode: 'assets', sublayer: 'mines' };
    case 'oil_and_gas':
      return { mode: 'assets', sublayer: 'oil_fields' };
    case 'ports':
      return { mode: 'assets', sublayer: 'ports' };
    case 'workspace':
    case 'supply_chain':
      return { mode: 'supply_chain', sublayer: 'suppliers' };
    case 'route_planner':
      return { mode: 'routes', sublayer: 'vessels' };
    case 'investigations':
      return { mode: 'investigations', sublayer: 'countries' };
    default:
      return { mode: 'global_view', sublayer: 'countries' };
  }
}

export function suppliersPipelineActive(
  mode: IntelligenceMode,
  sublayer: IntelligenceSublayer,
): boolean {
  return mode === 'supply_chain' && sublayer === 'suppliers';
}
