import { AlertTriangle, CheckCircle2, Loader2, Navigation, Crosshair, MapPin, ChevronRight, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '../../components/ui/select';
import type { DueDiligenceStatus } from './types';
import { PRODUCT_OPTIONS, SHIPPING_OPTIONS, type RoutePlannerHook } from './useRoutePlanner';

function fmtUsd(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function DdBadge({ status }: { status: DueDiligenceStatus }) {
  if (status === 'pass') return <span className="text-emerald-500 font-black text-[9px] uppercase">✓ Pass</span>;
  if (status === 'warn') return <span className="text-amber-500 font-black text-[9px] uppercase">⚠ Warn</span>;
  return <span className="text-red-500 font-black text-[9px] uppercase">✗ Fail</span>;
}

function FindingList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-2xl bg-white/60 p-3 dark:bg-slate-950/40">
      <p className="mb-2 text-[9px] font-black uppercase tracking-widest opacity-70">{title}</p>
      {items.length === 0 ? (
        <p className="text-[10px] opacity-75">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 4).map((item, index) => (
            <li key={`${item}-${index}`} className="leading-snug">{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface LocationPreset {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country?: string;
  licenseId?: string;
  commodity?: string;
  sector?: string;
  group: 'licenses' | 'suppliers' | 'buyers' | 'ports';
}

interface RoutePlannerPanelProps {
  rp: RoutePlannerHook;
  allLicenses?: any[];
}

const WORLD_PORTS: LocationPreset[] = [
  { id: 'p-rotterdam', name: 'Rotterdam, Netherlands', lat: 51.924, lng: 4.477, country: 'Netherlands', group: 'ports' },
  { id: 'p-antwerp', name: 'Antwerp, Belgium', lat: 51.219, lng: 4.402, country: 'Belgium', group: 'ports' },
  { id: 'p-hamburg', name: 'Hamburg, Germany', lat: 53.545, lng: 9.970, country: 'Germany', group: 'ports' },
  { id: 'p-shanghai', name: 'Shanghai, China', lat: 31.230, lng: 121.473, country: 'China', group: 'ports' },
  { id: 'p-singapore', name: 'Singapore', lat: 1.352, lng: 103.819, country: 'Singapore', group: 'ports' },
  { id: 'p-houston', name: 'Houston, USA', lat: 29.735, lng: -95.275, country: 'United States', group: 'ports' },
  { id: 'p-dubai', name: 'Jebel Ali, UAE', lat: 24.996, lng: 55.060, country: 'United Arab Emirates', group: 'ports' },
  { id: 'p-mumbai', name: 'Mumbai (JNPT), India', lat: 18.944, lng: 72.954, country: 'India', group: 'ports' },
  { id: 'p-busan', name: 'Busan, South Korea', lat: 35.115, lng: 129.071, country: 'South Korea', group: 'ports' },
  { id: 'p-losangeles', name: 'Los Angeles, USA', lat: 33.729, lng: -118.269, country: 'United States', group: 'ports' },
  { id: 'p-valcambi', name: 'Valcambi Refinery, Switzerland', lat: 46.024, lng: 8.951, country: 'Switzerland', group: 'buyers' },
  { id: 'p-rand', name: 'Rand Refinery, South Africa', lat: -26.248, lng: 28.163, country: 'South Africa', group: 'buyers' },
  { id: 'p-tesla', name: 'Tesla Gigafactory Nevada, USA', lat: 39.539, lng: -119.231, country: 'United States', group: 'buyers' },
  { id: 'p-bp', name: 'BP Trading Hub, London', lat: 51.507, lng: -0.127, country: 'United Kingdom', group: 'buyers' },
];

export default function RoutePlannerPanel({ rp, allLicenses }: RoutePlannerPanelProps) {
  const { t } = useI18n();
  const {
    supplier, setSupplier, buyer, setBuyer,
    productType, setProductType,
    quantityTons, setQuantityTons,
    incoterm, setIncoterm,
    shippingMethods, toggleShippingMethod,
    pickRole, beginPick, cancelPick,
    result, loading, error, computeRoute,
    hasResult,
    routeOptions, selectedPlanId, activePlan, selectRoutePlan,
  } = rp;

  const [step, setStep] = useState<'setup' | 'results'>('setup');

  // Auto-jump to results when we have them
  useEffect(() => { if (hasResult) setStep('results'); }, [hasResult]);

  const licensePresets: LocationPreset[] = useMemo(() => {
    if (!allLicenses?.length) return [];
    return allLicenses
      .filter(l => l.lat != null && l.lng != null)
      .slice(0, 150)
      .map(l => ({
        id: `lic-${l.id}`,
        name: `${l.company || 'Unknown'} — ${l.region || l.country || ''}`,
        lat: l.lat,
        lng: l.lng,
        country: l.country,
        licenseId: l.id,
        commodity: l.commodity,
        sector: l.sector,
        group: 'licenses' as const,
      }));
  }, [allLicenses]);

  const displayBreakdown = activePlan?.breakdown ?? result?.breakdown ?? [];
  const totalUsd = useMemo(
    () => displayBreakdown.reduce((s, r) => s + r.amountUsd, 0),
    [displayBreakdown],
  );
  const freightPctLabel =
    typeof result?.freightToValuePct === 'number' && Number.isFinite(result.freightToValuePct)
      ? `${result.freightToValuePct < 0.01 ? '<0.01' : result.freightToValuePct.toFixed(2)}%`
      : null;

  const supplierPresetId = useMemo(() => {
    const m = licensePresets.find(p => Math.abs(p.lat - supplier.lat) < 1e-4 && Math.abs(p.lng - supplier.lng) < 1e-4);
    return m ? m.id : 'custom';
  }, [licensePresets, supplier.lat, supplier.lng]);

  const buyerPresetId = useMemo(() => {
    const m = WORLD_PORTS.find(p => Math.abs(p.lat - buyer.lat) < 1e-4 && Math.abs(p.lng - buyer.lng) < 1e-4);
    return m ? m.id : 'custom';
  }, [buyer.lat, buyer.lng]);

  const selectedProduct = PRODUCT_OPTIONS.find(p => p.value === productType);
  const recommendation = result?.dueDiligenceRecommendation ?? 'escalate';
  const canProceed = result?.source === 'live' && recommendation === 'approve' && result.blockers.length === 0;
  const sourceTone =
    result?.source === 'live'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  const recommendationTone =
    recommendation === 'approve'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
      : recommendation === 'block'
        ? 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20'
        : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20';

  async function handleCompute() {
    await computeRoute();
    setStep('results');
  }

  const isReady = supplier.lat !== 0 && buyer.lat !== 0 && shippingMethods.length > 0 && quantityTons > 0;

  return (
    <Card className="h-full w-full overflow-hidden rounded-2xl border border-black/10 bg-white/97 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/97 flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 border-b border-black/5 dark:border-white/10 shrink-0">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1">
              {t('מתכנן מסלול', 'Route Intelligence')}
            </p>
            <h3 className="text-base font-bold leading-snug text-slate-900 dark:text-white">
              {supplier.label
                ? `${supplier.label} → ${buyer.label || t('בחר יעד', 'Select destination')}`
                : t('בנה מסלול מהספק לקונה', 'Build a supplier → buyer trade route')}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {pickRole && (
              <Badge className="bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-none text-[9px] font-black uppercase animate-pulse">
                {pickRole === 'supplier' ? t('לחץ על המפה: ספק', 'Click map: supplier') : t('לחץ על המפה: יעד', 'Click map: destination')}
              </Badge>
            )}
            {pickRole && (
              <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl text-[9px]" onClick={cancelPick}>
                {t('בטל', 'Cancel')}
              </Button>
            )}
            <div className="flex rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
              <button
                className={`px-4 py-2 text-[9px] font-black uppercase tracking-widest transition-colors ${step === 'setup' ? 'bg-amber-500 text-slate-950' : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'}`}
                onClick={() => setStep('setup')}
              >
                {t('הגדרה', '1 Setup')}
              </button>
              <button
                className={`px-4 py-2 text-[9px] font-black uppercase tracking-widest transition-colors ${step === 'results' ? 'bg-amber-500 text-slate-950' : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'} ${!hasResult ? 'opacity-40 cursor-not-allowed' : ''}`}
                onClick={() => hasResult && setStep('results')}
              >
                {t('תוצאות', '2 Results')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {step === 'setup' ? (
          <div className="p-4 space-y-4">
            {pickRole && (
              <div className="rounded-2xl border border-cyan-500/35 bg-cyan-500/[0.08] px-4 py-3 text-[11px] text-cyan-900 dark:text-cyan-100 font-semibold">
                📍 {t('לחצו על כל נקודה במפה להגדרת המיקום. הבחירה נסגרת אחרי קליק.', 'Tap anywhere on the map to place this point. Closes after one click.')}
              </div>
            )}
            {error && (
              <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-[11px] font-bold text-red-800 dark:text-red-200">{error}</div>
            )}

            <div className="grid grid-cols-1 gap-4">
              {/* Supplier block */}
              <div className={`rounded-2xl border p-4 transition-all ${pickRole === 'supplier' ? 'border-amber-500/60 bg-amber-500/[0.06]' : 'border-black/10 dark:border-white/10'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">📦 {t('ספק / מוצא', 'Supplier / origin')}</p>
                    {supplier.label && <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate max-w-[200px]">{supplier.label}</p>}
                    {!supplier.label && <p className="text-xs text-slate-400 mt-1">{t('לא נבחר', 'Not selected')}</p>}
                  </div>
                  <Button type="button" size="sm" variant={pickRole === 'supplier' ? 'default' : 'outline'}
                    className="h-8 rounded-xl text-[8px] font-black uppercase"
                    onClick={() => beginPick('supplier')}>
                    <Crosshair className="w-3 h-3 mr-1" />
                    {t('מהמפה', 'From map')}
                  </Button>
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">{t('בחר מהנכסים שלך', 'Select from your assets')}</p>
                <Select value={supplierPresetId} onValueChange={(val) => {
                  if (val === 'custom') return;
                  const found = licensePresets.find(p => p.id === val);
                  if (found) setSupplier({
                    lat: found.lat,
                    lng: found.lng,
                    label: found.name,
                    country: found.country,
                    licenseId: found.licenseId,
                    commodity: found.commodity,
                    sector: found.sector,
                  });
                }}>
                  <SelectTrigger className="h-9 rounded-xl text-xs font-semibold border-black/10 dark:border-white/10">
                    <SelectValue placeholder={t('בחר נכס ממפת ה-AI שלך...', 'Choose an asset from your AI map...')} />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="custom">{t('מיקום חופשי / מהמפה', 'Free pick / from map')}</SelectItem>
                    {licensePresets.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[9px] font-black text-purple-500 uppercase tracking-wider">
                          🏭 {t('הנכסים והזיכיונות שלך', 'Your Concessions & Assets')}
                        </SelectLabel>
                        {licensePresets.map(p => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                <p className="mt-2 text-[9px] text-slate-400 font-bold">
                  📍 {supplier.lat.toFixed(4)}, {supplier.lng.toFixed(4)}
                </p>
              </div>

              {/* Buyer / destination block */}
              <div className={`rounded-2xl border p-4 transition-all ${pickRole === 'buyer' ? 'border-blue-500/60 bg-blue-500/[0.06]' : 'border-black/10 dark:border-white/10'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">🎯 {t('קונה / יעד', 'Buyer / destination')}</p>
                    {buyer.label && <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate max-w-[200px]">{buyer.label}</p>}
                    {!buyer.label && <p className="text-xs text-slate-400 mt-1">{t('לא נבחר', 'Not selected')}</p>}
                  </div>
                  <Button type="button" size="sm" variant={pickRole === 'buyer' ? 'default' : 'outline'}
                    className="h-8 rounded-xl text-[8px] font-black uppercase"
                    onClick={() => beginPick('buyer')}>
                    <Crosshair className="w-3 h-3 mr-1" />
                    {t('מהמפה', 'From map')}
                  </Button>
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">{t('בחר קונה או נמל', 'Select buyer or destination port')}</p>
                <Select value={buyerPresetId} onValueChange={(val) => {
                  if (val === 'custom') return;
                  const found = WORLD_PORTS.find(p => p.id === val);
                  if (found) setBuyer({ lat: found.lat, lng: found.lng, label: found.name, country: found.country });
                }}>
                  <SelectTrigger className="h-9 rounded-xl text-xs font-semibold border-black/10 dark:border-white/10">
                    <SelectValue placeholder={t('בחר נמל, מזקקה, או לקוח...', 'Select port, refinery, or buyer...')} />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="custom">{t('מיקום חופשי / מהמפה', 'Free pick / from map')}</SelectItem>
                    <SelectGroup>
                      <SelectLabel className="text-[9px] font-black text-blue-500 uppercase tracking-wider">🌊 {t('נמלים גלובליים', 'Global Trade Ports')}</SelectLabel>
                      {WORLD_PORTS.filter(p => p.group === 'ports').map(p => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel className="text-[9px] font-black text-emerald-500 uppercase tracking-wider">🏭 {t('קונים ומזקקות', 'Refineries & Buyers')}</SelectLabel>
                      {WORLD_PORTS.filter(p => p.group === 'buyers').map(p => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="mt-2 text-[9px] text-slate-400 font-bold">
                  📍 {buyer.lat.toFixed(4)}, {buyer.lng.toFixed(4)}
                </p>
              </div>
            </div>

            {/* Product + Shipping */}
            <div className="grid grid-cols-1 gap-4">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">{t('סוג מוצר', 'Product / commodity')}</p>
                <Select value={productType} onValueChange={setProductType}>
                  <SelectTrigger className="h-10 rounded-xl border-black/10 dark:border-white/10 font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_OPTIONS.map(p => (
                      <SelectItem key={p.value} value={p.value} className="text-xs">
                        {p.icon} {t(p.labelHe, p.labelEn)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProduct && (
                  <p className="mt-2 text-[10px] text-amber-500 font-bold">{selectedProduct.icon} {t(selectedProduct.labelHe, selectedProduct.labelEn)}</p>
                )}
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">{t('שיטות הובלה', 'Shipping methods')}</p>
                <div className="space-y-2">
                  {SHIPPING_OPTIONS.map(opt => {
                    const checked = shippingMethods.includes(opt.id);
                    return (
                      <label key={opt.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${checked ? 'border-amber-500/55 bg-amber-500/[0.06]' : 'border-black/10 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'}`}>
                        <Checkbox checked={checked} onCheckedChange={(v) => toggleShippingMethod(opt.id, Boolean(v))} />
                        <div className="min-w-0">
                          <span className="text-[11px] font-bold text-slate-900 dark:text-white">{opt.icon} {t(opt.labelHe, opt.labelEn)}</span>
                          <p className="text-[9px] text-slate-500 leading-tight">{opt.descEn}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 rounded-2xl border border-black/10 p-4 dark:border-white/10 sm:grid-cols-2">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">{t('כמות', 'Quantity')}</p>
                <Input
                  type="number"
                  min={0}
                  value={quantityTons}
                  onChange={(e) => setQuantityTons(Number(e.target.value))}
                  className="h-10 rounded-xl border-black/10 dark:border-white/10 font-semibold"
                />
                <p className="mt-2 text-[9px] text-slate-500">{t('בטונות מטריות', 'Metric tonnes')}</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">{t('אינקוטרם', 'Incoterm')}</p>
                <Select value={incoterm} onValueChange={setIncoterm}>
                  <SelectTrigger className="h-10 rounded-xl border-black/10 dark:border-white/10 font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'].map((term) => (
                      <SelectItem key={term} value={term} className="text-xs">{term}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-2 text-[9px] text-slate-500">{t('משפיע על נקודות אחריות ועלויות', 'Used for responsibility and cost context')}</p>
              </div>
            </div>

            <Button
              className="w-full h-12 rounded-xl text-[11px] font-black uppercase tracking-widest bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20"
              onClick={handleCompute}
              disabled={loading || !isReady}
            >
              {loading ? (
                <><Loader2 className="inline h-4 w-4 animate-spin mr-2" />{t('מחשב מסלול ועלויות...', 'Calculating route & costs...')}</>
              ) : (
                <><Navigation className="inline h-4 w-4 mr-2" />{t('חשב מסלול מלא', 'Calculate Full Route & Costs')}<ChevronRight className="inline h-4 w-4 ml-2" /></>
              )}
            </Button>
          </div>
        ) : (
          /* Results Tab */
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{t('סיכום מסלול', 'Route summary')}</p>
                <p className="text-2xl font-black text-amber-500">{fmtUsd(totalUsd)}</p>
                <p className="text-xs text-slate-500">{t(`עלות כוללת משוערת (${quantityTons.toLocaleString()} טונה)`, `Estimated total cost (${quantityTons.toLocaleString()} MT)`)}</p>
                {result?.cargoValueUsd != null && (
                  <div className="mt-3 rounded-2xl border border-black/10 bg-black/[0.02] px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/[0.03]">
                    <p className="font-black uppercase tracking-widest text-slate-500">{t('שווי מטען משוער', 'Estimated cargo value')}</p>
                    <p className="mt-1 text-sm font-black text-slate-900 dark:text-white">
                      {fmtUsd(result.cargoValueUsd)}
                      {freightPctLabel && (
                        <span className="ml-2 text-[10px] font-bold text-slate-500">
                          {t(`${freightPctLabel} הובלה/שווי`, `${freightPctLabel} freight/value`)}
                        </span>
                      )}
                    </p>
                    {result.cargoValueNote && (
                      <p className="mt-1 leading-snug text-slate-500">{result.cargoValueNote}</p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                {result && (
                  <Badge className={`${sourceTone} border-none text-[9px] font-black uppercase`}>
                    {result.source === 'live' ? t('חי', 'Live') : t('סימולציה', 'Simulation')}
                  </Badge>
                )}
                <Badge className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-none text-[9px] font-black uppercase">
                  {supplier.label ? supplier.label.slice(0, 30) : 'Supplier'} → {buyer.label ? buyer.label.slice(0, 25) : 'Destination'}
                </Badge>
                <Badge className="bg-blue-500/15 text-blue-800 dark:text-blue-300 border-none text-[9px] font-black">
                  {selectedProduct?.icon} {selectedProduct ? t(selectedProduct.labelHe, selectedProduct.labelEn) : productType}
                </Badge>
              </div>
            </div>

            {result?.source === 'simulation' && (
              <div className="flex gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-amber-900 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest">{t('סימולציה בלבד', 'Simulation only')}</p>
                  <p className="mt-1 text-[11px] font-semibold leading-relaxed">
                    {t(
                      'המסלול או בדיקת הנאותות החיה לא זמינים כרגע. אין להשתמש בתוצאה לביצוע עסקה בלי הרצה חיה.',
                      'Live routing or due diligence is unavailable. Do not use this result to execute a deal until a live run succeeds.'
                    )}
                  </p>
                </div>
              </div>
            )}

            {result && (
              <div className={`rounded-3xl border px-5 py-4 ${recommendationTone}`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {recommendation === 'approve' ? <CheckCircle2 className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest">{t('המלצת ביצוע', 'Execution recommendation')}</p>
                      <p className="text-lg font-black uppercase">{recommendation}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    disabled={!canProceed}
                    className="h-10 rounded-xl bg-emerald-500 px-5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {t('אפשר להמשיך', 'Proceed')}
                  </Button>
                </div>
                {(result.blockers.length > 0 || result.warnings.length > 0 || result.limitations.length > 0) && (
                  <div className="mt-4 grid grid-cols-1 gap-3 text-[11px] font-semibold lg:grid-cols-3">
                    <FindingList title={t('חסמים', 'Blockers')} items={result.blockers} empty={t('אין חסמים', 'No blockers')} />
                    <FindingList title={t('אזהרות', 'Warnings')} items={result.warnings} empty={t('אין אזהרות', 'No warnings')} />
                    <FindingList title={t('מגבלות', 'Limitations')} items={result.limitations} empty={t('אין מגבלות', 'No limitations')} />
                  </div>
                )}
              </div>
            )}

            {result?.landlockedHint && (
              <div className="rounded-2xl border border-violet-500/25 bg-violet-500/10 px-4 py-3 text-[11px] font-semibold text-violet-950 dark:text-violet-100">
                <p className="mb-1 text-[9px] font-black uppercase tracking-widest opacity-75">
                  {t('מוצא יבשתי / ללא ים', 'Inland / landlocked origin')}
                </p>
                <p className="leading-snug">{result.landlockedHint}</p>
              </div>
            )}

            {routeOptions.length > 1 && (
              <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                  {t('השוואת מסלולים', 'Compare route plans')}
                </p>
                <div className="flex flex-col gap-2">
                  {routeOptions.map((plan) => {
                    const selected = plan.id === selectedPlanId;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => selectRoutePlan(plan.id)}
                        className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          selected
                            ? 'border-amber-500/60 bg-amber-500/[0.08]'
                            : 'border-black/10 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                            {plan.isRecommended
                              ? t('מומלץ', 'Recommended')
                              : t(plan.labelHe ?? `חלופה: ${plan.labelEn}`, plan.labelEn ?? plan.label)}
                          </p>
                          {!plan.isRecommended && (
                            <p className="text-[9px] text-slate-500 truncate">{plan.labelEn ?? plan.label}</p>
                          )}
                        </div>
                        <span className="text-xs font-black text-amber-600 dark:text-amber-400 tabular-nums shrink-0">
                          {fmtUsd(plan.totalCostUsd)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[9px] text-slate-500 leading-snug">
                  {t(
                    'כל אפשרות היא מסלול רציף אחד (יבשה + ים או יבשה + אוויר). המפה מציגה את הבחירה הנוכחית בלבד.',
                    'Each option is one sequential corridor (ground/rail + sea or ground + air). The map shows only the selected plan.',
                  )}
                </p>
              </div>
            )}

            {result?.routeAssumptions && result.routeAssumptions.length > 0 && (
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.07] px-4 py-3 text-[11px] font-semibold text-cyan-950 dark:text-cyan-100">
                <p className="mb-2 text-[9px] font-black uppercase tracking-widest opacity-75">{t('הנחות מסלול', 'Route assumptions')}</p>
                <ul className="space-y-1.5">
                  {result.routeAssumptions.slice(0, 4).map((item, index) => (
                    <li key={`${item}-${index}`} className="leading-snug">{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Cost breakdown */}
              <div className="rounded-3xl border border-black/10 dark:border-white/10 overflow-hidden">
                <div className="px-5 py-3 border-b border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">💰 {t('פירוק עלות', 'Cost Breakdown')}</h4>
                </div>
                <div className="divide-y divide-black/5 dark:divide-white/10">
                  {displayBreakdown.map((line) => (
                    <div key={line.id} className="px-5 py-3 flex gap-4 items-start justify-between hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors">
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-slate-900 dark:text-white">{t(line.labelHe, line.labelEn)}</p>
                        {line.note && <p className="text-[9px] text-slate-500 mt-0.5 leading-snug">{t(line.note[0], line.note[1])}</p>}
                      </div>
                      <span className="text-sm font-black text-slate-700 dark:text-slate-200 shrink-0 tabular-nums">{fmtUsd(line.amountUsd)}</span>
                    </div>
                  ))}
                  <div className="px-5 py-3 flex items-center justify-between bg-amber-500/[0.06]">
                    <span className="text-[11px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">{t('סה"כ', 'Total')}</span>
                    <span className="text-base font-black text-amber-500">{fmtUsd(totalUsd)}</span>
                  </div>
                </div>
              </div>

              {/* Due diligence */}
              <div className="rounded-3xl border border-black/10 dark:border-white/10 overflow-hidden">
                <div className="px-5 py-3 border-b border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">🛡 {t('בדיקת נאותות', 'Due Diligence')}</h4>
                </div>
                <div className="divide-y divide-black/5 dark:divide-white/10">
                  {(result?.dueDiligence ?? []).map((chk) => (
                    <div key={chk.id} className="px-5 py-3 flex gap-3 items-start">
                      <DdBadge status={chk.status} />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{t(chk.labelHe, chk.labelEn)}</p>
                        {chk.detail && <p className="text-[9px] text-slate-500 mt-0.5 leading-snug">{t(chk.detail[0], chk.detail[1])}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Button variant="outline" className="w-full h-10 rounded-xl text-[10px] font-black uppercase border-black/10 dark:border-white/10"
              onClick={() => setStep('setup')}>
              <MapPin className="w-3.5 h-3.5 mr-2" />
              {t('שנה פרמטרים', 'Modify Parameters')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
