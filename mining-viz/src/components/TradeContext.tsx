/**
 * TradeContext — Trade & Financial Context panel for a mining license dossier.
 *
 * Data sources (fetched via backend /api/company-intel):
 *   • UN Comtrade  — country-level commodity export/import flows (free tier, 500 req/day)
 *                    Requires COMTRADE_API_KEY env var on backend. Degrades to deep-links if absent.
 *   • World Bank   — GDP, FDI inflows, GDP per capita, mining share of GDP (free, no key needed)
 *   • Deep links   — OpenCorporates, EITI, Comtrade+, Google for manual verification
 *
 * Limitations displayed inline to the user:
 *   - All trade data is COUNTRY-level (not company-level). Company customs data is not free.
 *   - Comtrade lags 12–24 months; World Bank lags ~12 months.
 */

import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense } from '../types';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  TrendingUp as IconTrendingUp,
  TrendingDown as IconTrendingDown,
  ExternalLink as IconExternalLink,
  AlertTriangle as IconAlert,
  Globe as IconGlobe,
  BarChart2 as IconBarChart,
  Building2 as IconBuilding,
  RefreshCw as IconRefresh,
  Info as IconInfo,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TradeFlow {
  flow: 'Export' | 'Import';
  trade_value_usd: number | null;
  net_weight_kg: number | null;
  partner: string | null;
  year: string | number | null;
  qty: number | null;
  qty_unit: string | null;
}

interface WorldBankIndicator {
  value: number;
  year: string;
}

