import type { OilLiveLayerVisibility } from '../../components/petroleum/OilLiveMapOverlays';
import type { VesselFilters } from '../../lib/vessels/types';

/** Default Live Data map view — Gulf / Middle East oil hub corridor. */
export const LIVE_DATA_HUB_BBOX = {
  west: 24,
  south: 12,
  east: 55,
  north: 32,
} as const;

export const LIVE_DATA_HUB_CENTER: [number, number] = [
  (LIVE_DATA_HUB_BBOX.south + LIVE_DATA_HUB_BBOX.north) / 2,
  (LIVE_DATA_HUB_BBOX.west + LIVE_DATA_HUB_BBOX.east) / 2,
];

export const LIVE_DATA_HUB_BOUNDS: [[number, number], [number, number]] = [
  [LIVE_DATA_HUB_BBOX.south, LIVE_DATA_HUB_BBOX.west],
  [LIVE_DATA_HUB_BBOX.north, LIVE_DATA_HUB_BBOX.east],
];

/** oil-live-intel GET /map default limit (see handlers.go). */
export const OIL_LIVE_MAP_VESSEL_FETCH_CAP = 500;

/** Government AIS coverage filter — BarentsWatch regional rows (MAD-61). */
export const GOVERNMENT_AIS_COVERAGE_SOURCES = ['barentswatch'] as const;

/** Sample Norway EEZ bbox for BarentsWatch verify (west, south, east, north). */
export const BARENTSWATCH_VERIFY_BBOX = {
  west: 4,
  south: 58,
  east: 31,
  north: 71,
} as const;

/** UX spec MAD-46: terminals/corridors on; vessels opt-in; no global AIS on entry. */
export const LIVE_DATA_DEFAULT_LAYERS: OilLiveLayerVisibility = {
  terminals: true,
  vessels: false,
  corridors: true,
  opportunities: true,
  tradeFlows: false,
  coverage: true,
};

/** MAD-74: Oil & Gas → Live tab — tanker AIS on by default (still capped, not global maritime). */
export const LIVE_DATA_OIL_GAS_TAB_LAYERS: OilLiveLayerVisibility = {
  ...LIVE_DATA_DEFAULT_LAYERS,
  vessels: true,
};

/** MAD-95: EIA historic arcs on Live Data map — off until user toggles Historic group. */
export const LIVE_DATA_EIA_HISTORIC_DEFAULT_YEAR = 2020;

/** When user opts into All maritime AIS on Live Data, favor tankers/cargo. */
export const LIVE_DATA_VESSEL_FILTERS: VesselFilters = {
  search: '',
  shipTypes: ['Tanker', 'Cargo'],
  minSpeedKnots: null,
  maxSpeedKnots: null,
  navigationalStatuses: [],
};

export function viewportOverlapsPersianGulfHub(viewport: {
  south: number;
  west: number;
  north: number;
  east: number;
} | null | undefined): boolean {
  if (!viewport) return true;
  const hub = LIVE_DATA_HUB_BBOX;
  return !(
    viewport.north < hub.south ||
    viewport.south > hub.north ||
    viewport.east < hub.west ||
    viewport.west > hub.east
  );
}
