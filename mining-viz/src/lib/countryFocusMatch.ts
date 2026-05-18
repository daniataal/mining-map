import { countriesList } from '../data/countries';

/** Lowercase alias / shorthand → canonical English name (aligned with `countriesList` / license `country`). */
export const COUNTRY_FOCUS_ALIASES: Record<string, string> = {
  uae: 'United Arab Emirates',
  usa: 'United States of America',
  us: 'United States of America',
  uk: 'United Kingdom',
  gb: 'United Kingdom',
  drc: 'Democratic Republic of the Congo',
  ussr: 'Russia',
};

export function normalizeCountryFocusQuery(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeKey(s: string): string {
  return normalizeCountryFocusQuery(s);
}

/** `country:…` prefix in the intelligence hub search. */
export function tryParseCountryColonQuery(input: string): string | null {
  const m = input.match(/^\s*country:\s*(.+)\s*$/i);
  if (!m) return null;
  const inner = m[1].trim();
  return inner || null;
}

function buildNameLookup(dataCountries: readonly string[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const name of countriesList) {
    const key = normalizeKey(name);
    if (!lookup.has(key)) lookup.set(key, name);
  }
  for (const raw of dataCountries) {
    const name = raw.trim();
    if (!name) continue;
    const key = normalizeKey(name);
    if (!lookup.has(key)) lookup.set(key, name);
  }
  return lookup;
}

/**
 * Resolve a user token (alias, exact name, or close spelling) to a canonical country name, or null.
 */
export function resolveCountryFocusToken(token: string, dataCountries: readonly string[]): string | null {
  const raw = token.trim();
  if (!raw) return null;

  const aliasHit = COUNTRY_FOCUS_ALIASES[normalizeKey(raw)];
  if (aliasHit) return aliasHit;

  const lookup = buildNameLookup(dataCountries);
  const key = normalizeKey(raw);
  const exact = lookup.get(key);
  if (exact) return exact;

  const starts: string[] = [];
  for (const [k, canon] of lookup) {
    if (k.startsWith(key) && key.length >= 2) starts.push(canon);
  }
  const uniq = Array.from(new Set(starts));
  if (uniq.length === 1) return uniq[0]!;

  return null;
}

/** When the trimmed query is already an exact canonical country name (after alias / token resolution). */
export function matchExactCountryFocusQuery(query: string, dataCountries: readonly string[]): string | null {
  const t = query.trim();
  if (!t) return null;
  const resolved = resolveCountryFocusToken(t, dataCountries);
  if (!resolved) return null;
  return normalizeKey(resolved) === normalizeKey(t) ? resolved : null;
}

type Scored = { name: string; score: number };

function scoreCountryName(name: string, q: string): number {
  const k = normalizeKey(name);
  if (!q) return 0;
  if (k === q) return 100;
  if (k.startsWith(q)) return 85 - Math.min(20, k.length * 0.05);
  if (k.includes(q)) return 55 - Math.min(15, k.length * 0.03);
  const qWords = q.split(' ').filter(Boolean);
  if (qWords.length >= 2 && qWords.every((w) => k.includes(w))) return 45;
  return 0;
}

/**
 * Ranked country name suggestions for the search dropdown (union of static list + data countries).
 */
export function suggestCountriesForFocus(
  query: string,
  dataCountries: readonly string[],
  limit = 8,
): string[] {
  const q = normalizeKey(query);
  if (q.length < 2) return [];

  const candidates = new Set<string>([...countriesList, ...dataCountries.map((c) => c.trim()).filter(Boolean)]);

  const scored: Scored[] = [];
  for (const name of candidates) {
    const s = scoreCountryName(name, q);
    if (s > 0) scored.push({ name, score: s });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    const dedupe = normalizeKey(row.name);
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(row.name);
    if (out.length >= limit) break;
  }
  return out;
}
