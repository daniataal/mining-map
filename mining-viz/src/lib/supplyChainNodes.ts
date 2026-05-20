import type { EntityRelationship, GovProcurementAward } from '../types';
import type { EuProcurementNotice } from '../lib/api';

export type SupplyChainNodeRole = 'supplier' | 'consumer' | 'structure';

export type SupplyChainNodeSource = 'comtrade_db' | 'entity_relationship' | 'usaspending' | 'ted';

export interface SupplyChainNode {
  id: string;
  name: string;
  role: SupplyChainNodeRole;
  product: string;
  country: string;
  volume: string;
  detail: string;
  source: SupplyChainNodeSource;
  sourceLabel: string;
  sourceUrl?: string;
}

export interface StoredTradeFlowInput {
  partner?: string;
  flow_type?: string;
  hs_code?: string;
  year?: number;
  trade_value_usd?: number | null;
}

export interface SupplyChainHudMetrics {
  upstreamCount: number;
  downstreamCount: number;
  structureCount: number;
  totalTradeValueUsd: number | null;
  topCountries: { country: string; pct: number }[];
  hasData: boolean;
}

function fmtUsd(val: number | null | undefined): string {
  if (val == null || Number.isNaN(val)) return '—';
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
}

function slugId(prefix: string, key: string): string {
  const clean = key.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 48);
  return `${prefix}-${clean}`;
}

export function nodesFromTradeFlows(flows: StoredTradeFlowInput[]): SupplyChainNode[] {
  const nodes: SupplyChainNode[] = [];
  for (let i = 0; i < flows.length; i += 1) {
    const row = flows[i];
    const partner = (row.partner || '').trim();
    if (!partner) continue;
    const isExport = row.flow_type === 'X' || String(row.flow_type || '').toLowerCase() === 'export';
    const role: SupplyChainNodeRole = isExport ? 'consumer' : 'supplier';
    const year = row.year != null ? String(row.year) : '—';
    nodes.push({
      id: slugId('comtrade', `${partner}-${row.flow_type}-${row.year}-${i}`),
      name: partner,
      role,
      product: `HS ${row.hs_code || '—'} · ${isExport ? 'Export partner' : 'Import partner'}`,
      country: partner,
      volume: fmtUsd(row.trade_value_usd),
      detail: `UN Comtrade ${year} · country-level partner (not a contract)`,
      source: 'comtrade_db',
      sourceLabel: 'Comtrade DB',
      sourceUrl: 'https://comtradeplus.un.org/',
    });
  }
  return nodes;
}

const STRUCTURE_TYPES = new Set([
  'parent_company',
  'subsidiary',
  'owner',
  'operator',
  'license_holder',
  'beneficial_owner',
  'manager',
]);

export function nodesFromRelationships(relationships: EntityRelationship[]): SupplyChainNode[] {
  return relationships.map((rel, i) => {
    const type = (rel.relationshipType || 'related').replace(/_/g, ' ');
    const role: SupplyChainNodeRole = STRUCTURE_TYPES.has(rel.relationshipType)
      ? 'structure'
      : 'structure';
    const pct =
      rel.ownershipPct != null && !Number.isNaN(Number(rel.ownershipPct))
        ? `${rel.ownershipPct}%`
        : '—';
    return {
      id: slugId('rel', rel.id || `${rel.targetName}-${i}`),
      name: rel.targetName || rel.targetEntityRef || 'Unknown entity',
      role,
      product: rel.relationshipLabel || type,
      country: '—',
      volume: pct,
      detail: rel.sourceName ? `Source: ${rel.sourceName}` : 'Registry / open-data relationship',
      source: 'entity_relationship',
      sourceLabel: 'Entity relationship',
      sourceUrl: rel.sourceUrl || undefined,
    };
  });
}

export function nodesFromGovAwards(awards: GovProcurementAward[], max = 8): SupplyChainNode[] {
  return awards.slice(0, max).map((award) => ({
    id: slugId('usaspending', award.id),
    name: award.recipient || award.title || 'Federal award',
    role: 'consumer' as const,
    product: award.commodity || award.category || 'Federal contract',
    country: 'United States',
    volume: fmtUsd(award.value),
    detail: `${award.agency || 'Agency'} · ${award.period || 'Period n/a'}`,
    source: 'usaspending' as const,
    sourceLabel: 'USAspending',
    sourceUrl: award.sourceUrl || 'https://www.usaspending.gov/',
  }));
}

