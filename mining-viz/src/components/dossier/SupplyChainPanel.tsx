import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../lib/i18n';
import type { MiningLicense, EntityRelationship } from '../../types';
import { apiClient, getGovProcurement, getEuProcurement } from '../../lib/api';
import {
  buildSupplyChainNodes,
  computeSupplyChainHud,
  filterSupplyChainNodes,
  sourceBadgeClass,
  type SupplyChainNode,
} from '../../lib/supplyChainNodes';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ExternalLink } from 'lucide-react';

interface StoredTradeFlow {
  partner?: string;
  flow_type?: string;
  hs_code?: string;
  year?: number;
  trade_value_usd?: number | null;
}

interface EntityTradeFlowsResponse {
  flows?: StoredTradeFlow[];
  warnings?: string[];
  limitations?: string[];
  country?: string;
  hsCodes?: string[];
}

interface SupplyChainPanelProps {
  item: MiningLicense;
  entityRelationships: EntityRelationship[];
  isLoadingRelationships?: boolean;
  onOpenExportsTab?: () => void;
  onOpenGovTab?: () => void;
}

function fmtUsd(val: number | null): string {
  if (val == null) return '—';
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
}

function roleLabel(role: SupplyChainNode['role'], t: (he: string, en: string) => string): string {
  if (role === 'supplier') return t('ספק (פרוקסי יבוא)', 'UPSTREAM PROXY');
  if (role === 'consumer') return t('צרכן (פרוקסי יצוא)', 'DOWNSTREAM PROXY');
  return t('מבנה תאגידי', 'CORPORATE STRUCTURE');
}

