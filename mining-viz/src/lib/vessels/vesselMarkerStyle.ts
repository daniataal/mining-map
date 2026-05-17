import type { MaritimeVessel } from './types';

/** AIS ship/cargo type buckets (ITU-R M.1371-style 0–99); label fallback refines API-specific codes. */
export type VesselCategoryKey =
  | 'tanker'
  | 'cargo'
  | 'passenger'
  | 'fishing'
  | 'tug'
  | 'service'
  | 'pleasure'
  | 'fast'
  | 'other';

export const VESSEL_CATEGORY_COLORS: Record<VesselCategoryKey, string> = {
  tanker: '#fbbf24',
  cargo: '#38bdf8',
  passenger: '#34d399',
  fishing: '#2dd4bf',
  tug: '#a78bfa',
  service: '#94a3b8',
  pleasure: '#f472b6',
  fast: '#fb923c',
  other: '#64748b',
};

export const MARITIME_LEGEND_KEYS: VesselCategoryKey[] = [
  'tanker',
  'cargo',
  'passenger',
  'fishing',
  'tug',
  'service',
  'pleasure',
  'fast',
  'other',
];

export const VESSEL_LEGEND_T: Record<VesselCategoryKey, [string, string]> = {
  tanker: ['מכלית', 'Tanker'],
  cargo: ['מטען', 'Cargo'],
  passenger: ['נוסעים', 'Passenger'],
  fishing: ['דיג', 'Fishing'],
  tug: ['גוררת', 'Tug'],
  service: ['שירות', 'Service'],
  pleasure: ['שייט', 'Pleasure'],
  fast: ['מהיר', 'Fast'],
  other: ['אחר/לא ידוע', 'Other'],
};

function vesselCategoryFromTypeCode(code: number | null | undefined): VesselCategoryKey | null {
  if (code == null || !Number.isFinite(code)) return null;
  const c = Math.floor(code);
  if (c === 0) return 'other';
  if (c >= 80 && c <= 89) return 'tanker';
  if (c >= 70 && c <= 79) return 'cargo';
  if (c >= 60 && c <= 69) return 'passenger';
  if (c === 30) return 'fishing';
  if (c === 31 || c === 32 || c === 52) return 'tug';
  if ([33, 34, 35, 50, 51, 53, 54, 55, 58, 59].includes(c)) return 'service';
  if (c === 36 || c === 37) return 'pleasure';
  if ((c >= 40 && c <= 49) || (c >= 20 && c <= 29)) return 'fast';
  if (c >= 90 && c <= 99) return 'other';
  return null;
}

function vesselCategoryFromLabel(label: string | null | undefined): VesselCategoryKey | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (s.includes('tank')) return 'tanker';
  if (s.includes('cargo') || s.includes('container') || s.includes('bulk') || s.includes('carrier')) return 'cargo';
  if (s.includes('passenger') || s.includes('cruise')) return 'passenger';
  if (s.includes('fish')) return 'fishing';
  if (s.includes('tug') || s.includes('tow')) return 'tug';
  if (
    s.includes('pilot') ||
    s.includes('search') ||
    s.includes('sar') ||
    s.includes('rescue') ||
    s.includes('military') ||
    s.includes('law') ||
    s.includes('dredg') ||
    s.includes('port tender') ||
    s.includes('anti-pollution')
  ) {
    return 'service';
  }
  if (s.includes('pleasure') || s.includes('sailing') || s.includes('yacht')) return 'pleasure';
  if (s.includes('high speed') || s.includes('hsc') || s.includes('wig')) return 'fast';
  return null;
}

export function getVesselMarkerColor(vessel: MaritimeVessel): string {
  const fromCode = vesselCategoryFromTypeCode(vessel.ship_type_code ?? null);
  if (fromCode) return VESSEL_CATEGORY_COLORS[fromCode];
  const fromLabel = vesselCategoryFromLabel(vessel.ship_type_label);
  if (fromLabel) return VESSEL_CATEGORY_COLORS[fromLabel];
  return VESSEL_CATEGORY_COLORS.other;
}

/** Prefer true heading; else course over ground; invalid AIS (511) ignored. */
export function getVesselHeadingDegrees(vessel: MaritimeVessel): number {
  const th = vessel.true_heading;
  if (th != null && Number.isFinite(th) && th !== 511 && th >= 0 && th < 360) return th;
  const cog = vessel.course_over_ground;
  if (cog != null && Number.isFinite(cog)) {
    let c = cog % 360;
    if (c < 0) c += 360;
    if (Math.abs(c - 360) < 1e-6 || c === 360) return 0;
    return c;
  }
  return 0;
}

export function getVesselChevronDim(mapZoom: number, isSelected = false): number {
  const baseDim = mapZoom <= 4 ? 20 : mapZoom <= 6 ? 17 : 14;
  return isSelected ? baseDim + 6 : baseDim;
}

export interface VesselDrawRecord {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  color: string;
  isSelected: boolean;
}

export function toVesselDrawRecords(
  vessels: MaritimeVessel[],
  mapZoom: number,
  selectedId: string | null,
): VesselDrawRecord[] {
  return vessels.map((vessel) => ({
    id: vessel.id,
    lat: vessel.lat,
    lng: vessel.lng,
    heading: getVesselHeadingDegrees(vessel),
    color: getVesselMarkerColor(vessel),
    isSelected: vessel.id === selectedId,
  }));
}
