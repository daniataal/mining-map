import type { MaritimeVessel, VesselFilters } from './types';

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
      const label = vessel.ship_type_label || 'Unknown';
      if (!filters.shipTypes.includes(label)) return false;
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
