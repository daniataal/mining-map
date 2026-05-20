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
      return 'Global view';
    case 'mining':
      return 'Mining view';
    case 'oil_and_gas':
      return 'Oil & Gas view';
    case 'suppliers':
      return 'Suppliers view';
    default:
      return 'Map view';
  }
}

export function mapViewHelpBody(viewMode: MapViewModeKey): string {
  switch (viewMode) {
    case 'global':
      return 'All license sectors (mining + oil & gas). Counts are higher than Mining because petroleum licenses are included. Maritime AIS is a separate layer when enabled.';
    case 'mining':
      return 'Mining-sector licenses and tenements only. Oil & gas-only rows are hidden.';
    case 'oil_and_gas':
      return 'Petroleum licenses on the map — upstream blocks, refineries, and Fuel / Products marketers (downstream marketing & wholesale). Plus a dedicated Storage / tank farms layer (open OSM, worldwide count in the banner). Toggle tank farms in the map control (bottom-right); «in view» follows your map bounds. Enable Vessels (AIS) separately for live ship positions.';
    case 'suppliers':
      return 'Your active deal pipeline on the map: green Deal signal on a dossier (any stage except Rejected). Mark Deal signal on dossier Overview to add a supplier here. Toggle “Show all licenses” for discovery.';
    default:
      return '';
  }
}

/** Clarifies world-coverage banner — countries/sources, not vessels. */
export const WORLD_COVERAGE_BANNER_NOTE =
  'Counts license countries and registry sources — not maritime vessels.';
