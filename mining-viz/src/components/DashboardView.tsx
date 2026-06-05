import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation, MarketTickerRow } from '../types';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import {
  BarChart3,
  Globe,
  Layers,
  Zap,
  TrendingUp,
  Anchor,
  Box,
  Upload,
} from 'lucide-react';
import { Button } from './ui/button';
import { motion } from 'framer-motion';
import { BRAND_NAME } from '../lib/brand';

interface DashboardViewProps {
  licenses: MiningLicense[];
  marketPrices: MarketTickerRow[];
  annotations: Record<string, UserAnnotation>;
  onOpenBulkImport?: () => void;
}

export default function DashboardView({
  licenses,
  marketPrices,
  annotations,
  onOpenBulkImport,
}: DashboardViewProps) {
  const { t } = useI18n();

  // 1. Core Analytics
  const totalLicenses = licenses.length;
  const commodityCounts = licenses.reduce((acc: Record<string, number>, l) => {
    const c = l.commodity || 'Other';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});

  const regionCounts = licenses.reduce((acc: Record<string, number>, l) => {
    const r = l.region || 'Unknown';
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});

  // 2. Precious metals — always surface on dashboard even if /spot failed (ticker omits them)
  const goldEntry = marketPrices.find((p) => /GOLD/i.test(p.symbol));
  const silverEntry = marketPrices.find((p) => /SILVER/i.test(p.symbol));
  const parsePx = (s?: string) => parseFloat((s || '').replace(/[$,]/g, '').replace(/—/g, '')) || 0;
  const activeGoldPrice = parsePx(goldEntry?.price);
  const activeSilverPrice = parsePx(silverEntry?.price);
  const metalsForTicker = [
    goldEntry ?? { symbol: 'GOLD/oz', price: '$—', category: 'Metal' },
    silverEntry ?? { symbol: 'SILVER/oz', price: '$—', category: 'Metal' },
  ];
  const tickerWithoutDupMetals = marketPrices.filter(
    (p) => !/GOLD/i.test(p.symbol) && !/SILVER/i.test(p.symbol)
  );
  const displayPrices = [...metalsForTicker, ...tickerWithoutDupMetals];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-8 space-y-8 no-scrollbar">
      {/* Header Intelligence */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white uppercase italic tracking-tighter">
            {t("לוח בקרה טקטי", "Tactical Command Center")}
          </h1>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1">
            {BRAND_NAME} • System Status: Online
          </p>
        </div>
        <div className="flex gap-2 sm:gap-4 items-center flex-wrap justify-end">
          {onOpenBulkImport && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenBulkImport}
              className="h-9 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 font-black uppercase text-[9px] tracking-widest gap-2"
            >
              <Upload className="w-3.5 h-3.5" />
              {t('ייבוא CSV', 'Bulk CSV')}
            </Button>
          )}
          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 px-4 py-1.5 font-black uppercase text-[10px]">
            {t("פעיל", "Live Stream")}
          </Badge>
          <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400">
            <Zap className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
        <KPICard 
          icon={<Layers className="w-5 h-5 text-blue-500" />}
          label={t("סה\"כ רשיונות", "Total Licenses")}
          value={totalLicenses.toLocaleString()}
          subValue={t("פעיל גלובלי", "Active Globally")}
        />
        <KPICard 
          icon={<BarChart3 className="w-5 h-5 text-amber-500" />}
          label={t("סחורות תחת פיקוח", "Commodities Monitored")}
          value={Object.keys(commodityCounts).length.toString()}
          subValue={t("סוגי מחצבים", "Unique Minerals")}
        />
        <KPICard 
          icon={<Globe className="w-5 h-5 text-indigo-500" />}
          label={t("אזורי שליטה", "Strategic Regions")}
          value={Object.keys(regionCounts).length.toString()}
          subValue={t("פריסה טקטית", "Tactical Spread")}
        />
        <KPICard 
          icon={<TrendingUp className="w-5 h-5 text-amber-400" />}
          label={t("מחיר זהב", "Gold Spot")}
          value={
            activeGoldPrice > 0
              ? goldEntry?.price?.trim() || `$${activeGoldPrice.toLocaleString()}`
              : '$—'
          }
          subValue={t("מחיר אונקיה", "Per Troy Oz · indicative")}
          trend={activeGoldPrice > 0 && goldEntry?.change && goldEntry.change !== '—' ? goldEntry.change : undefined}
        />
        <KPICard 
          icon={<TrendingUp className="w-5 h-5 text-slate-300" />}
          label={t("מחיר כסף", "Silver Spot")}
          value={
            activeSilverPrice > 0
              ? silverEntry?.price?.trim() || `$${activeSilverPrice.toFixed(2)}`
              : '$—'
          }
          subValue={t("מחיר אונקיה", "Per Troy Oz · indicative")}
          trend={activeSilverPrice > 0 && silverEntry?.change && silverEntry.change !== '—' ? silverEntry.change : undefined}
        />
      </div>

      {/* Main Analysis Grid */}
      <div className="grid grid-cols-12 gap-8">
        
        {/* Commodity Distribution (Bar Chart Concept) */}
        <Card className="col-span-12 lg:col-span-7 bg-white/5 border-white/5 p-8 rounded-3xl">
          <h3 className="text-sm font-black text-white uppercase tracking-widest mb-8 flex items-center gap-3">
             <Box className="w-4 h-4 text-amber-500" /> {t("התפלגות סחורות", "Commodity Concentration")}
          </h3>
          <div className="space-y-6">
            {Object.entries(commodityCounts).sort((a,b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => {
              const percentage = (count / totalLicenses) * 100;
              return (
                <div key={name} className="space-y-2">
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{name}</span>
                    <span className="text-xs font-black text-white">{count} Units</span>
                  </div>
                  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      className={`h-full rounded-full ${name.toLowerCase().includes('gold') ? 'bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.5)]' : 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]'}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Global Macro Ticker (Expanded) */}
        <Card className="col-span-12 lg:col-span-5 bg-white/5 border-white/5 p-8 rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Anchor className="w-32 h-32 text-white" />
          </div>
          <h3 className="text-sm font-black text-white uppercase tracking-widest mb-8 flex items-center gap-3">
             <Zap className="w-4 h-4 text-emerald-500" /> {t("מרכז סחורות גלובלי", "Global Macro Ticker")}
          </h3>
          <div className="grid grid-cols-1 gap-4">
             {displayPrices.map((price, i) => (
               <div key={`${price.symbol}-${i}`} className="flex items-center justify-between p-4 bg-slate-950/50 rounded-2xl border border-white/5 hover:border-white/20 transition-all group">
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em]">{price.category || 'Commodity'}</span>
                    <span className="text-xs font-black text-white group-hover:text-amber-500 transition-colors uppercase italic">{price.symbol}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-white">{price.price}</div>
                    <div className={`text-[8px] font-bold ${price.price === '$—' ? 'text-slate-500' : price.up === false ? 'text-red-500' : 'text-emerald-500'}`}>
                      {price.price === '$—' ? t('אין זרם', 'No feed') : price.up === false ? '▼ TREND' : '▲ LIVE'}
                    </div>
                  </div>
               </div>
             ))}
          </div>
        </Card>

      </div>
    </div>
  );
}

function KPICard({ icon, label, value, subValue, trend }: { icon: any, label: string, value: string, subValue: string, trend?: string }) {
  return (
    <Card className="bg-white/5 border-white/5 p-6 rounded-3xl relative overflow-hidden group hover:bg-white/10 transition-all duration-500">
      <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2.5 bg-slate-950 rounded-xl border border-white/5 shadow-inner">
            {icon}
          </div>
          {trend && (
            <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black h-5">
              {trend}
            </Badge>
          )}
        </div>
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black text-white tracking-tighter">{value}</span>
        </div>
        <span className="text-[9px] font-bold text-slate-600 uppercase italic">{subValue}</span>
      </div>
    </Card>
  );
}
