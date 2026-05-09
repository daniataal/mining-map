/**
 * OilMapView — World-level petroleum / oil-products intelligence view.
 *
 * Features:
 *  • Leaflet world map with CircleMarkers sized (log-scale) by country export value
 *  • Color-coded by HS category: crude (amber) · refined (blue) · gas (emerald)
 *  • HS-category filter bar (All / Crude / Refined / Gas)
 *  • Right side drawer: country detail + OilTradeContext deep-dive
 *  • Top-exporters table (collapsed by default, accessible via button)
 *  • Respects dark / light theme via next-themes
 *  • Data: useOilSummary() — falls back to built-in stub while /api/oil/summary is unimplemented
 */

import { useState, useMemo } from 'react';
import { useTheme } from 'next-themes';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  LayersControl,
  ZoomControl,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useOilSummary } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { OilTradeFlow, OilHsCategory } from '../types';
import OilTradeContext from './OilTradeContext';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import {
  Droplets as IconDroplets,
  X as IconX,
  TrendingUp as IconTrendingUp,
  TrendingDown as IconTrendingDown,
  BarChart2 as IconBarChart,
  AlertTriangle as IconAlert,
  ChevronDown as IconChevronDown,
  ChevronUp as IconChevronUp,
  Flame as IconFlame,
  Wind as IconWind,
  Layers as IconLayers,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const HS_CATEGORY_META: Record<OilHsCategory, { label: string; color: string; mapColor: string; bgClass: string; textClass: string; borderClass: string }> = {
  crude:   { label: 'Crude (HS 2709)',   color: '#f59e0b', mapColor: '#f59e0b', bgClass: 'bg-amber-500/10',   textClass: 'text-amber-400',   borderClass: 'border-amber-500/20'  },
  refined: { label: 'Refined (HS 2710)', color: '#3b82f6', mapColor: '#60a5fa', bgClass: 'bg-blue-500/10',    textClass: 'text-blue-400',    borderClass: 'border-blue-500/20'   },
  gas:     { label: 'Gas (HS 2711)',     color: '#10b981', mapColor: '#34d399', bgClass: 'bg-emerald-500/10', textClass: 'text-emerald-400', borderClass: 'border-emerald-500/20'},
  other:   { label: 'Other',            color: '#64748b', mapColor: '#94a3b8', bgClass: 'bg-slate-500/10',   textClass: 'text-slate-400',   borderClass: 'border-slate-500/20'  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtUsd(val: number | null | undefined): string {
  if (val == null) return 'N/A';
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

/** Log-scaled circle radius: 6–38 px across 4B–326B USD range. */
function scaleRadius(val: number | null): number {
  if (!val || val <= 0) return 6;
  const logMin = Math.log10(3);   // ~3B
  const logMax = Math.log10(326); // 326B
  const t = Math.max(0, Math.min(1, (Math.log10(val / 1e9) - logMin) / (logMax - logMin)));
  return 6 + t * 32;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryFilterBar({
  active,
  onChange,
  t,
}: {
  active: OilHsCategory | 'all';
  onChange: (v: OilHsCategory | 'all') => void;
  t: (he: string, en: string) => string;
}) {
  const options: { key: OilHsCategory | 'all'; label: string }[] = [
    { key: 'all',     label: t('הכל', 'All')           },
    { key: 'crude',   label: t('גולמי', 'Crude')        },
    { key: 'refined', label: t('מזוקק', 'Refined')      },
    { key: 'gas',     label: t('גז', 'Gas')             },
  ];
  return (
    <div className="flex gap-1 bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl border border-black/10 dark:border-white/10 rounded-2xl p-1 shadow-2xl">
      {options.map(opt => {
        const isActive = active === opt.key;
        const meta = opt.key !== 'all' ? HS_CATEGORY_META[opt.key] : null;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={isActive && meta ? { backgroundColor: meta.color + '22', color: meta.color, borderColor: meta.color + '44' } : {}}
            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
              isActive && !meta
                ? 'bg-amber-500 text-slate-950 border-amber-500'
                : isActive
                ? 'border'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 border-transparent'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function LegendPanel({ t }: { t: (he: string, en: string) => string }) {
  return (
    <div className="bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl border border-black/10 dark:border-white/10 rounded-2xl p-3 shadow-xl">
      <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-2">{t('מקרא', 'Legend')}</p>
      <div className="space-y-1.5">
        {(Object.entries(HS_CATEGORY_META) as [OilHsCategory, typeof HS_CATEGORY_META[OilHsCategory]][]).map(([key, meta]) => (
          <div key={key} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: meta.mapColor, opacity: 0.85 }} />
            <span className="text-[9px] text-slate-500 dark:text-slate-400">{meta.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-black/5 dark:border-white/5 space-y-1">
        <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">{t('גודל עיגול', 'Circle Size')}</p>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
          <span className="text-[9px] text-slate-500">{t('קטן = פחות', '< $10B exports')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-amber-400/60" />
          <span className="text-[9px] text-slate-500">{t('גדול = יותר', '> $100B exports')}</span>
        </div>
      </div>
    </div>
  );
}

function ExporterRow({ flow, rank }: { flow: OilTradeFlow; rank: number }) {
  const meta = HS_CATEGORY_META[flow.category] || HS_CATEGORY_META.other;
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 hover:bg-white/5 transition-colors rounded-xl group">
      <span className="text-[9px] font-black text-slate-600 w-5 shrink-0 text-right">{rank}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-black text-slate-200 truncate">{flow.country}</p>
        <p className={`text-[8px] ${meta.textClass} truncate`}>{flow.top_hs_description}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] font-black text-emerald-400">{fmtUsd(flow.export_value_usd)}</p>
        <p className="text-[8px] text-slate-600">{flow.year}</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface OilMapViewProps {
  onBack?: () => void;
}

export default function OilMapView({ onBack }: OilMapViewProps) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  const { data: summaryData, isLoading, error } = useOilSummary();

  const [hsFilter, setHsFilter] = useState<OilHsCategory | 'all'>('all');
  const [selectedCountry, setSelectedCountry] = useState<OilTradeFlow | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const flows = summaryData?.flows ?? [];

  const filteredFlows = useMemo(
    () => hsFilter === 'all' ? flows : flows.filter(f => f.category === hsFilter),
    [flows, hsFilter]
  );

  const sortedFlows = useMemo(
    () => [...filteredFlows].sort((a, b) => (b.export_value_usd ?? 0) - (a.export_value_usd ?? 0)),
    [filteredFlows]
  );

  const totalExport = useMemo(
    () => filteredFlows.reduce((s, f) => s + (f.export_value_usd ?? 0), 0),
    [filteredFlows]
  );

  const handleMarkerClick = (flow: OilTradeFlow) => {
    setSelectedCountry(flow);
    setIsDrawerOpen(true);
  };

  return (
    <div className="relative w-full h-full bg-slate-100 dark:bg-slate-900 overflow-hidden">

      {/* ── MAP ── */}
      <MapContainer
        center={[20, 15]}
        zoom={2}
        className="w-full h-full"
        zoomControl={false}
        minZoom={2}
        maxZoom={8}
      >
        <ZoomControl position="bottomleft" />

        <LayersControl key={resolvedTheme ?? 'dark'} position="bottomright">
          <LayersControl.BaseLayer checked={isDark} name={t('כהה', 'Dark')}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="© OpenStreetMap © CARTO" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer checked={!isDark} name={t('בהיר', 'Light')}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="© OpenStreetMap © CARTO" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name={t('לוויין', 'Satellite')}>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
          </LayersControl.BaseLayer>
        </LayersControl>

        {filteredFlows.map(flow => {
          const meta = HS_CATEGORY_META[flow.category] || HS_CATEGORY_META.other;
          const radius = scaleRadius(flow.export_value_usd);
          const isSelected = selectedCountry?.iso2 === flow.iso2;

          return (
            <CircleMarker
              key={flow.iso2}
              center={[flow.lat, flow.lng]}
              radius={isSelected ? radius + 6 : radius}
              pathOptions={{
                color: isSelected ? '#fff' : meta.mapColor,
                weight: isSelected ? 2 : 1,
                fillColor: meta.mapColor,
                fillOpacity: isSelected ? 0.9 : 0.65,
                opacity: isSelected ? 1 : 0.85,
              }}
              eventHandlers={{ click: () => handleMarkerClick(flow) }}
            >
              <Tooltip direction="top" offset={[0, -radius]} opacity={1} permanent={false}>
                <div style={{ background: isDark ? '#0f172a' : '#fff', border: `1px solid ${meta.mapColor}40`, borderRadius: 8, padding: '4px 8px' }}>
                  <p style={{ fontSize: 10, fontWeight: 900, color: meta.mapColor, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 1 }}>
                    {flow.country}
                  </p>
                  <p style={{ fontSize: 9, color: isDark ? '#94a3b8' : '#64748b' }}>
                    {t('יצוא', 'Export')}: {fmtUsd(flow.export_value_usd)} · {flow.year}
                  </p>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* ── TOP TOOLBAR ── */}
      <div className="absolute top-4 left-4 right-4 z-[1000] flex items-start justify-between gap-3 pointer-events-none">

        {/* Left: mode label + stats */}
        <div className="pointer-events-auto flex flex-col gap-2">
          <div className="flex items-center gap-2.5 bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl border border-black/10 dark:border-white/10 rounded-2xl px-4 py-2.5 shadow-2xl">
            <div className="w-7 h-7 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <IconDroplets className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">{t('מצב: נפט', 'Mode: Oil & Gas')}</p>
              <p className="text-[8px] text-slate-500">
                {filteredFlows.length} {t('מדינות', 'countries')} · {fmtUsd(totalExport)} {t('יצוא כולל', 'total exports')}
              </p>
            </div>
            {onBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="ml-2 h-7 px-2 text-[9px] font-black uppercase text-slate-400 hover:text-amber-400 border border-white/10"
              >
                {t('חזרה', 'Back')}
              </Button>
            )}
          </div>

          {/* Source / disclaimer badge */}
          {summaryData && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-950/70 dark:bg-slate-950/80 backdrop-blur-xl border border-white/5 rounded-xl shadow-lg">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              <span className="text-[8px] text-slate-500 uppercase tracking-widest">{summaryData.source}</span>
            </div>
          )}
        </div>

        {/* Right: HS filter + table toggle */}
        <div className="pointer-events-auto flex flex-col gap-2 items-end">
          <CategoryFilterBar active={hsFilter} onChange={setHsFilter} t={t} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTable(v => !v)}
            className="h-8 px-3 text-[9px] font-black uppercase tracking-widest bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl border border-black/10 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-amber-400 shadow-2xl rounded-2xl"
          >
            <IconBarChart className="w-3.5 h-3.5 mr-1.5" />
            {t('טבלת יצואנים', 'Exporters Table')}
            {showTable ? <IconChevronUp className="w-3 h-3 ml-1.5" /> : <IconChevronDown className="w-3 h-3 ml-1.5" />}
          </Button>
        </div>
      </div>

      {/* ── EXPORTERS TABLE (collapsible overlay) ── */}
      {showTable && (
        <div className="absolute top-[120px] right-4 z-[999] w-80 pointer-events-auto">
          <Card className="bg-white/90 dark:bg-slate-950/90 backdrop-blur-3xl border border-black/10 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-black/5 dark:border-white/5">
              <div className="flex items-center gap-2">
                <IconTrendingUp className="w-3.5 h-3.5 text-amber-500" />
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
                  {t('יצואנים מובילים', 'Top Exporters')}
                </h4>
                <Badge className="bg-amber-500/10 text-amber-500 border-none text-[8px] font-black">
                  {sortedFlows.length}
                </Badge>
              </div>
              <button
                onClick={() => setShowTable(false)}
                className="text-slate-500 hover:text-slate-200 transition-colors"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>
            <ScrollArea className="h-72">
              <div className="py-1">
                {sortedFlows.map((flow, i) => (
                  <button
                    key={flow.iso2}
                    className="w-full text-left"
                    onClick={() => { handleMarkerClick(flow); setShowTable(false); }}
                  >
                    <ExporterRow flow={flow} rank={i + 1} />
                  </button>
                ))}
              </div>
            </ScrollArea>
            <div className="px-4 py-3 border-t border-black/5 dark:border-white/5 flex items-center gap-2">
              <IconAlert className="w-3 h-3 text-slate-600 shrink-0" />
              <p className="text-[8px] text-slate-600 leading-snug">
                {t('נתוני מדינה בלבד · לא כולל חברות', 'Country-level only · Not company-specific')}
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* ── BOTTOM-LEFT LEGEND ── */}
      <div className="absolute bottom-20 left-4 z-[998] pointer-events-none">
        <LegendPanel t={t} />
      </div>

      {/* ── LOADING / ERROR STATES ── */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-[1001] bg-slate-900/60 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest animate-pulse">
              {t('טוען נתוני נפט...', 'Loading petroleum data...')}
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1001] bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-2 pointer-events-none">
          <span className="text-[10px] font-black text-red-400 uppercase">{t('שגיאה בטעינה', 'Load error — using stub data')}</span>
        </div>
      )}

      {/* ── RIGHT SIDE DRAWER ── */}
      <div
        className={`absolute top-0 right-0 bottom-0 z-[1000] transition-all duration-500 ease-[0.23,1,0.32,1] ${
          isDrawerOpen ? 'w-full sm:w-[420px]' : 'w-0'
        } overflow-hidden pointer-events-none`}
      >
        <div className="h-full bg-white/95 dark:bg-slate-950/95 backdrop-blur-3xl border-l border-black/10 dark:border-white/10 shadow-2xl flex flex-col pointer-events-auto">
          {/* Drawer header */}
          {selectedCountry && (
            <>
              <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: (HS_CATEGORY_META[selectedCountry.category]?.mapColor ?? '#64748b') + '22' }}
                  >
                    {selectedCountry.category === 'gas' ? (
                      <IconWind className="w-4 h-4" style={{ color: HS_CATEGORY_META[selectedCountry.category]?.mapColor }} />
                    ) : selectedCountry.category === 'refined' ? (
                      <IconLayers className="w-4 h-4" style={{ color: HS_CATEGORY_META[selectedCountry.category]?.mapColor }} />
                    ) : (
                      <IconFlame className="w-4 h-4" style={{ color: HS_CATEGORY_META[selectedCountry.category]?.mapColor }} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[11px] font-black text-slate-900 dark:text-white uppercase tracking-widest truncate">
                      {selectedCountry.country}
                    </h3>
                    <p className="text-[9px] text-slate-500 uppercase">
                      HS {selectedCountry.top_hs_code} · {selectedCountry.top_hs_description}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setIsDrawerOpen(false); setSelectedCountry(null); }}
                  className="text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0 ml-2"
                >
                  <IconX className="w-5 h-5" />
                </button>
              </div>

              {/* KPI row */}
              <div className="grid grid-cols-2 gap-3 px-5 py-4 border-b border-black/5 dark:border-white/5 shrink-0">
                <div className="flex flex-col gap-1 p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                  <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                    <IconTrendingUp className="w-2.5 h-2.5" /> {t('יצוא', 'Exports')}
                  </span>
                  <span className="text-base font-black text-emerald-400">
                    {fmtUsd(selectedCountry.export_value_usd)}
                  </span>
                  <span className="text-[8px] text-slate-500">{selectedCountry.year}</span>
                </div>
                <div className="flex flex-col gap-1 p-3 bg-red-500/5 border border-red-500/10 rounded-2xl">
                  <span className="text-[8px] font-black text-red-400 uppercase tracking-widest flex items-center gap-1">
                    <IconTrendingDown className="w-2.5 h-2.5" /> {t('יבוא', 'Imports')}
                  </span>
                  <span className="text-base font-black text-red-400">
                    {fmtUsd(selectedCountry.import_value_usd)}
                  </span>
                  <span className="text-[8px] text-slate-500">{selectedCountry.year}</span>
                </div>
              </div>

              {/* Category badge + rank */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-black/5 dark:border-white/5 shrink-0">
                <Badge
                  className="text-[9px] font-black uppercase"
                  style={{
                    backgroundColor: (HS_CATEGORY_META[selectedCountry.category]?.mapColor ?? '#64748b') + '22',
                    color: HS_CATEGORY_META[selectedCountry.category]?.mapColor,
                    border: 'none',
                  }}
                >
                  {HS_CATEGORY_META[selectedCountry.category]?.label}
                </Badge>
                {selectedCountry.rank && (
                  <span className="text-[9px] text-slate-500 uppercase font-black tracking-widest">
                    {t('דירוג', 'Rank')} #{selectedCountry.rank} {t('ביצואנים', 'global exporter')}
                  </span>
                )}
              </div>

              {/* OilTradeContext deep-dive */}
              <ScrollArea className="flex-1">
                <div className="px-5 py-5">
                  <OilTradeContext country={selectedCountry.country} category={selectedCountry.category} />
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
