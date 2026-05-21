import type { OilOpportunity } from '../../api/oilLiveApi';

function fingerprint(opp: OilOpportunity): string {
  const otype = opp.opportunity_type ?? '';
  if (opp.terminal_id) return `${otype}|terminal:${opp.terminal_id}`;
  const title = (opp.title ?? '').trim().toLowerCase();
  return `${otype}|title:${title}`;
}

/** Coerce API / React Query payloads to an array (guards null, object wrappers, bad shapes). */
export function coerceOpportunityList(raw: unknown): OilOpportunity[] {
  if (Array.isArray(raw)) return raw as OilOpportunity[];
  if (raw && typeof raw === 'object') {
    const nested = (raw as { opportunities?: unknown }).opportunities;
    if (Array.isArray(nested)) return nested as OilOpportunity[];
  }
  return [];
}

/** Client-side dedup when API returns duplicate terminal/title rows. */
export function dedupeOpportunities(opportunities: unknown, maxOut = 40): OilOpportunity[] {
  const list = coerceOpportunityList(opportunities);
  const best = new Map<string, OilOpportunity>();
  for (const opp of list) {
    const fp = fingerprint(opp);
    const prev = best.get(fp);
    if (!prev || (opp.confidence ?? 0) > (prev.confidence ?? 0)) {
      best.set(fp, opp);
    }
  }

  const deduped = [...best.values()].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const out: OilOpportunity[] = [];
  const seenTerm = new Set<string>();
  const seenCountry = new Set<string>();
  const countryOf = (o: OilOpportunity) =>
    (o as OilOpportunity & { terminal_country?: string }).terminal_country?.trim() ?? '';

  const push = (opp: OilOpportunity) => {
    if (out.length >= maxOut || out.some((x) => x.id === opp.id)) return;
    out.push(opp);
  };

  for (const opp of deduped) {
    if (!opp.terminal_id || seenTerm.has(opp.terminal_id)) continue;
    push(opp);
    seenTerm.add(opp.terminal_id);
    const c = countryOf(opp);
    if (c) seenCountry.add(c);
  }
  for (const opp of deduped) {
    if (out.some((x) => x.id === opp.id)) continue;
    const c = countryOf(opp);
    if (!c || seenCountry.has(c)) continue;
    push(opp);
    seenCountry.add(c);
  }
  for (const opp of deduped) push(opp);

  return out;
}
