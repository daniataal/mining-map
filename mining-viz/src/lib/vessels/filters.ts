import type { MaritimeVessel, VesselFilters } from './types';
import { VESSEL_SHIP_TYPE_OPTIONS } from './types';

export type VesselShipTypeChip = (typeof VESSEL_SHIP_TYPE_OPTIONS)[number];

/**
 * Maps a vessel to the same coarse AIS buckets as the filter chips (Tanker / Cargo / …).
 * Uses ship_type_code first (ITU-R M.1371 buckets) so filters work when ship_type_label is null
 * or a non-exact variant (e.g. "Oil Tanker", "LNG Carrier").
 */
export function canonicalShipTypeChipFromVessel(vessel: MaritimeVessel): VesselShipTypeChip {
  const code = vessel.ship_type_code;
  if (code != null && Number.isFinite(code)) {
    const c = Math.floor(Number(code));
    if (c >= 80 && c <= 89) return 'Tanker';
    if (c >= 70 && c <= 79) return 'Cargo';
    if (c >= 60 && c <= 69) return 'Passenger';
    if (c > 0) return 'Other';
  }
  const raw = (vessel.ship_type_label || '').trim();
  const label = raw.toLowerCase();
  if (!label) return 'Unknown';
  if (
    label.includes('tank') ||
    label.includes('lng') ||
    label.includes('lpg') ||
    label.includes('crude') ||
    label.includes('chemical') ||
    label.includes('petroleum') ||
    (label.includes('oil') && label.includes('gas'))
  ) {
    return 'Tanker';
  }
  if (label.includes('cargo') || label.includes('bulk') || label.includes('container') || label.includes('carrier')) {
    return 'Cargo';
  }
  if (label.includes('passenger') || label.includes('cruise')) return 'Passenger';
  if (label === 'unknown') return 'Unknown';
  const exact = VESSEL_SHIP_TYPE_OPTIONS.find((opt) => opt.toLowerCase() === label);
  if (exact) return exact;
  return 'Other';
}

/**
 * Manual regression checklist (ship-type chips + canvas LOD):
 * - Enable Vessels (AIS), zoom to an area with mixed types; pick "Tanker" only — map count and chevrons drop.
 * - Select a vessel with only ship_type_code set (label empty) — "Cargo" chip still filters correctly.
 * - Zoom out past LOD_FULL_DETAIL_ZOOM (7) — filtered subset still redraws (no stale full feed on canvas).
 */

/** Higher = more relevant for oil/gas maritime context (sort only, not exclusion). */
export function petroleumVesselPriority(vessel: MaritimeVessel): number {
  const code = vessel.ship_type_code;
  if (code != null && Number.isFinite(code) && code >= 80 && code <= 89) {
    return 100;
  }
  const label = (vessel.ship_type_label || '').toLowerCase();
  if (
    label.includes('tanker') ||
    label.includes('crude') ||
    label.includes('chemical') ||
    label.includes('lng') ||
    label.includes('lpg') ||
    label.includes('petroleum') ||
    label.includes('oil') ||
    label.includes('gas')
  ) {
    return 80;
  }
  if (label.includes('cargo')) return 20;
  return 0;
}

export function sortVesselsForDisplay(
  vessels: MaritimeVessel[],
  prioritizePetroleum: boolean,
): MaritimeVessel[] {
  if (!prioritizePetroleum || vessels.length < 2) return vessels;
  return [...vessels].sort((a, b) => {
    const priorityDelta = petroleumVesselPriority(b) - petroleumVesselPriority(a);
    if (priorityDelta !== 0) return priorityDelta;
    return String(b.observed_at || '').localeCompare(String(a.observed_at || ''));
  });
}

export function applyVesselFilters(vessels: MaritimeVessel[], filters: VesselFilters): MaritimeVessel[] {
  const search = filters.search.trim().toLowerCase();
  return vessels.filter((vessel) => {
    if (search) {
      const haystack = [
        vessel.vessel_name,
        vessel.mmsi,
        vessel.imo,
        vessel.call_sign,
        vessel.destination,
        vessel.nearest_port?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (filters.shipTypes.length > 0) {
      const chip = canonicalShipTypeChipFromVessel(vessel);
      if (!filters.shipTypes.includes(chip)) return false;
    }

    if (filters.minSpeedKnots != null) {
      const speed = vessel.speed_knots;
      if (speed == null || speed < filters.minSpeedKnots) return false;
    }

    if (filters.maxSpeedKnots != null) {
      const speed = vessel.speed_knots;
      if (speed == null || speed > filters.maxSpeedKnots) return false;
    }

    if (filters.navigationalStatuses.length > 0) {
      const status = vessel.navigational_status;
      if (status == null || !filters.navigationalStatuses.includes(status)) return false;
    }

    return true;
  });
}

export function countActiveVesselFilters(filters: VesselFilters): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.shipTypes.length) count += 1;
  if (filters.minSpeedKnots != null || filters.maxSpeedKnots != null) count += 1;
  if (filters.navigationalStatuses.length) count += 1;
  return count;
}
