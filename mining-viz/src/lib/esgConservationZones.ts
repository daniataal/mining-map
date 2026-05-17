export interface EsgConservationZone {
  name: string;
  center: [number, number];
  radius: number;
  color: string;
  fillColor: string;
  description: string;
  zoneType: string;
  restrictions: string;
  country: string;
  source?: string;
}

export const ESG_CONSERVATION_ZONES: EsgConservationZone[] = [
  {
    name: 'Upper Guinean Rainforest Buffer',
    center: [5.556, -0.196],
    radius: 35000,
    color: '#10b981',
    fillColor: '#059669',
    zoneType: 'Ecological buffer',
    restrictions: 'Strict habitat protection; mining and bulk earthworks prohibited.',
    country: 'Ghana / Côte d\'Ivoire',
    source: 'WDPA reference overlay',
    description:
      'Strict ecological protection zone. Critical wildlife habitat buffer. High water pollution threat index.',
  },
  {
    name: 'Kruger National Park Protected Area',
    center: [-23.988, 31.554],
    radius: 45000,
    color: '#10b981',
    fillColor: '#059669',
    zoneType: 'National park sanctuary',
    restrictions: 'Mining operations strictly prohibited within buffer bounds.',
    country: 'South Africa',
    source: 'SANParks / WDPA',
    description:
      'National park sanctuary reserve. Mining operations strictly prohibited within buffer bounds.',
  },
  {
    name: 'East African Rift Valley Ecological Zone',
    center: [-1.292, 36.821],
    radius: 50000,
    color: '#10b981',
    fillColor: '#059669',
    zoneType: 'Volcanic conservation area',
    restrictions: 'Ground disturbance restricted; protected flora and fauna.',
    country: 'Kenya',
    source: 'National conservation registry',
    description:
      'Volcanic active conservation area. Ground subsidence risk and protected flora/fauna.',
  },
  {
    name: 'Nile Delta Protection Buffer',
    center: [30.044, 31.235],
    radius: 60000,
    color: '#10b981',
    fillColor: '#059669',
    zoneType: 'Agricultural & water protection',
    restrictions: 'Chemical runoff prevention; extractive activity restricted near delta.',
    country: 'Egypt',
    source: 'Environmental protection overlay',
    description:
      'Sensitive delta agricultural zone. Soil salinity warning and chemical runoff prevention area.',
  },
];

export function getEsgZoneIntersection(
  lat?: number | null,
  lng?: number | null
): EsgConservationZone | null {
  if (lat == null || lng == null) return null;
  for (const zone of ESG_CONSERVATION_ZONES) {
    const [zLat, zLng] = zone.center;
    const R = 6371e3;
    const phi1 = (lat * Math.PI) / 180;
    const phi2 = (zLat * Math.PI) / 180;
    const deltaPhi = ((zLat - lat) * Math.PI) / 180;
    const deltaLambda = ((zLng - lng) * Math.PI) / 180;
    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    if (distance <= zone.radius) return zone;
  }
  return null;
}

export function formatBufferRadiusMeters(radius: number): string {
  if (radius >= 1000) {
    const km = radius / 1000;
    return km % 1 === 0 ? `${km} km` : `${km.toFixed(1)} km`;
  }
  return `${radius} m`;
}
