import type { CountryCentroid } from './countryCentroids';
import { US_IMPORT_HUB } from './countryCentroids';

export type UsPortFields = {
  port_city?: string | null;
  port_state?: string | null;
  port_code?: string | null;
  port_label?: string | null;
};

function normToken(s: string | null | undefined): string {
  return (s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Display label for EIA PORT_CITY / PORT_STATE (and optional code). */
export function formatUsPortLabel(
  port_city?: string | null,
  port_state?: string | null,
  port_code?: string | null,
): string {
  const city = (port_city ?? '').trim();
  const state = (port_state ?? '').trim();
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  const code = (port_code ?? '').trim();
  if (code) return `Port ${code}`;
  return US_IMPORT_HUB.label;
}

/** Known U.S. petroleum import discharge points (EIA PSM port names). */
const US_PORTS: Record<string, CountryCentroid> = {
  'HOUSTON|TX': { lat: 29.73, lng: -95.27, label: 'Houston, TX' },
  'NEDERLAND|TX': { lat: 29.97, lng: -93.99, label: 'Nederland, TX' },
  'PORT ARTHUR|TX': { lat: 29.87, lng: -93.93, label: 'Port Arthur, TX' },
  'BEAUMONT|TX': { lat: 30.08, lng: -94.1, label: 'Beaumont, TX' },
  'CORPUS CHRISTI|TX': { lat: 27.8, lng: -97.4, label: 'Corpus Christi, TX' },
  'FREEPORT|TX': { lat: 28.95, lng: -95.36, label: 'Freeport, TX' },
  'TEXAS CITY|TX': { lat: 29.38, lng: -94.9, label: 'Texas City, TX' },
  'GALVESTON|TX': { lat: 29.3, lng: -94.8, label: 'Galveston, TX' },
  'LAKE CHARLES|LA': { lat: 30.23, lng: -93.22, label: 'Lake Charles, LA' },
  'BATON ROUGE|LA': { lat: 30.45, lng: -91.19, label: 'Baton Rouge, LA' },
  'NEW ORLEANS|LA': { lat: 29.95, lng: -90.07, label: 'New Orleans, LA' },
  'LOOP|LA': { lat: 28.92, lng: -90.98, label: 'LOOP, LA' },
  'ST. JAMES|LA': { lat: 30.02, lng: -90.83, label: 'St. James, LA' },
  'MOBILE|AL': { lat: 30.69, lng: -88.04, label: 'Mobile, AL' },
  'PASCAGOULA|MS': { lat: 30.36, lng: -88.56, label: 'Pascagoula, MS' },
  'NEW YORK|NY': { lat: 40.68, lng: -74.04, label: 'New York, NY' },
  'NEW YORK CITY|NY': { lat: 40.68, lng: -74.04, label: 'New York, NY' },
  'PHILADELPHIA|PA': { lat: 39.95, lng: -75.14, label: 'Philadelphia, PA' },
  'BALTIMORE|MD': { lat: 39.27, lng: -76.58, label: 'Baltimore, MD' },
  'BOSTON|MA': { lat: 42.36, lng: -71.05, label: 'Boston, MA' },
  'PORTLAND|ME': { lat: 43.66, lng: -70.25, label: 'Portland, ME' },
  'LOS ANGELES|CA': { lat: 33.74, lng: -118.27, label: 'Los Angeles, CA' },
  'LONG BEACH|CA': { lat: 33.75, lng: -118.19, label: 'Long Beach, CA' },
  'RICHMOND|CA': { lat: 37.93, lng: -122.37, label: 'Richmond, CA' },
  'SAN FRANCISCO|CA': { lat: 37.8, lng: -122.4, label: 'San Francisco, CA' },
  'SEATTLE|WA': { lat: 47.6, lng: -122.34, label: 'Seattle, WA' },
  'ANACORTES|WA': { lat: 48.52, lng: -122.61, label: 'Anacortes, WA' },
  'CHERRY POINT|WA': { lat: 48.86, lng: -122.76, label: 'Cherry Point, WA' },
  'PORTLAND|OR': { lat: 45.52, lng: -122.67, label: 'Portland, OR' },
  'SAVANNAH|GA': { lat: 32.08, lng: -81.09, label: 'Savannah, GA' },
  'TAMPA|FL': { lat: 27.95, lng: -82.46, label: 'Tampa, FL' },
  'PORT EVERGLADES|FL': { lat: 26.09, lng: -80.12, label: 'Port Everglades, FL' },
  'WILMINGTON|DE': { lat: 39.74, lng: -75.55, label: 'Wilmington, DE' },
  'PAULSBORO|NJ': { lat: 39.83, lng: -75.24, label: 'Paulsboro, NJ' },
  'LINDEN|NJ': { lat: 40.62, lng: -74.24, label: 'Linden, NJ' },
  'CHICAGO|IL': { lat: 41.88, lng: -87.63, label: 'Chicago, IL' },
  'DETROIT|MI': { lat: 42.33, lng: -83.05, label: 'Detroit, MI' },
  'CLEVELAND|OH': { lat: 41.5, lng: -81.69, label: 'Cleveland, OH' },
};

const STATE_FALLBACK: Record<string, CountryCentroid> = {
  TX: { lat: 29.5, lng: -95.0, label: 'Texas (approx.)' },
  LA: { lat: 29.8, lng: -91.5, label: 'Louisiana (approx.)' },
  CA: { lat: 33.8, lng: -118.2, label: 'California (approx.)' },
  WA: { lat: 47.6, lng: -122.3, label: 'Washington (approx.)' },
  NJ: { lat: 40.2, lng: -74.5, label: 'New Jersey (approx.)' },
  NY: { lat: 40.7, lng: -74.0, label: 'New York (approx.)' },
};

function portLookupKey(
  port_city?: string | null,
  port_state?: string | null,
): string | null {
  const city = normToken(port_city);
  const state = normToken(port_state);
  if (!city || !state) return null;
  return `${city}|${state}`;
}

/** Resolve discharge coordinates from EIA port fields; falls back to Gulf hub only when port is unknown. */
export function usPortCentroid(fields: UsPortFields): CountryCentroid {
  const label = (fields.port_label ?? '').trim() || formatUsPortLabel(
    fields.port_city,
    fields.port_state,
    fields.port_code,
  );
  const key = portLookupKey(fields.port_city, fields.port_state);
  if (key && US_PORTS[key]) {
    return { ...US_PORTS[key], label };
  }
  const state = normToken(fields.port_state);
  if (state && STATE_FALLBACK[state]) {
    return { ...STATE_FALLBACK[state], label };
  }
  return { ...US_IMPORT_HUB, label };
}

export function dischargeFromHistoricPort(fields: UsPortFields): {
  lat: number;
  lng: number;
  label: string;
} {
  const c = usPortCentroid(fields);
  return { lat: c.lat, lng: c.lng, label: c.label };
}