interface CompanyIntelResponse {
  company: string;
  country: string;
  commodity: string;
  hs_code: string | null;
  country_codes: { iso2?: string; m49?: string };
  trade_flows: {
    source?: string;
    year?: number;
    hs_code?: string;
    flows?: TradeFlow[];
  };
  economy: {
    source?: string;
    indicators?: {
      gdp_usd?: WorldBankIndicator;
      gdp_per_capita_usd?: WorldBankIndicator;
      fdi_inflows_usd?: WorldBankIndicator;
      mining_share_of_gdp_pct?: WorldBankIndicator;
    };
  };
  deep_links: {
    label: string;
    url: string;
    description: string;
    icon: string;
  }[];
  comtrade_available: boolean;
  data_as_of: string;
  limitations: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtUsd(val: number | null | undefined, compact = true): string {
  if (val == null) return 'N/A';
  if (compact) {
    if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
    if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
    if (Math.abs(val) >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  }
  return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtKg(val: number | null | undefined): string {
  if (val == null) return 'N/A';
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)}t`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(1)}kg×10³`;
  return `${val.toFixed(0)} kg`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface TradeContextProps {
  item: MiningLicense;
}

export default function TradeContext({ item }: TradeContextProps) {
  const { t } = useI18n();
  const [data, setData] = useState<CompanyIntelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const API_BASE =
    (import.meta as any).env?.VITE_API_BASE ||
    `http://${window.location.hostname}:8000`;

  const fetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        company: item.company,
        country: item.country,
        commodity: item.commodity || '',
      });
      const res = await window.fetch(`${API_BASE}/api/company-intel?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: CompanyIntelResponse = await res.json();
      setData(json);
      setFetched(true);
    } catch (e: any) {
      setError(e.message || 'Failed to load trade data');
    } finally {
      setLoading(false);
    }
  };

  // ─── Empty / loading ───────────────────────────────────────────────────────

  if (!fetched && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <IconBarChart className="w-8 h-8 text-cyan-400" />
        </div>
        <div className="text-center max-w-sm">
          <p className="text-sm font-black text-white uppercase tracking-widest mb-2">
            {t('הקשר מסחרי', 'Trade & Financial Context')}
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            {t(
              'טען נתוני יצוא/יבוא ומאקרו כלכלי לפי מדינה + סחורה ממקורות פתוחים.',
              'Load country-level export/import flows and macro-economic data from open sources (UN Comtrade · World Bank).'
            )}
          </p>
        </div>
        <Button
          onClick={fetch}
          className="h-12 px-8 bg-cyan-600 hover:bg-cyan-700 text-white font-black uppercase tracking-widest text-[10px]"
        >
          <IconBarChart className="w-3.5 h-3.5 mr-2" />
          {t('טען נתונים', 'Load Trade Data')}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest animate-pulse">
          {t('טוען...', 'Fetching open data...')}
        </span>
        <span className="text-[9px] text-slate-600 uppercase">
          UN Comtrade · World Bank
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <IconAlert className="w-8 h-8 text-red-400" />
        <p className="text-sm text-red-400 font-bold">{error}</p>
        <Button
          onClick={fetch}
          variant="outline"
          className="border-white/10 text-slate-300 text-[10px] font-black uppercase"
        >
          <IconRefresh className="w-3.5 h-3.5 mr-2" /> {t('נסה שוב', 'Retry')}
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const flows = data.trade_flows?.flows || [];
  const exports = flows.filter(f => f.flow === 'Export');
  const imports = flows.filter(f => f.flow === 'Import');
  const ind = data.economy?.indicators || {};

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[11px] font-black text-cyan-400 uppercase tracking-widest mb-0.5">
            {t('הקשר מסחרי וכלכלי', 'Trade & Financial Context')}
          </h3>
          <p className="text-[9px] text-slate-500 uppercase">
            {data.country} · {data.commodity}
            {data.hs_code ? ` · HS ${data.hs_code}` : ''} ·{' '}
            {data.data_as_of}
          </p>
        </div>
        <Button
          onClick={fetch}
          size="sm"
          variant="ghost"
          className="h-8 px-3 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-cyan-400 border border-white/5"
        >
          <IconRefresh className="w-3 h-3 mr-1" />
          {t('רענן', 'Refresh')}
        </Button>
      </div>

      {/* Comtrade availability banner */}
      {!data.comtrade_available && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
          <IconInfo className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-0.5">
              {t('מפתח Comtrade לא מוגדר', 'Comtrade key not configured')}
            </p>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              {t(
                'הגדר COMTRADE_API_KEY בצד השרת לקבלת נתוני יצוא/יבוא. הרשמה חינמית ב-comtradeapi.un.org (500 בקשות/יום).',
                'Set COMTRADE_API_KEY on the backend to enable export/import flow data. Free registration at comtradeapi.un.org (500 req/day).'
              )}
            </p>
          </div>
        </div>
      )}

      {/* Trade Flows */}
      {flows.length > 0 ? (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <IconTrendingUp className="w-4 h-4 text-cyan-400" />
            <h4 className="text-[11px] font-black text-cyan-400 uppercase tracking-widest">
              {t('זרימות סחר לאומיות', 'National Trade Flows')}
            </h4>
            <Badge className="bg-cyan-500/10 text-cyan-400 border-none text-[8px] font-black ml-auto">
              {data.trade_flows.source}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Exports */}
            <div>
              <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <IconTrendingUp className="w-3 h-3" />
                {t('יצוא', 'Exports')} ({exports.length})
              </p>
              {exports.length === 0 ? (
                <p className="text-xs text-slate-600 italic">No export records found</p>
              ) : (
                <div className="space-y-2">
                  {exports.slice(0, 5).map((flow, i) => (
                    <TradeFlowRow key={i} flow={flow} type="export" />
                  ))}
                </div>
              )}
            </div>

            {/* Imports */}
            <div>
              <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <IconTrendingDown className="w-3 h-3" />
                {t('יבוא', 'Imports')} ({imports.length})
              </p>
              {imports.length === 0 ? (
                <p className="text-xs text-slate-600 italic">No import records found</p>
              ) : (
                <div className="space-y-2">
                  {imports.slice(0, 5).map((flow, i) => (
                    <TradeFlowRow key={i} flow={flow} type="import" />
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="mt-4 text-[8px] text-slate-600 uppercase tracking-widest">
            Source: UN Comtrade · HS {data.hs_code} · Year {data.trade_flows.year}
            {' '}· Country-level only (not company-specific)
          </p>
        </Card>
      ) : data.comtrade_available ? (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <IconBarChart className="w-4 h-4 text-slate-500" />
            <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
              {t('אין נתוני מסחר', 'No Trade Flow Data')}
            </h4>
          </div>
          <p className="text-xs text-slate-600">
            {data.hs_code
              ? `No Comtrade records found for ${data.country} (HS ${data.hs_code}) in recent periods.`
              : `Commodity "${data.commodity}" could not be mapped to an HS code. Use the deep links below to explore manually.`}
          </p>
        </Card>
      ) : null}

      {/* World Bank Economy */}
      {Object.keys(ind).length > 0 && (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <IconGlobe className="w-4 h-4 text-indigo-400" />
            <h4 className="text-[11px] font-black text-indigo-400 uppercase tracking-widest">
              {t('מאקרו כלכלי', 'Economic Context')} — {data.country}
            </h4>
            <Badge className="bg-indigo-500/10 text-indigo-400 border-none text-[8px] font-black ml-auto">
              World Bank
            </Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {ind.gdp_usd && (
              <EconCard
                label={t('תוצר גולמי (GDP)', 'GDP')}
                value={fmtUsd(ind.gdp_usd.value)}
                year={ind.gdp_usd.year}
                color="indigo"
              />
            )}
            {ind.gdp_per_capita_usd && (
              <EconCard
                label={t('GDP לנפש', 'GDP / capita')}
                value={fmtUsd(ind.gdp_per_capita_usd.value)}
                year={ind.gdp_per_capita_usd.year}
                color="indigo"
              />
            )}
            {ind.fdi_inflows_usd && (
              <EconCard
                label={t('זרימות FDI', 'FDI Inflows')}
                value={fmtUsd(ind.fdi_inflows_usd.value)}
                year={ind.fdi_inflows_usd.year}
                color="cyan"
              />
            )}
            {ind.mining_share_of_gdp_pct && (
              <EconCard
                label={t('% כרייה מ-GDP', 'Mining % of GDP')}
                value={`${ind.mining_share_of_gdp_pct.value.toFixed(1)}%`}
                year={ind.mining_share_of_gdp_pct.year}
                color="amber"
              />
            )}
          </div>
          <p className="mt-4 text-[8px] text-slate-600 uppercase tracking-widest">
            Source: World Bank Open Data · data.worldbank.org · Subject to ~12 month lag
          </p>
        </Card>
      )}

      {/* Deep Links */}
      <Card className="bg-white/5 border-white/5 rounded-3xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <IconBuilding className="w-4 h-4 text-amber-400" />
          <h4 className="text-[11px] font-black text-amber-400 uppercase tracking-widest">
            {t('קישורי אימות ידני', 'Manual Verification Links')}
          </h4>
        </div>
        <p className="text-[10px] text-slate-500 mb-4 leading-relaxed">
          {t(
            'אין API חינמי לנתוני מכס ברמת חברה. השתמש בקישורים הבאים לאימות ידני:',
            'Company-level customs data is not available for free. Use these links for manual due diligence:'
          )}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.deep_links.map((link, i) => (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-colors group"
            >
              <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">
                  {link.label}
                </span>
                <span className="text-[10px] text-slate-400 leading-snug group-hover:text-slate-200 transition-colors truncate">
                  {link.description}
                </span>
              </div>
              <IconExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-white shrink-0 transition-colors" />
            </a>
          ))}
        </div>
      </Card>

      {/* Limitations / Disclaimer */}
      <div className="flex items-start gap-3 p-4 bg-slate-900/60 border border-white/5 rounded-2xl">
        <IconAlert className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">
            {t('מגבלות ידועות של המידע', 'Known Data Limitations')}
          </p>
          <ul className="space-y-1">
            {data.limitations.map((lim, i) => (
              <li key={i} className="text-[9px] text-slate-600 leading-relaxed flex items-start gap-1.5">
                <span className="text-slate-700 mt-0.5 shrink-0">•</span>
                {lim}
              </li>
            ))}
          </ul>
        </div>
      </div>

    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TradeFlowRow({ flow, type }: { flow: TradeFlow; type: 'export' | 'import' }) {
  const isExport = type === 'export';
  return (
    <div className="flex items-start gap-2 p-3 bg-slate-950/60 rounded-xl border border-white/5">
      <div
        className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
          isExport ? 'bg-emerald-500' : 'bg-red-500'
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center gap-2">
          <span className="text-[9px] font-black text-slate-400 uppercase truncate">
            {flow.partner || 'World'}
          </span>
          <span
            className={`text-[10px] font-black shrink-0 ${
              isExport ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {flow.trade_value_usd != null
              ? fmtUsd(flow.trade_value_usd)
              : 'N/A'}
          </span>
        </div>
        <p className="text-[8px] text-slate-600 mt-0.5">
          {flow.net_weight_kg != null ? fmtKg(flow.net_weight_kg) : ''}
          {flow.year ? ` · ${flow.year}` : ''}
        </p>
      </div>
    </div>
  );
}

function EconCard({
  label,
  value,
  year,
  color,
}: {
  label: string;
  value: string;
  year: string;
  color: 'indigo' | 'cyan' | 'amber';
}) {
  const colorMap = {
    indigo: 'text-indigo-400',
    cyan: 'text-cyan-400',
    amber: 'text-amber-400',
  };
  return (
    <div className="flex flex-col gap-1.5 p-4 bg-slate-950/60 rounded-2xl border border-white/5">
      <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest leading-tight">
        {label}
      </span>
      <span className={`text-base font-black ${colorMap[color]}`}>{value}</span>
      <span className="text-[8px] text-slate-600">{year}</span>
    </div>
  );
}
