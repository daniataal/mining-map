import type { OilLiveLayerVisibility } from '../../components/petroleum/OilLiveMapOverlays';
import type { VesselFilters } from '../../lib/vessels/types';

export type LiveDataLensMode = 'deal' | 'infrastructure' | 'raw' | 'crisis';

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

export const LIVE_DATA_LENS_LAYERS: Record<LiveDataLensMode, OilLiveLayerVisibility> = {
  deal: {
    terminals: true,
    vessels: true,
    corridors: true,
    opportunities: true,
    tradeFlows: true,
    coverage: false,
    stsEvents: false,
  },
  infrastructure: {
    terminals: true,
    vessels: true,
    corridors: false,
    opportunities: true,
    tradeFlows: false,
    coverage: false,
    stsEvents: false,
  },
  raw: {
    terminals: true,
    vessels: true,
    corridors: true,
    opportunities: true,
    tradeFlows: true,
    coverage: true,
    stsEvents: true,
  },
  crisis: {
    terminals: true,
    vessels: true,
    corridors: true,
    opportunities: true,
    tradeFlows: true,
    coverage: true,
    stsEvents: true,
  },
};

/** Deal Lens default: execution leads with only connector terminals/vessels. */
export const LIVE_DATA_DEFAULT_LAYERS: OilLiveLayerVisibility = {
  ...LIVE_DATA_LENS_LAYERS.deal,
};

/** Historical alias used by Oil & Gas Live tab entry. */
export const LIVE_DATA_OIL_GAS_TAB_LAYERS: OilLiveLayerVisibility = {
  ...LIVE_DATA_LENS_LAYERS.deal,
};

export const LIVE_DATA_LENS_COPY: Record<
  LiveDataLensMode,
  { labelEn: string; labelHe: string; hintEn: string; hintHe: string }
> = {
  deal: {
    labelEn: 'Deal Lens',
    labelHe: 'עדשת עסקה',
    hintEn: 'Best leads, corridors, connector vessels, and next actions.',
    hintHe: 'לידים מובילים, מסדרונות, כלי שיט מחברים ופעולה הבאה.',
  },
  infrastructure: {
    labelEn: 'Infrastructure Lens',
    labelHe: 'עדשת תשתית',
    hintEn: 'Tank farms, terminals, ports, pipelines, and nearby execution assets.',
    hintHe: 'חוות מיכלים, מסופים, נמלים, צינורות ונכסי ביצוע סמוכים.',
  },
  raw: {
    labelEn: 'Raw Data Lens',
    labelHe: 'עדשת דאטה גולמי',
    hintEn: 'AIS, MCR, macro corridors, coverage, and diagnostics.',
    hintHe: 'AIS, MCR, מסדרונות מאקרו, כיסוי ודיאגנוסטיקה.',
  },
  crisis: {
    labelEn: 'Crisis desk',
    labelHe: 'שולחן משבר',
    hintEn: 'Hormuz-style scenario digest, coverage honesty, ranked plays.',
    hintHe: 'תרחיש הורמוז, כנות כיסוי AIS, הצעות מדורגות.',
  },
};

export const LIVE_DATA_LENS_ORDER: LiveDataLensMode[] = [
  'deal',
  'crisis',
  'infrastructure',
  'raw',
];

/** Default bbox when Crisis desk lens is selected (Hormuz disruption v1). */
export const CRISIS_HORMUZ_BBOX = {
  west: 48,
  south: 12,
  east: 62,
  north: 31,
} as const;

export function layersForLiveDataLens(mode: LiveDataLensMode): OilLiveLayerVisibility {
  return { ...LIVE_DATA_LENS_LAYERS[mode] };
}

/** @deprecated Use LIVE_DATA_LENS_LAYERS.raw for analyst-heavy mode. */
export const LIVE_DATA_RAW_LAYERS: OilLiveLayerVisibility = {
  terminals: true,
  vessels: true,
  corridors: true,
  opportunities: true,
  tradeFlows: true,
  coverage: true,
  stsEvents: true,
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
