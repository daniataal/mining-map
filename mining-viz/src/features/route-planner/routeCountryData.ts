import { countriesList } from '../../data/countries';
import { normalizeCountryFocusQuery } from '../../lib/countryFocusMatch';

/** Frequently used origins/destinations in African mining + major trade hubs. */
export const TOP_ROUTE_COUNTRIES: readonly string[] = [
  'Ghana',
  'Zambia',
  'Tanzania',
  'South Africa',
  'Democratic Republic of the Congo',
  'Mozambique',
  'Kenya',
  'Nigeria',
  "Cote d'Ivoire",
  'Senegal',
  'Namibia',
  'Israel',
  'Netherlands',
  'Belgium',
  'Germany',
  'United Arab Emirates',
  'Singapore',
  'China',
  'India',
  'United States of America',
  'United Kingdom',
  'Switzerland',
  'Brazil',
  'Australia',
  'Canada',
];

export const ROUTE_COUNTRY_SEARCH_MAX = 50;

export function filterRouteCountries(query: string, max = ROUTE_COUNTRY_SEARCH_MAX): string[] {
  const q = normalizeCountryFocusQuery(query.trim());
  if (!q) {
    const top = new Set(TOP_ROUTE_COUNTRIES);
    const rest: string[] = [];
    for (const c of countriesList) {
      if (!top.has(c)) rest.push(c);
    }
    return [...TOP_ROUTE_COUNTRIES, ...rest].slice(0, max);
  }
  const matches: string[] = [];
  for (const c of countriesList) {
    if (normalizeCountryFocusQuery(c).includes(q)) {
      matches.push(c);
      if (matches.length >= max) break;
    }
  }
  return matches;
}
