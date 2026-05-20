export interface TradeEvidenceLink {
  id: string;
  label: string;
  url: string;
  description: string;
}

export interface StoredTradeFlowRow {
  partner?: string;
  flow_type?: string;
  hs_code?: string;
  year?: number;
  trade_value_usd?: number | null;
}

export interface TradePartnerSummary {
  partner: string;
  flowType: 'import' | 'export';
  totalUsd: number;
  hsCodes: string[];
  years: number[];
}

const COMMODITY_HS_HINTS: Record<string, string[]> = {
  gold: ['261690', '7108'],
  oil: ['2709', '2710'],
  crude: ['2709'],
  petroleum: ['2709', '2710', '2711'],
  gas: ['2711'],
  copper: ['2603'],
  iron: ['2601'],
  coal: ['2701'],
  lithium: ['283691'],
  nickel: ['7502'],
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Map commodity label to HS chapter hints for external deep links (best-effort, not authoritative). */
export function hsCodesFromCommodity(commodity?: string, explicit?: string[]): string[] {
  const out = new Set<string>();
  for (const code of explicit || []) {
    const c = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (c.length >= 4) out.add(c);
  }
  const raw = normalizeKey(commodity || '');
  if (!raw) return Array.from(out);
  for (const [needle, codes] of Object.entries(COMMODITY_HS_HINTS)) {
    if (raw.includes(needle)) codes.forEach((c) => out.add(c));
  }
  return Array.from(out);
}

function comtradeCommodityParam(hsCodes: string[]): string {
  if (hsCodes.length) return hsCodes.slice(0, 6).join('%2C');
  return 'TOTAL';
}

/**
 * External trade portals that need no API key — country/commodity from the license.
 */
export function buildTradeEvidenceLinks(input: {
  country?: string;
  commodity?: string;
  hsCodes?: string[];
}): TradeEvidenceLink[] {
  const country = (input.country || '').trim();
  const commodity = (input.commodity || '').trim();
  const hsCodes = hsCodesFromCommodity(commodity, input.hsCodes);
  const encCountry = encodeURIComponent(country || 'World');
  const encCommodity = encodeURIComponent(commodity || 'mining');
  const comtradeHs = comtradeCommodityParam(hsCodes);

  const links: TradeEvidenceLink[] = [
    {
      id: 'comtrade',
      label: 'UN Comtrade (free browser)',
      url: country
        ? `https://comtradeplus.un.org/TradeFlow?Frequency=A&Flows=X%2CM&CommodityCodes=${comtradeHs}&Partners=0&Reporters=${encCountry}&period=2023&AggregateBy=none&BreakdownMode=plus`
        : 'https://comtradeplus.un.org/',
      description: country
        ? `Country-level import/export flows for ${country}${hsCodes.length ? ` · HS ${hsCodes.join(', ')}` : ''} — not shipment BOL.`
        : 'UN Comtrade public trade-flow browser (no API key for manual lookup).',
    },
    {
      id: 'census',
      label: 'US Census — International Trade',
      url: country
        ? `https://data.census.gov/cedsci/table?q=${encodeURIComponent(`${country} international trade`)}`
        : 'https://www.census.gov/foreign-trade/guide/sec2.html',
      description:
        'U.S. Census Bureau international trade data explorer (free, no key). Useful when the U.S. is reporter or partner.',
    },
    {
      id: 'itc-trademap',
      label: 'ITC Trade Map',
      url: `https://www.trademap.org/Index.aspx?nvpm=1|${encCountry}||||${encCommodity}|2|1|1|1|2|1|1|1|1|1`,
      description: country
        ? `ITC Trade Map country/product view for ${country} — market access and partner rankings (free registration).`
        : 'ITC Trade Map — bilateral trade statistics (free registration, not BOL).',
    },
  ];

  return links;
}

function flowKind(flowType?: string): 'import' | 'export' | null {
  const f = String(flowType || '').toUpperCase();
  if (f === 'M' || f === 'IMPORT') return 'import';
  if (f === 'X' || f === 'EXPORT') return 'export';
  return null;
}

/** Aggregate Comtrade rows into top import/export partners by USD (country-level proxy). */
export function summarizeTradePartners(
  flows: StoredTradeFlowRow[],
  opts?: { maxPerDirection?: number },
): { imports: TradePartnerSummary[]; exports: TradePartnerSummary[] } {
  const max = opts?.maxPerDirection ?? 8;
  const buckets = new Map<string, TradePartnerSummary>();

  for (const row of flows) {
    const partner = (row.partner || '').trim();
    const kind = flowKind(row.flow_type);
    if (!partner || !kind) continue;
    const key = `${kind}|${partner}`;
    let entry = buckets.get(key);
    if (!entry) {
      entry = {
        partner,
        flowType: kind,
        totalUsd: 0,
        hsCodes: [],
        years: [],
      };
      buckets.set(key, entry);
    }
    const val = row.trade_value_usd;
    if (val != null && !Number.isNaN(Number(val))) entry.totalUsd += Number(val);
    if (row.hs_code) {
      const hs = String(row.hs_code);
      if (!entry.hsCodes.includes(hs)) entry.hsCodes.push(hs);
    }
    if (row.year != null && !entry.years.includes(row.year)) entry.years.push(row.year);
  }

  const sortDesc = (a: TradePartnerSummary, b: TradePartnerSummary) => b.totalUsd - a.totalUsd;
  const imports = Array.from(buckets.values()).filter((r) => r.flowType === 'import').sort(sortDesc).slice(0, max);
  const exports = Array.from(buckets.values()).filter((r) => r.flowType === 'export').sort(sortDesc).slice(0, max);
  return { imports, exports };
}

export function tradeEvidenceHasData(input: {
  flowCount?: number;
  hasMaritime?: boolean;
  country?: string;
}): boolean {
  return Boolean((input.flowCount ?? 0) > 0 || input.hasMaritime || (input.country || '').trim());
}