export default function SupplyChainPanel({
  item,
  entityRelationships,
  isLoadingRelationships = false,
  onOpenExportsTab,
  onOpenGovTab,
}: SupplyChainPanelProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'supplier' | 'consumer' | 'structure'>('all');
  const entityKind = item.entityKind || 'license';

  const { data: tradeData, isLoading: tradeLoading } = useQuery({
    queryKey: ['entity-trade-flows', item.id, entityKind],
    queryFn: async () => {
      const { data } = await apiClient.get<EntityTradeFlowsResponse>(
        `/entities/${encodeURIComponent(item.id)}/trade-flows`,
        { params: { entity_kind: entityKind, limit: 40 } },
      );
      return data;
    },
    enabled: Boolean(item.id),
    staleTime: 30 * 60_000,
  });

  const { data: govData, isLoading: govLoading } = useQuery({
    queryKey: ['gov-procurement', item.id, entityKind],
    queryFn: () => getGovProcurement(item.id, entityKind),
    enabled: Boolean(item.id),
    staleTime: 30 * 60_000,
  });

  const { data: euData, isLoading: euLoading } = useQuery({
    queryKey: ['eu-procurement', item.id, entityKind],
    queryFn: () => getEuProcurement(item.id, entityKind, { limit: 10 }),
    enabled: Boolean(item.id),
    staleTime: 30 * 60_000,
  });

  const flows = tradeData?.flows || [];
  const nodes = useMemo(
    () =>
      buildSupplyChainNodes({
        tradeFlows: flows,
        relationships: entityRelationships,
        govAwards: govData?.awards || [],
        euNotices: euData?.notices || [],
      }),
    [flows, entityRelationships, govData?.awards, euData?.notices],
  );

  const hud = useMemo(() => computeSupplyChainHud(nodes, flows), [nodes, flows]);
  const filtered = useMemo(
    () => filterSupplyChainNodes(nodes, search, filterType),
    [nodes, search, filterType],
  );

  const isLoading = tradeLoading || govLoading || euLoading || isLoadingRelationships;
  const topCountryLabel =
    hud.topCountries.length >= 2
      ? `${hud.topCountries[0].country} & ${hud.topCountries[1].country}: ${hud.topCountries[0].pct + hud.topCountries[1].pct}%`
      : hud.topCountries[0]
        ? `${hud.topCountries[0].country}: ${hud.topCountries[0].pct}%`
        : '—';

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] font-semibold text-amber-900 dark:text-amber-100">
        {t(
          'צדדים נגדיים מסיקים מנתוני סחר ורישום פתוחים — לא חוזי ספק מאומתים. אין מספרי DUNS מומצאים.',
          'Counterparties are inferred from open trade and registry data — not verified supplier contracts. No fabricated DUNS numbers.',
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-slate-900/50 dark:bg-slate-950/50 border-black/10 dark:border-white/10 rounded-3xl p-6 shadow-lg flex flex-col justify-between min-h-[200px]">
          <div>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
              {t('סקירת שרשרת ערך', 'GLOBAL LOGISTICS OVERVIEW')}
            </span>
            <h4 className="text-md font-black text-slate-900 dark:text-white uppercase truncate">
              {item.company}
            </h4>
            <div className="space-y-1 mt-3 text-[10px] text-slate-400 font-bold uppercase">
              <div className="flex justify-between">
                <span>{t('פרוקסי יבוא', 'Upstream proxies')}:</span>
                <span className="text-slate-700 dark:text-slate-300 font-mono">
                  {isLoading ? '…' : hud.upstreamCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t('פרוקסי יצוא', 'Downstream proxies')}:</span>
                <span className="text-slate-700 dark:text-slate-300 font-mono">
                  {isLoading ? '…' : hud.downstreamCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t('קשרים תאגידיים', 'Corporate links')}:</span>
                <span className="text-slate-700 dark:text-slate-300 font-mono">
                  {isLoading ? '…' : hud.structureCount}
                </span>
              </div>
            </div>
          </div>
          <p className="text-[9px] text-slate-500 mt-3 uppercase tracking-wider">
            {t('מקורות: Comtrade DB, יחסי ישות, USAspending, TED', 'Sources: Comtrade DB, relationships, USAspending, TED')}
          </p>
        </Card>

        <Card className="bg-slate-900/50 dark:bg-slate-950/50 border-black/10 dark:border-white/10 rounded-3xl p-6 md:col-span-2">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                {t('שווי סחר (Comtrade)', 'TRADE VALUE (COMTRADE)')}
              </span>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {hud.totalTradeValueUsd != null ? fmtUsd(hud.totalTradeValueUsd) : '—'}
              </p>
            </div>
            <div>
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                {t('שותפים בסיס נתונים', 'DB PARTNERS')}
              </span>
              <p className="text-2xl font-black text-slate-900 dark:text-white">{nodes.length}</p>
            </div>
            <div>
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                {t('מדינות מובילות', 'TOP COUNTRIES')}
              </span>
              <p className="text-sm font-black text-slate-900 dark:text-white truncate">{topCountryLabel}</p>
            </div>
          </div>
          {hud.topCountries.length > 0 && (
            <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5">
              <div className="w-full h-2 bg-black/10 dark:bg-white/10 rounded-full flex overflow-hidden">
                {hud.topCountries.map((c, i) => {
                  const colors = ['bg-blue-500', 'bg-amber-500', 'bg-emerald-500', 'bg-purple-500'];
                  return (
                    <div
                      key={c.country}
                      className={`h-full ${colors[i % colors.length]}`}
                      style={{ width: `${c.pct}%` }}
                      title={c.country}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'all' as const, label: 'All Channels' },
            { id: 'supplier' as const, label: 'Upstream' },
            { id: 'consumer' as const, label: 'Downstream' },
            { id: 'structure' as const, label: 'Corporate' },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFilterType(cat.id)}
              className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all
                ${filterType === cat.id
                  ? 'bg-purple-500 text-white border border-purple-500'
                  : 'bg-black/5 dark:bg-white/5 text-slate-500 border border-black/5 dark:border-white/5'}`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <Input
          type="text"
          placeholder={t('חיפוש שותפים…', 'Search partners…')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full md:w-64 text-xs rounded-xl"
        />
      </div>

      {isLoading && (
        <Card className="p-8 text-center text-sm text-slate-500">
          {t('טוען שרשרת אספקה…', 'Loading supply chain sources…')}
        </Card>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card className="p-8 text-center space-y-4 border-dashed border-amber-500/30">
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            {t(
              'אין צדדים נגדיים בבסיס הנתונים עבור רישיון זה.',
              'No counterparties in the database for this license yet.',
            )}
          </p>
          <p className="text-[11px] text-slate-500">
            {t(
              'הפעל סנכרון Comtrade (מנהל), בדוק יבוא/יצוא, או Gov Spending לחברות ארה״ב.',
              'Run Comtrade sync (Admin), check Exports & Imports, or Gov Spending for U.S. companies.',
            )}
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {onOpenExportsTab && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenExportsTab}>
                {t('יבוא/יצוא', 'Exports & Imports')}
              </Button>
            )}
            {onOpenGovTab && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenGovTab}>
                {t('הוצאות ממשל', 'Gov Spending')}
              </Button>
            )}
          </div>
          {(tradeData?.warnings || []).map((w) => (
            <p key={w} className="text-[10px] text-amber-600 dark:text-amber-400">
              {w}
            </p>
          ))}
        </Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((node) => (
            <Card
              key={node.id}
              className="p-6 bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 rounded-3xl"
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-500 text-[8px] font-mono">
                      {node.id.slice(0, 24)}
                    </Badge>
                    <Badge className={`text-[8px] font-black ${sourceBadgeClass(node.source)}`}>
                      {node.sourceLabel}
                    </Badge>
                    <span className="text-[10px] font-black uppercase text-slate-500">
                      {roleLabel(node.role, t)}
                    </span>
                  </div>
                  <h4 className="text-md font-black text-slate-900 dark:text-white uppercase">{node.name}</h4>
                  <p className="text-[10px] text-slate-500">{node.product}</p>
                  <p className="text-[10px] text-slate-400">{node.detail}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[8px] font-black uppercase text-slate-400 block">
                    {t('נפח / שווי', 'Volume / value')}
                  </span>
                  <p className="text-lg font-black text-slate-900 dark:text-white">{node.volume}</p>
                  {node.country && node.country !== '—' && (
                    <p className="text-[9px] text-slate-500 mt-1">{node.country}</p>
                  )}
                </div>
              </div>
              {node.sourceUrl && (
                <div className="mt-4 pt-3 border-t border-black/5 dark:border-white/5">
                  <a
                    href={node.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-cyan-600 dark:text-cyan-400 hover:underline"
                  >
                    {t('פתח במקור', 'Open source')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
