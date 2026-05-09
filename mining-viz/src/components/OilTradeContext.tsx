/**
 * OilTradeContext — Trade & Financial Context panel for a petroleum-producing country.
 *
 * Duplicates the pattern from TradeContext.tsx but targets petroleum HS codes:
 *   HS 2709  Petroleum oils, crude
 *   HS 2710  Petroleum oils, not crude (refined products)
 *   HS 2711  Petroleum gases (LNG, LPG, natural gas)
 *
 * Data sources (same backend endpoint, different commodity):
 *   • /api/company-intel?country={country}&commodity=crude+oil  → UN Comtrade HS 2709
 *   • World Bank indicators (GDP, FDI, energy intensity)
 *   • Deep links: IEA, EIA, OPEC, Platts, UN Comtrade
 *
 * Falls back gracefully when the backend key or endpoint is unavailable.
 */

import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { OilHsCategory } from '../types';
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
  RefreshCw as IconRefresh,
  Info as IconInfo,
  Droplets as IconDroplets,
  Flame as IconFlame,
  Wind as IconWind,
} from 'lucide-react';

// ─── Types (mirrors CompanyIntelResponse in TradeContext) ─────────────────────

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

interface OilIntelResponse {
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
  deep_links: { label: string; url: string; description: string; icon: string }[];
  comtrade_available: boolean;
  data_as_of: string;
  limitations: string[];
}

// ─── HS code metadata ─────────────────────────────────────────────────────────

const HS_CODES = [
  { code: '2709', label: 'Crude petroleum',         category: 'crude'   as OilHsCategory },
  { code: '2710', label: 'Refined petroleum',       category: 'refined' as OilHsCategory },
  { code: '2711', label: 'Petroleum gases (LNG/LPG)', category: 'gas'   as OilHsCategory },
  { code: '2712', label: 'Petroleum jelly / wax',   category: 'other'   as OilHsCategory },
];

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
  if (val >= 1e9)  return `${(val / 1e9).toFixed(2)} Mt`;
  if (val >= 1e6)  return `${(val / 1e6).toFixed(2)} kt`;
  if (val >= 1e3)  return `${(val / 1e3).toFixed(1)}kg×10³`;
  return `${val.toFixed(0)} kg`;
}

const commodityForCategory: Record<OilHsCategory, string> = {
  crude:   'crude oil',
  refined: 'petroleum products',
  gas:     'natural gas',
  other:   'petroleum',
};

// ─── Component ───────────────────────────────────────────────────────────────

interface OilTradeContextProps {
  country: string;
  category?: OilHsCategory;
}