export function nodesFromEuNotices(notices: EuProcurementNotice[], max = 6): SupplyChainNode[] {
  return notices.slice(0, max).map((notice, i) => ({
    id: slugId('ted', notice.notice_id || String(i)),
    name: notice.buyer || notice.title || 'EU notice',
    role: 'consumer' as const,
    product: notice.cpv ? `CPV ${notice.cpv}` : 'EU public procurement',
    country: notice.country || 'EU',
    volume: notice.award_value != null ? fmtUsd(notice.award_value) : '—',
    detail: notice.published_at
      ? `Published ${notice.published_at.slice(0, 10)}`
      : 'TED notice (fuzzy company match)',
    source: 'ted' as const,
    sourceLabel: 'EU TED',
    sourceUrl: notice.source_url || 'https://ted.europa.eu/',
  }));
}

export function buildSupplyChainNodes(input: {
  tradeFlows?: StoredTradeFlowInput[];
  relationships?: EntityRelationship[];
  govAwards?: GovProcurementAward[];
  euNotices?: EuProcurementNotice[];
}): SupplyChainNode[] {
  const seen = new Set<string>();
  const out: SupplyChainNode[] = [];

  const pushUnique = (node: SupplyChainNode) => {
    const key = `${node.source}|${node.name.toLowerCase()}|${node.role}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(node);
  };

  for (const n of nodesFromTradeFlows(input.tradeFlows || [])) pushUnique(n);
  for (const n of nodesFromRelationships(input.relationships || [])) pushUnique(n);
  for (const n of nodesFromGovAwards(input.govAwards || [])) pushUnique(n);
  for (const n of nodesFromEuNotices(input.euNotices || [])) pushUnique(n);

  return out;
}

export function computeSupplyChainHud(
  nodes: SupplyChainNode[],
  tradeFlows: StoredTradeFlowInput[],
): SupplyChainHudMetrics {
  const upstreamCount = nodes.filter((n) => n.role === 'supplier').length;
  const downstreamCount = nodes.filter((n) => n.role === 'consumer').length;
  const structureCount = nodes.filter((n) => n.role === 'structure').length;

  let totalTradeValueUsd = 0;
  let hasTradeValue = false;
  for (const row of tradeFlows) {
    if (row.trade_value_usd != null && !Number.isNaN(Number(row.trade_value_usd))) {
      totalTradeValueUsd += Number(row.trade_value_usd);
      hasTradeValue = true;
    }
  }

  const countryTotals = new Map<string, number>();
  for (const n of nodes) {
    const c = (n.country || '').trim();
    if (!c || c === '—') continue;
    countryTotals.set(c, (countryTotals.get(c) || 0) + 1);
  }
  const sorted = Array.from(countryTotals.entries()).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
  const topCountries = sorted.slice(0, 4).map(([country, count]) => ({
    country,
    pct: Math.round((count / total) * 100),
  }));

  return {
    upstreamCount,
    downstreamCount,
    structureCount,
    totalTradeValueUsd: hasTradeValue ? totalTradeValueUsd : null,
    topCountries,
    hasData: nodes.length > 0,
  };
}

export function filterSupplyChainNodes(
  nodes: SupplyChainNode[],
  search: string,
  filterType: 'all' | 'supplier' | 'consumer' | 'structure',
): SupplyChainNode[] {
  const q = search.trim().toLowerCase();
  return nodes.filter((node) => {
    const matchesType =
      filterType === 'all' ||
      node.role === filterType ||
      (filterType === 'supplier' && node.role === 'supplier') ||
      (filterType === 'consumer' && node.role === 'consumer') ||
      (filterType === 'structure' && node.role === 'structure');
    if (!matchesType) return false;
    if (!q) return true;
    return (
      node.name.toLowerCase().includes(q) ||
      node.product.toLowerCase().includes(q) ||
      node.country.toLowerCase().includes(q) ||
      node.id.toLowerCase().includes(q)
    );
  });
}

export function sourceBadgeClass(source: SupplyChainNodeSource): string {
  switch (source) {
    case 'comtrade_db':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'entity_relationship':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    case 'usaspending':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'ted':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
    default:
      return 'bg-slate-500/10 text-slate-500';
  }
}
