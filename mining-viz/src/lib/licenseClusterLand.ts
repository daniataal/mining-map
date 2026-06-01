/** Coarse onshore envelopes for low-zoom license cluster bubbles (parity with Go licensemap/land.go). */
export type CountryLandBBox = {
  south: number;
  north: number;
  west: number;
  east: number;
};

const COUNTRY_LAND_BBOXES: Record<string, CountryLandBBox> = {
  ghana: { south: 4.5, north: 11.5, west: -3.5, east: 1.5 },
  "cote d'ivoire": { south: 4.2, north: 10.7, west: -8.6, east: -2.5 },
  "côte d'ivoire": { south: 4.2, north: 10.7, west: -8.6, east: -2.5 },
  'ivory coast': { south: 4.2, north: 10.7, west: -8.6, east: -2.5 },
  nigeria: { south: 4.0, north: 14.0, west: 2.7, east: 14.5 },
  senegal: { south: 12.0, north: 16.8, west: -17.8, east: -11.2 },
  mali: { south: 10.0, north: 25.0, west: -12.5, east: 4.5 },
  'burkina faso': { south: 9.2, north: 15.1, west: -5.6, east: 2.5 },
  guinea: { south: 7.0, north: 12.8, west: -15.5, east: -7.5 },
  liberia: { south: 4.2, north: 8.6, west: -11.6, east: -7.2 },
  'sierra leone': { south: 6.8, north: 10.1, west: -13.5, east: -10.0 },
  togo: { south: 6.0, north: 11.2, west: -0.2, east: 1.9 },
  benin: { south: 6.0, north: 12.5, west: 0.6, east: 3.9 },
  niger: { south: 11.5, north: 23.5, west: 0.8, east: 16.0 },
  cameroon: { south: 1.5, north: 13.2, west: 8.3, east: 16.3 },
  gabon: { south: -4.0, north: 2.5, west: 8.5, east: 14.8 },
  congo: { south: -5.2, north: 3.8, west: 11.0, east: 18.8 },
  'democratic republic of the congo': { south: -13.5, north: 5.5, west: 12.0, east: 31.5 },
  angola: { south: -18.5, north: -4.2, west: 11.5, east: 24.3 },
  namibia: { south: -28.5, north: -16.8, west: 11.5, east: 25.5 },
  'south africa': { south: -35.0, north: -22.0, west: 16.0, east: 33.0 },
  zambia: { south: -18.5, north: -8.0, west: 21.9, east: 33.8 },
  zimbabwe: { south: -22.5, north: -15.5, west: 25.0, east: 33.2 },
  mozambique: { south: -26.9, north: -10.3, west: 30.0, east: 41.0 },
  kenya: { south: -4.8, north: 5.5, west: 33.5, east: 42.0 },
  tanzania: { south: -11.8, north: -0.9, west: 29.0, east: 40.8 },
  ethiopia: { south: 3.0, north: 14.9, west: 32.9, east: 48.0 },
  egypt: { south: 22.0, north: 31.8, west: 24.5, east: 37.0 },
  morocco: { south: 27.5, north: 35.9, west: -13.5, east: -0.9 },
  algeria: { south: 18.9, north: 37.2, west: -8.8, east: 12.0 },
  mauritania: { south: 14.5, north: 27.5, west: -17.2, east: -4.5 },
  sudan: { south: 8.5, north: 22.5, west: 21.5, east: 39.0 },
  uganda: { south: -1.5, north: 4.3, west: 29.5, east: 35.1 },
  botswana: { south: -26.9, north: -17.7, west: 19.9, east: 29.5 },
  madagascar: { south: -25.8, north: -11.8, west: 43.0, east: 50.6 },
  peru: { south: -18.5, north: -0.5, west: -81.5, east: -68.5 },
  chile: { south: -56.0, north: -17.5, west: -76.0, east: -66.0 },
  brazil: { south: -33.8, north: 5.5, west: -74.0, east: -34.0 },
  australia: { south: -44.0, north: -10.0, west: 112.0, east: 154.0 },
  canada: { south: 41.5, north: 83.5, west: -141.5, east: -52.0 },
  'saudi arabia': { south: 16.0, north: 32.5, west: 34.5, east: 55.5 },
  'united arab emirates': { south: 22.5, north: 26.5, west: 51.0, east: 56.5 },
  uae: { south: 22.5, north: 26.5, west: 51.0, east: 56.5 },
};

function normalizeCountryLandKey(country: string): string {
  return country.trim().toLowerCase().replace(/\u2019/g, "'");
}

export function countryLandBBox(country: string | null | undefined): CountryLandBBox | null {
  if (!country?.trim()) return null;
  return COUNTRY_LAND_BBOXES[normalizeCountryLandKey(country)] ?? null;
}

function pointInLandBBox(lat: number, lng: number, bbox: CountryLandBBox): boolean {
  return lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east;
}

function landBBoxCenter(bbox: CountryLandBBox): { lat: number; lng: number } {
  return {
    lat: (bbox.south + bbox.north) / 2,
    lng: (bbox.west + bbox.east) / 2,
  };
}

/** Snap offshore cluster centers onto country land (client safety net when API is stale). */
export function refineClusterLandPosition(
  lat: number,
  lng: number,
  country: string | null | undefined,
): { lat: number; lng: number } {
  const bbox = countryLandBBox(country);
  if (!bbox) return { lat, lng };
  if (pointInLandBBox(lat, lng, bbox)) return { lat, lng };
  return landBBoxCenter(bbox);
}
