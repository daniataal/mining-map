/**
 * Split multi-value commodity fields from imports and manual entry.
 * Unknown delimiters remain inside a single token; substring search still sees the full raw string.
 */
const COMMODITY_TOKEN_SPLIT = /[,;|\n\r]+/;

export function splitCommodityTokens(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  return s
    .split(COMMODITY_TOKEN_SPLIT)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Title-case each whitespace-delimited word — matches existing mining-viz commodity labels. */
export function normalizeCommodityLabel(token: string): string {
  const t = token.trim();
  if (!t) return '';
  return t
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function commodityLabelsForField(raw: string | undefined): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return ['Unknown'];
  const tokens = splitCommodityTokens(trimmed);
  if (tokens.length === 0) return ['Unknown'];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of tokens) {
    const label = normalizeCommodityLabel(tok);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.length ? out : ['Unknown'];
}

/** Effective commodity labels for a row (annotation overrides base license). */
export function getLicenseCommodityLabels(
  itemCommodity: string | undefined,
  annotationCommodity: string | undefined
): string[] {
  const raw = (annotationCommodity ?? itemCommodity ?? '').trim();
  return commodityLabelsForField(raw.length ? raw : undefined);
}

export function commodityMatchesQuery(raw: string | undefined, lowerQuery: string): boolean {
  if (!lowerQuery) return true;
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase().includes(lowerQuery)) return true;
  return splitCommodityTokens(trimmed).some((t) => t.toLowerCase().includes(lowerQuery));
}

export function licenseMatchesSelectedCommodities(
  labels: string[],
  selected: string[]
): boolean {
  if (selected.length === 0) return true;
  const selectedLower = selected.map((s) => s.toLowerCase());
  return labels.some((l) => selectedLower.includes(l.toLowerCase()));
}