export default function OilTradeContext({ country, category = 'crude' }: OilTradeContextProps) {
  const { t } = useI18n();
  const [data, setData] = useState<OilIntelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const API_BASE =
    (import.meta as any).env?.VITE_API_BASE ||
    `http://${window.location.hostname}:8000`;

  const commodity = commodityForCategory[category];

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        company: '',
        country,
        commodity,
      });
      const res = await window.fetch(`${API_BASE}/api/company-intel?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: OilIntelResponse = await res.json();
      setData(json);
      setFetched(true);
    } catch (e: any) {
      setError(e.message || 'Failed to load trade data');
    } finally {
      setLoading(false);
    }
  };

  // ─── HS-code chip row ───────────────────────────────────────────────────────

  const HsChips = () => (
    <div className="flex flex-wrap gap-2 mb-6">
      {HS_CODES.map(hs => (
        <div
          key={hs.code}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-widest ${
            hs.category === category
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              : 'bg-white/5 border-white/5 text-slate-500'
          }`}
        >
          {hs.category === 'gas' ? (
            <IconWind className="w-2.5 h-2.5" />
          ) : hs.category === 'refined' ? (
            <IconDroplets className="w-2.5 h-2.5" />
          ) : (
            <IconFlame className="w-2.5 h-2.5" />
          )}
          HS {hs.code} · {hs.label}
        </div>
      ))}
    </div>
  );

  // ─── Empty / prompt ─────────────────────────────────────────────────────────

  if (!fetched && !loading) {
    return (
      <div className="flex flex-col gap-4">
        <HsChips />
        <div className="flex flex-col items-center justify-center py-12 gap-6 bg-white/5 dark:bg-white/3 rounded-3xl border border-white/5">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <IconBarChart className="w-7 h-7 text-amber-400" />
          </div>
          <div className="text-center max-w-xs">
            <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest mb-2">
              {t('הקשר מסחרי – נפט', 'Oil Trade & Financial Context')}
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              {t(
                'טען נתוני יצוא/יבוא ומאקרו כלכלי לפי מדינה ממקורות פתוחים (UN Comtrade · World Bank).',
                `Load country-level export/import flows and macro-economic data for ${country} (UN Comtrade · World Bank).`
              )}
            </p>
          </div>
          <Button
            onClick={fetchData}
            className="h-11 px-7 bg-amber-600 hover:bg-amber-700 text-white font-black uppercase tracking-widest text-[10px]"
          >
            <IconBarChart className="w-3.5 h-3.5 mr-2" />
            {t('טען נתוני נפט', 'Load Petroleum Data')}
          </Button>
        </div>

        {/* Static deep links — available without fetching */}
        <OilDeepLinks country={country} t={t} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest animate-pulse">
          {t('טוען...', 'Fetching petroleum data...')}
        </span>
        <span className="text-[9px] text-slate-600 uppercase">
          UN Comtrade · World Bank · HS {category === 'gas' ? '2711' : category === 'refined' ? '2710' : '2709'}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <HsChips />
        <div className="flex flex-col items-center justify-center py-12 gap-4 bg-red-500/5 border border-red-500/10 rounded-3xl">
          <IconAlert className="w-8 h-8 text-red-400" />
          <p className="text-sm text-red-400 font-bold">{error}</p>
          <Button
            onClick={fetchData}
            variant="outline"
            className="border-white/10 text-slate-300 text-[10px] font-black uppercase"
          >
            <IconRefresh className="w-3.5 h-3.5 mr-2" /> {t('נסה שוב', 'Retry')}
          </Button>
        </div>
        <OilDeepLinks country={country} t={t} />
      </div>
    );
  }

  if (!data) return null;

  const flows = data.trade_flows?.flows || [];
  const exports = flows.filter(f => f.flow === 'Export');
  const imports = flows.filter(f => f.flow === 'Import');
  const ind = data.economy?.indicators || {};

  return (
    <div className="space-y-5">
      <HsChips />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[11px] font-black text-amber-400 uppercase tracking-widest mb-0.5">
            {t('הקשר מסחרי – נפט', 'Petroleum Trade Context')}
          </h3>
          <p className="text-[9px] text-slate-500 uppercase">
            {data.country} · {data.commodity}
            {data.hs_code ? ` · HS ${data.hs_code}` : ''} · {data.data_as_of}
          </p>
        </div>
        <Button
          onClick={fetchData}
          size="sm"
          variant="ghost"
          className="h-8 px-3 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-amber-400 border border-white/5"
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
                'הגדר COMTRADE_API_KEY בשרת לקבלת נתוני יצוא/יבוא.',
                'Set COMTRADE_API_KEY on the backend to enable export/import flow data (HS 2709/2710/2711).'
              )}
            </p>
          </div>
        </div>
      )}

      {/* Trade Flows */}
      {flows.length > 0 && (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <IconTrendingUp className="w-4 h-4 text-amber-400" />
            <h4 className="text-[11px] font-black text-amber-400 uppercase tracking-widest">
              {t('זרימות סחר לאומיות', 'National Trade Flows')}
            </h4>
            <Badge className="bg-amber-500/10 text-amber-400 border-none text-[8px] font-black ml-auto">
              {data.trade_flows.source}
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <IconTrendingUp className="w-3 h-3" /> {t('יצוא', 'Exports')} ({exports.length})
              </p>
              {exports.length === 0 ? (
                <p className="text-xs text-slate-600 italic">No export records found</p>
              ) : (
                <div className="space-y-2">
                  {exports.slice(0, 5).map((flow, i) => (
                    <OilFlowRow key={i} flow={flow} type="export" />
                  ))}
                </div>
              )}
            </div>
            {imports.length > 0 && (
              <div>
                <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <IconTrendingDown className="w-3 h-3" /> {t('יבוא', 'Imports')} ({imports.length})
                </p>
                <div className="space-y-2">
                  {imports.slice(0, 5).map((flow, i) => (
                    <OilFlowRow key={i} flow={flow} type="import" />
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="mt-4 text-[8px] text-slate-600 uppercase tracking-widest">
            Source: UN Comtrade · HS {data.hs_code} · Year {data.trade_flows.year} · Country-level only
          </p>
        </Card>
      )}

      {/* World Bank Economy */}
      {Object.keys(ind).length > 0 && (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <IconGlobe className="w-4 h-4 text-indigo-400" />
            <h4 className="text-[11px] font-black text-indigo-400 uppercase tracking-widest">
              {t('מאקרו כלכלי', 'Economic Context')} — {data.country}
            </h4>
            <Badge className="bg-indigo-500/10 text-indigo-400 border-none text-[8px] font-black ml-auto">
              World Bank
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {ind.gdp_usd && (
              <EconCard label={t('תוצר גולמי', 'GDP')} value={fmtUsd(ind.gdp_usd.value)} year={ind.gdp_usd.year} color="indigo" />
            )}
            {ind.gdp_per_capita_usd && (
              <EconCard label={t('GDP לנפש', 'GDP / capita')} value={fmtUsd(ind.gdp_per_capita_usd.value)} year={ind.gdp_per_capita_usd.year} color="indigo" />
            )}
            {ind.fdi_inflows_usd && (
              <EconCard label={t('FDI', 'FDI Inflows')} value={fmtUsd(ind.fdi_inflows_usd.value)} year={ind.fdi_inflows_usd.year} color="amber" />
            )}
            {ind.mining_share_of_gdp_pct && (
              <EconCard label={t('% אנרגיה מ-GDP', 'Energy % GDP')} value={`${ind.mining_share_of_gdp_pct.value.toFixed(1)}%`} year={ind.mining_share_of_gdp_pct.year} color="amber" />
            )}
          </div>
        </Card>
      )}

      {/* Deep Links */}
      <OilDeepLinks country={country} t={t} />

      {/* Limitations */}
      <div className="flex items-start gap-3 p-4 bg-slate-900/60 border border-white/5 rounded-2xl">
        <IconAlert className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">
            {t('מגבלות ידועות', 'Known Limitations')}
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

function OilFlowRow({ flow, type }: { flow: TradeFlow; type: 'export' | 'import' }) {
  const isExport = type === 'export';
  return (
    <div className="flex items-start gap-2 p-2.5 bg-slate-950/60 rounded-xl border border-white/5">
      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${isExport ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center gap-2">
          <span className="text-[9px] font-black text-slate-400 uppercase truncate">{flow.partner || 'World'}</span>
          <span className={`text-[10px] font-black shrink-0 ${isExport ? 'text-emerald-400' : 'text-red-400'}`}>
            {flow.trade_value_usd != null ? fmtUsd(flow.trade_value_usd) : 'N/A'}
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

function EconCard({ label, value, year, color }: { label: string; value: string; year: string; color: 'indigo' | 'amber' }) {
  const colorMap = { indigo: 'text-indigo-400', amber: 'text-amber-400' };
  return (
    <div className="flex flex-col gap-1.5 p-3 bg-slate-950/60 rounded-2xl border border-white/5">
      <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest leading-tight">{label}</span>
      <span className={`text-base font-black ${colorMap[color]}`}>{value}</span>
      <span className="text-[8px] text-slate-600">{year}</span>
    </div>
  );
}

function OilDeepLinks({ country, t }: { country: string; t: (he: string, en: string) => string }) {
  const enc = encodeURIComponent(country);
  const links = [
    {
      label: 'IEA',
      url: `https://www.iea.org/countries/${enc.toLowerCase()}`,
      description: `IEA country energy profile — ${country}`,
    },
    {
      label: 'EIA International',
      url: `https://www.eia.gov/international/data/country/${enc}`,
      description: 'U.S. EIA international energy statistics',
    },
    {
      label: 'OPEC',
      url: `https://www.opec.org/opec_web/en/data_graphs/40.htm`,
      description: 'OPEC production & reserves data',
    },
    {
      label: 'UN Comtrade HS 2709',
      url: `https://comtradeplus.un.org/TradeFlow?Frequency=A&Flows=X&CommodityCodes=2709&Partners=0&Reporters=${enc}&period=2023&AggregateBy=none&BreakdownMode=plus`,
      description: `Crude petroleum exports — ${country}`,
    },
    {
      label: 'UN Comtrade HS 2710',
      url: `https://comtradeplus.un.org/TradeFlow?Frequency=A&Flows=X&CommodityCodes=2710&Partners=0&Reporters=${enc}&period=2023&AggregateBy=none&BreakdownMode=plus`,
      description: `Refined petroleum exports — ${country}`,
    },
    {
      label: 'World Bank Energy',
      url: `https://data.worldbank.org/country/${enc}?view=chart`,
      description: 'World Bank energy & GDP indicators',
    },
  ];

  return (
    <Card className="bg-white/5 border-white/5 rounded-3xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <IconDroplets className="w-4 h-4 text-amber-400" />
        <h4 className="text-[11px] font-black text-amber-400 uppercase tracking-widest">
          {t('קישורי בדיקה ידנית', 'Manual Verification Links')}
        </h4>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {links.map((link, i) => (
          <a
            key={i}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-colors group"
          >
            <div className="flex flex-col gap-0.5 min-w-0 pr-2">
              <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">{link.label}</span>
              <span className="text-[10px] text-slate-400 leading-snug group-hover:text-slate-200 transition-colors truncate">
                {link.description}
              </span>
            </div>
            <IconExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-white shrink-0 transition-colors" />
          </a>
        ))}
      </div>
    </Card>
  );
}
