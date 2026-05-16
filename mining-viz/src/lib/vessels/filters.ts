import type { MaritimeVessel, VesselFilters } from './types';

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
