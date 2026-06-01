/**
 * Approximate country centroids for historic trade-flow map arcs.
 * Keys are normalized display names as returned by EIA CNTRY_NAME (uppercase trim).
 */

export type CountryCentroid = { lat: number; lng: number; label: string };

/** U.S. Gulf Coast import hub (Houston area) — historic EIA discharge proxy */
export const US_IMPORT_HUB: CountryCentroid = {
  lat: 29.76,
  lng: -95.37,
  label: 'U.S. Gulf Coast',
};

const CENTROIDS: Record<string, CountryCentroid> = {
  'SAUDI ARABIA': { lat: 24.0, lng: 45.0, label: 'Saudi Arabia' },
  CANADA: { lat: 56.0, lng: -96.0, label: 'Canada' },
  MEXICO: { lat: 23.0, lng: -102.0, label: 'Mexico' },
  VENEZUELA: { lat: 8.0, lng: -66.0, label: 'Venezuela' },
  'TRINIDAD & TOBAGO': { lat: 10.5, lng: -61.3, label: 'Trinidad & Tobago' },
  'TRINIDAD AND TOBAGO': { lat: 10.5, lng: -61.3, label: 'Trinidad & Tobago' },
  BRAZIL: { lat: -10.0, lng: -55.0, label: 'Brazil' },
  ARGENTINA: { lat: -34.0, lng: -64.0, label: 'Argentina' },
  COLOMBIA: { lat: 4.0, lng: -74.0, label: 'Colombia' },
  ECUADOR: { lat: -1.5, lng: -78.0, label: 'Ecuador' },
  NORWAY: { lat: 64.0, lng: 11.0, label: 'Norway' },
  'UNITED KINGDOM': { lat: 54.0, lng: -2.0, label: 'United Kingdom' },
  NIGERIA: { lat: 9.0, lng: 8.0, label: 'Nigeria' },
  ANGOLA: { lat: -12.0, lng: 18.0, label: 'Angola' },
  ALGERIA: { lat: 28.0, lng: 2.0, label: 'Algeria' },
  LIBYA: { lat: 27.0, lng: 17.0, label: 'Libya' },
  IRAQ: { lat: 33.0, lng: 44.0, label: 'Iraq' },
  IRAN: { lat: 32.0, lng: 53.0, label: 'Iran' },
  KUWAIT: { lat: 29.5, lng: 47.5, label: 'Kuwait' },
  'UNITED ARAB EMIRATES': { lat: 24.0, lng: 54.0, label: 'UAE' },
  QATAR: { lat: 25.3, lng: 51.5, label: 'Qatar' },
  RUSSIA: { lat: 61.0, lng: 90.0, label: 'Russia' },
  KAZAKHSTAN: { lat: 48.0, lng: 67.0, label: 'Kazakhstan' },
  AZERBAIJAN: { lat: 40.5, lng: 47.5, label: 'Azerbaijan' },
  INDIA: { lat: 22.0, lng: 79.0, label: 'India' },
  CHINA: { lat: 35.0, lng: 103.0, label: 'China' },
  JAPAN: { lat: 36.0, lng: 138.0, label: 'Japan' },
  'KOREA, REPUBLIC OF': { lat: 36.5, lng: 127.5, label: 'South Korea' },
  'KOREA, SOUTH': { lat: 36.5, lng: 127.5, label: 'South Korea' },
  SINGAPORE: { lat: 1.3, lng: 103.8, label: 'Singapore' },
  MALAYSIA: { lat: 4.2, lng: 101.9, label: 'Malaysia' },
  INDONESIA: { lat: -2.5, lng: 118.0, label: 'Indonesia' },
  AUSTRALIA: { lat: -25.0, lng: 133.0, label: 'Australia' },
  NETHERLANDS: { lat: 52.3, lng: 5.3, label: 'Netherlands' },
  BELGIUM: { lat: 50.5, lng: 4.5, label: 'Belgium' },
  FRANCE: { lat: 46.5, lng: 2.5, label: 'France' },
  GERMANY: { lat: 51.0, lng: 10.5, label: 'Germany' },
  ITALY: { lat: 42.8, lng: 12.5, label: 'Italy' },
  SPAIN: { lat: 40.0, lng: -4.0, label: 'Spain' },
  'VIRGIN ISLANDS, U.S.': { lat: 18.3, lng: -64.9, label: 'U.S. Virgin Islands' },
};

export function normalizeCountryKey(name: string | null | undefined): string {
  return (name ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export function countryCentroid(name: string | null | undefined): CountryCentroid | null {
  const key = normalizeCountryKey(name);
  if (!key) return null;
  return CENTROIDS[key] ?? null;
}
