export type MapViewModeKey =
  | 'global'
  | 'mining'
  | 'oil_and_gas'
  | 'suppliers'
  | 'ports'
  | 'route_planner'
  | string;

export function mapViewHelpTitle(viewMode: MapViewModeKey): string {
  switch (viewMode) {
    case 'global':
      return 'World Map';
    case 'mining':
      return 'Mining view';
    case 'oil_and_gas':
      return 'Oil & Gas view';
    case 'supply_chain':
    case 'workspace':
      return 'Supply Chain';
    default:
      return 'Map view';
  }
}

export function mapViewHelpBody(viewMode: MapViewModeKey): string {
  switch (viewMode) {
    case 'global':
      return 'Country hubs, asset inventory, trade corridors, and risk coverage. Counts label whether they are map-visible or stored totals.';
    case 'mining':
      return 'Mining-sector licenses and tenements only. Oil & gas-only rows are hidden.';
    case 'oil_and_gas':
      return 'Petroleum map layers: upstream licenses, known fields, refineries, storage, pipelines, LNG, ports, and AIS when enabled from the asset cockpit. AIS coverage is provider-limited in some regions, especially Gulf/Hormuz/Red Sea views.';
    case 'supply_chain':
    case 'workspace':
      return 'Supply chain canvas: suppliers, buyers, and deal packs on the map. Import from search, pack deals into a single pin, and track journal, transport, profit, and follow-ups.';
    default:
      return '';
  }
}

/** Clarifies world-coverage banner — countries/sources, not vessels. */
export const WORLD_COVERAGE_BANNER_NOTE =
  'Counts license countries and registry sources — not maritime vessels.';
