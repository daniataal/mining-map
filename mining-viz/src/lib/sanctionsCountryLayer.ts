export type SanctionsFlagLevel = 'clear' | 'review' | 'flagged';

export type SanctionsCoverage = 'screened' | 'no_data';

/** Lowercase alias keys → canonical key (aligned with Go countrymatch). */
export const SANCTIONS_COUNTRY_ALIASES: Record<string, string> = {
  'cape verde': 'cabo verde',
  'congo kinshasa': 'democratic republic of the congo',
  'congo brazzaville': 'republic of the congo',
  'cote divoire': "cote d ivoire",
  'czech republic': 'czechia',
  'dem rep congo': 'democratic republic of the congo',
  'democratic republic of congo': 'democratic republic of the congo',
  drc: 'democratic republic of the congo',
  'ivory coast': "cote d ivoire",
  laos: 'lao pdr',
  macedonia: 'north macedonia',
  'myanmar burma': 'myanmar',
  palestine: 'state of palestine',
  'republic of congo': 'republic of the congo',
  'republic of moldova': 'moldova',
  'republic of north macedonia': 'north macedonia',
  russia: 'russian federation',
  'south korea': 'korea',
  swaziland: 'eswatini',
  syria: 'syrian arab republic',
  tanzania: 'united republic of tanzania',
  'the bahamas': 'bahamas',
  'the gambia': 'gambia',
  'timor leste': 'east timor',
  uae: 'united arab emirates',
  uk: 'united kingdom',
  usa: 'united states of america',
  'united states': 'united states of america',
  us: 'united states of america',
  venezuela: 'venezuela bolivarian republic of',
  'viet nam': 'vietnam',
};

export type SanctionsCountryRow = {
  country_code?: string;
  country_name: string;
  coverage: SanctionsCoverage;
  flag_level?: SanctionsFlagLevel;
  match_count: number;
  screened_entity_count: number;
  flagged_count: number;
  review_count: number;
  clear_count: number;
  source_tier: string;
  fetched_at: string;
};

export type SanctionsEntityHit = {
  id: string;
  name: string;
  sanctions_status: string;
  checked_at?: string;
  opensanctions_entity_id?: string;
};

export type SanctionsCountrySummaryResponse = {
  countries: SanctionsCountryRow[];
  disclaimer: string;
  source_tier: string;
  api_key_configured: boolean;
  cached: boolean;
  fetched_at: string;
  country_filter?: string;
  entities?: SanctionsEntityHit[];
  screened_companies?: number;
  screened_country_count?: number;
};

export function normalizeSanctionsCountryKey(value: string): string {
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return SANCTIONS_COUNTRY_ALIASES[base] ?? base;
}

export function sanctionsCountryKeysMatch(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  return normalizeSanctionsCountryKey(a) === normalizeSanctionsCountryKey(b);
}

export function buildSanctionsLookup(
  rows: SanctionsCountryRow[] | undefined,
): Map<string, SanctionsCountryRow> {
  const map = new Map<string, SanctionsCountryRow>();
  for (const row of rows ?? []) {
    if (row.coverage !== 'screened') continue;
    const key = normalizeSanctionsCountryKey(row.country_name);
    const existing = map.get(key);
    if (!existing || row.match_count > existing.match_count) {
      map.set(key, row);
    }
  }
  return map;
}

export function sanctionsFlagLevelForCountry(
  lookup: Map<string, SanctionsCountryRow>,
  countryName: string | undefined,
): SanctionsCountryRow | undefined {
  if (!countryName?.trim()) return undefined;
  return lookup.get(normalizeSanctionsCountryKey(countryName));
}

export function sanctionsChoroplethStyle(
  row: SanctionsCountryRow | undefined,
  isDark: boolean,
): {
  fillColor: string;
  color: string;
  weight: number;
  opacity: number;
  fillOpacity: number;
} | null {
  if (!row || row.coverage !== 'screened') {
    return null;
  }
  const level = row.flag_level;
  if (level === 'review') {
    return {
      fillColor: '#f59e0b',
      color: '#d97706',
      weight: 2,
      opacity: 0.9,
      fillOpacity: isDark ? 0.18 : 0.14,
    };
  }
  if (level === 'flagged') {
    return {
      fillColor: '#ef4444',
      color: '#b91c1c',
      weight: 2.2,
      opacity: 0.95,
      fillOpacity: isDark ? 0.24 : 0.2,
    };
  }
  return {
    fillColor: isDark ? '#94a3b8' : '#cbd5e1',
    color: isDark ? '#64748b' : '#94a3b8',
    weight: 1.5,
    opacity: isDark ? 0.55 : 0.65,
    fillOpacity: isDark ? 0.06 : 0.05,
  };
}

export const SANCTIONS_LEGEND = {
  flagged: { color: '#ef4444', label: 'Sanctions screening — flagged' },
  review: { color: '#f59e0b', label: 'Sanctions screening — review' },
  clear: { color: '#94a3b8', label: 'Screened — clear / no signal' },
  no_data: { color: '#64748b', label: 'No screening data — unknown' },
} as const;
