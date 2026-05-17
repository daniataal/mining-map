import { Loader2, Sliders } from 'lucide-react';
import { useMemo, useState } from 'react';
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
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function DdTone(status: DueDiligenceStatus) {
  switch (status) {
    case 'pass':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35';
    case 'warn':
      return 'bg-amber-500/15 text-amber-900 dark:text-amber-200 border border-amber-500/35';
    case 'fail':
      return 'bg-red-500/15 text-red-800 dark:text-red-200 border border-red-500/35';
    default:
      return 'bg-slate-500/10 text-slate-600 border border-slate-500/25';
  }
}

interface LocationPreset {
  id: string;
  name: string;
  lat: number;
  lng: number;
  group: 'suppliers' | 'buyers' | 'ports' | 'licenses';
}

function CoordBlock({
  title,
  sub,
  lat,
  lng,
  pickActive,
  onLat,
  onLng,
  label,
  onLabel,
  onPick,
  disabled,
  presets,
  showAdvancedCoords,
  onSelectPreset,
}: {
  title: string;
  sub: string;
  lat: number;
  lng: number;
  pickActive: boolean;
  onLat: (v: number) => void;
  onLng: (v: number) => void;
  label: string;
  onLabel: (value: string) => void;
  onPick: () => void;
  disabled?: boolean;
  presets: LocationPreset[];
  showAdvancedCoords: boolean;
  onSelectPreset: (preset: LocationPreset) => void;
}) {
  const { t } = useI18n();

  // Find active preset if coordinates match closely
  const selectedPresetId = useMemo(() => {
    const matched = presets.find(p => Math.abs(p.lat - lat) < 1e-4 && Math.abs(p.lng - lng) < 1e-4);
    return matched ? matched.id : 'custom';
  }, [presets, lat, lng]);

  return (
    <div className={`rounded-2xl border p-4 transition-all duration-300 ${pickActive ? 'border-amber-500/55 bg-amber-500/[0.07] shadow-md shadow-amber-500/5' : 'border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03]'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">{title}</p>
          <p className="text-[10px] text-slate-500 mt-1">{sub}</p>
        </div>
        <Button
          type="button"
          variant={pickActive ? 'default' : 'outline'}
          size="sm"
          className="h-8 rounded-xl text-[8px] font-black uppercase tracking-widest shrink-0"
          onClick={onPick}
          disabled={disabled}
        >
          {pickActive ? t('ממתין למפה…', 'Map pick…') : t('מהמפה', 'From map')}
        </Button>
      </div>

      {/* Preset Selector Dropdown */}
      <div className="mb-3">
        <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
          {t('בחר ישות או נמל', 'Select entity or port')}
        </p>
        <Select
          value={selectedPresetId}
          onValueChange={(val) => {
            if (val === 'custom') return;
            const chosen = presets.find(p => p.id === val);
            if (chosen) {
              onSelectPreset(chosen);
            }
          }}
        >
          <SelectTrigger className="h-9 rounded-xl border-black/10 dark:border-white/10 bg-white/80 dark:bg-slate-950/80 text-xs font-semibold">
            <SelectValue placeholder={t('בחר מיקום מוכן...', 'Select a preset location...')} />
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            <SelectItem value="custom">{t('מיקום מותאם אישית / חופשי', 'Custom / Free Picked Location')}</SelectItem>
            
            {presets.some(p => p.group === 'suppliers') && (
              <SelectGroup>
                <SelectLabel className="text-[9px] font-black text-amber-500 uppercase tracking-wider px-2 py-1">
                  {t('ספקים גלובליים', 'Global Upstream Suppliers')}
                </SelectLabel>
                {presets.filter(p => p.group === 'suppliers').map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}

            {presets.some(p => p.group === 'buyers') && (
              <SelectGroup>
                <SelectLabel className="text-[9px] font-black text-emerald-500 uppercase tracking-wider px-2 py-1">
                  {t('צרכנים ומזקקות', 'Downstream Refineries & Buyers')}
                </SelectLabel>
                {presets.filter(p => p.group === 'buyers').map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}

            {presets.some(p => p.group === 'ports') && (
              <SelectGroup>
                <SelectLabel className="text-[9px] font-black text-blue-500 uppercase tracking-wider px-2 py-1">
                  {t('נמלי סחר ימיים', 'Global Trade Seaports')}
                </SelectLabel>
                {presets.filter(p => p.group === 'ports').map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}

            {presets.some(p => p.group === 'licenses') && (
              <SelectGroup>
                <SelectLabel className="text-[9px] font-black text-purple-500 uppercase tracking-wider px-2 py-1">
                  {t('הזיכיונות והנכסים שלך', 'Your Active Concessions & Assets')}
                </SelectLabel>
                {presets.filter(p => p.group === 'licenses').map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-2">
        <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
          {t('שם מיקום / תווית', 'Location Label')}
        </p>
        <Input
          type="text"
          placeholder={`${sub} (${title})`}
          value={label}
          className="h-9 rounded-xl text-xs bg-white/70 dark:bg-slate-950/70 border-black/10 dark:border-white/10 font-bold"
          onChange={(e) => onLabel(e.target.value)}
        />
      </div>

      {showAdvancedCoords && (
        <div className="grid grid-cols-2 gap-2 mb-2 pt-2 border-t border-black/5 dark:border-white/5 animate-in fade-in duration-200">
          <div>
            <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">Lat</p>
            <Input
              type="number"
              step="any"
              className="h-9 rounded-xl text-xs font-semibold bg-white/80 dark:bg-slate-950/80 border-black/10 dark:border-white/10"
              value={Number.isFinite(lat) ? lat : 0}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                onLat(n);
              }}
            />
          </div>
          <div>
            <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">Lng</p>
            <Input
              type="number"
              step="any"
              className="h-9 rounded-xl text-xs font-semibold bg-white/80 dark:bg-slate-950/80 border-black/10 dark:border-white/10"
              value={Number.isFinite(lng) ? lng : 0}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                onLng(n);
              }}
            />
          </div>
        </div>
      )}

      <p className="mt-2 text-[9px] text-slate-400 font-bold">
        📍 {(lat ?? 0).toFixed(4)}, {(lng ?? 0).toFixed(4)}
      </p>
    </div>
  );
}

interface RoutePlannerPanelProps {
  rp: RoutePlannerHook;
  allLicenses?: any[];
}

export default function RoutePlannerPanel({ rp, allLicenses }: RoutePlannerPanelProps) {
  const { t } = useI18n();
  const {
    supplier,
    setSupplier,
    buyer,
    setBuyer,
    productType,
    setProductType,
    shippingMethods,
    toggleShippingMethod,
    pickRole,
    beginPick,
    cancelPick,
    result,
    loading,
    error,
    computeRoute,
    sourceLabel,
  } = rp;

  const [showAdvancedCoords, setShowAdvancedCoords] = useState(false);

  const totalUsd = useMemo(() => {
    const lines = result?.breakdown ?? [];
    return lines.reduce((acc, row) => acc + row.amountUsd, 0);
  }, [result?.breakdown]);

  // Combined Presets
  const presets = useMemo(() => {
    const list: LocationPreset[] = [
      // Suppliers
      { id: 'pres-sandvik', name: 'Sandvik Mining & Rock Solutions (Sweden)', lat: 60.6749, lng: 17.1413, group: 'suppliers' },
      { id: 'pres-cat', name: 'Caterpillar Global Mining (United States)', lat: 40.7589, lng: -89.5890, group: 'suppliers' },
      { id: 'pres-orica', name: 'Orica Mining Services (Australia)', lat: -33.8688, lng: 151.2093, group: 'suppliers' },
      { id: 'pres-slb', name: 'SLB (Schlumberger Ltd) (France)', lat: 48.8566, lng: 2.3522, group: 'suppliers' },
      { id: 'pres-baker', name: 'Baker Hughes Logistics (United States)', lat: 29.7604, lng: -95.3698, group: 'suppliers' },
      
      // Buyers
      { id: 'pres-valcambi', name: 'Valcambi SA Smelter (Switzerland)', lat: 46.0244, lng: 8.9506, group: 'buyers' },
      { id: 'pres-rand', name: 'Rand Refinery (South Africa)', lat: -26.2485, lng: 28.1633, group: 'buyers' },
      { id: 'pres-tesla', name: 'Tesla Gigafactory Batteries (United States)', lat: 39.5392, lng: -119.2318, group: 'buyers' },
      { id: 'pres-bp', name: 'BP Oil Trading (United Kingdom)', lat: 51.5074, lng: -0.1278, group: 'buyers' },
      { id: 'pres-mitsubishi', name: 'Mitsubishi Heavy Industries (Japan)', lat: 35.6762, lng: 139.6503, group: 'buyers' },
      
      // Ports
      { id: 'pres-port-durban', name: 'Port of Durban (South Africa) [SEAPORT]', lat: -29.8667, lng: 31.0500, group: 'ports' },
      { id: 'pres-port-rotterdam', name: 'Port of Rotterdam (Netherlands) [SEAPORT]', lat: 51.9244, lng: 4.4777, group: 'ports' },
      { id: 'pres-port-houston', name: 'Port of Houston (United States) [SEAPORT]', lat: 29.7355, lng: -95.2750, group: 'ports' },
      { id: 'pres-port-shanghai', name: 'Port of Shanghai (China) [SEAPORT]', lat: 31.2304, lng: 121.4737, group: 'ports' },
      { id: 'pres-port-singapore', name: 'Port of Singapore (Singapore) [SEAPORT]', lat: 1.3521, lng: 103.8198, group: 'ports' },
      { id: 'pres-port-antwerp', name: 'Port of Antwerp (Belgium) [SEAPORT]', lat: 51.2194, lng: 4.4025, group: 'ports' },
    ];

    if (allLicenses) {
      allLicenses.forEach((item) => {
        list.push({
          id: `pres-lic-${item.id}`,
          name: `${item.company} (${item.licenseType || 'Concession'} - #${item.id})`,
          lat: item.lat,
          lng: item.lng,
          group: 'licenses'
        });
      });
    }

    return list;
  }, [allLicenses]);

  return (
    <Card className="w-[min(96vw,1080px)] max-h-[min(88vh,820px)] overflow-hidden bg-white/95 dark:bg-slate-950/95 border border-black/10 dark:border-white/10 rounded-3xl shadow-2xl backdrop-blur-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-5 border-b border-black/5 dark:border-white/10">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">
            {t('מתכנן מסלול', 'Route planner')}
          </p>
          <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            {t('ספק → קונה: עלות, שיטות הובלה, נאותות', 'Supplier → buyer costs, modalities, diligence')}
          </h3>
          <p className="text-[10px] text-slate-500 mt-2 max-w-2xl leading-relaxed">
            {t(
              'בחרו את נקודת המוצא (הספק) ואת נמל היעד או מזקקת הקצה. ניתן להשתמש ברשימת המיקומים המוכנים מראש, לבחור מהמפה או להזין קואורדינטות מתקדמות.',
              'Choose your supplier origin and buyer refinery or seaport. Use presets, pick from map, or reveal advanced coordinates.',
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant={showAdvancedCoords ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowAdvancedCoords(!showAdvancedCoords)}
            className={`h-8 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all
              ${showAdvancedCoords ? 'bg-amber-500 text-slate-950' : ''}`}
          >
            <Sliders className="w-3 h-3 mr-1" />
            {t('הצג קואורדינטות', 'Coordinates')}
          </Button>

          {pickRole ? (
            <Badge className="border-none bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 text-[9px] font-black uppercase">
              {pickRole === 'supplier' ? t('מצב קליק: ספק', 'Pick on map: supplier') : t('מצב קליק: קונה', 'Pick on map: buyer')}
            </Badge>
          ) : null}
          {sourceLabel && (
            <Badge
              className={
                sourceLabel === 'live'
                  ? 'border-none bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 text-[9px] font-black uppercase'
                  : 'border-none bg-slate-500/15 text-slate-700 dark:text-slate-400 text-[9px] font-black uppercase'
              }
            >
              {sourceLabel === 'live' ? t('מקור חי', 'Live API') : t('mock', 'Mock')}
            </Badge>
          )}
          {pickRole ? (
            <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl text-[9px]" onClick={cancelPick}>
              {t('בטל בחירת מפה', 'Cancel map pick')}
            </Button>
          ) : null}
          <Button
            type="button"
            className="h-9 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest bg-amber-500 hover:bg-amber-400 text-slate-950"
            onClick={() => void computeRoute()}
            disabled={loading || shippingMethods.length === 0}
          >
            {loading ? (
              <>
                <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                {t('מחשב…', 'Planning…')}
              </>
            ) : (
              t('חשב מסלול', 'Plan route')
            )}
          </Button>
        </div>
      </div>

      <div className="p-6 overflow-y-auto max-h-[calc(88vh-120px)] space-y-6">
        {pickRole && (
          <div className="rounded-2xl border border-cyan-500/35 bg-cyan-500/[0.08] px-4 py-3 text-[11px] text-cyan-900 dark:text-cyan-100 font-semibold">
            {t('לחצו במפה כדי למקם נקודה. נסגר אוטומטית אחרי קליק אחד.', 'Click anywhere on the map to place this point — we close picking after one tap.')}
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-[11px] font-bold text-red-800 dark:text-red-200">{error}</div>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CoordBlock
                title={t('ספק / מוצא', 'Supplier / origin')}
                sub={t('קואורדינטות או מפה', 'Coordinates or map click')}
                lat={supplier.lat}
                lng={supplier.lng}
                label={supplier.label}
                pickActive={pickRole === 'supplier'}
                onLat={(lat) => setSupplier((s) => ({ ...s, lat }))}
                onLng={(lng) => setSupplier((s) => ({ ...s, lng }))}
                onLabel={(label) => setSupplier((s) => ({ ...s, label }))}
                onPick={() => beginPick('supplier')}
                disabled={loading}
                presets={presets}
                showAdvancedCoords={showAdvancedCoords}
                onSelectPreset={(p) => setSupplier({ lat: p.lat, lng: p.lng, label: p.name })}
              />
              <CoordBlock
                title={t('קונה / יעד', 'Buyer / destination')}
                sub={t('קואורדינטות או מפה', 'Coordinates or map click')}
                lat={buyer.lat}
                lng={buyer.lng}
                label={buyer.label}
                pickActive={pickRole === 'buyer'}
                onLat={(lat) => setBuyer((b) => ({ ...b, lat }))}
                onLng={(lng) => setBuyer((b) => ({ ...b, lng }))}
                onLabel={(label) => setBuyer((b) => ({ ...b, label }))}
                onPick={() => beginPick('buyer')}
                disabled={loading}
                presets={presets}
                showAdvancedCoords={showAdvancedCoords}
                onSelectPreset={(p) => setBuyer({ lat: p.lat, lng: p.lng, label: p.name })}
              />
            </div>

            <div>
              <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
                {t('סוג מוצר', 'Product')}
              </p>
              <Select value={productType} onValueChange={setProductType}>
                <SelectTrigger className="h-10 rounded-xl border-black/10 dark:border-white/10 bg-white/80 dark:bg-slate-950/80 font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {t(p.labelHe, p.labelEn)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-500">
                {t('שיטות הובלה — בחירה מרובה', 'Shipping methods — multi')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SHIPPING_OPTIONS.map((opt) => {
                  const checked = shippingMethods.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${checked ? 'border-amber-500/55 bg-amber-500/[0.06]' : 'border-black/10 dark:border-white/10'}`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={loading}
                        onCheckedChange={(v) => toggleShippingMethod(opt.id, Boolean(v))}
                      />
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                        {t(opt.labelHe, opt.labelEn)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {t('פירוק עלות (USD)', 'Cost breakdown (USD)')}
                </h4>
                <span className="text-xs font-black text-amber-500">{fmtUsd(totalUsd)}</span>
              </div>
              <div className="divide-y divide-black/5 dark:divide-white/10">
                {(result?.breakdown ?? []).map((line) => (
                  <div key={line.id} className="px-5 py-3 flex gap-4 items-start justify-between">
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-slate-900 dark:text-white">{t(line.labelHe, line.labelEn)}</p>
                      {line.note && <p className="text-[10px] text-slate-500 mt-1 leading-snug">{t(line.note[0], line.note[1])}</p>}
                    </div>
                    <span className="text-xs font-black text-slate-700 dark:text-slate-300 shrink-0">{fmtUsd(line.amountUsd)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-5">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">
                {t('סטטוס נאותות', 'Due diligence')}
              </h4>
              <div className="space-y-3">
                {(result?.dueDiligence ?? []).map((chk) => (
                  <div
                    key={chk.id}
                    className={`flex flex-wrap gap-3 items-start justify-between rounded-2xl px-4 py-3 ${DdTone(chk.status)}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge className="border-none bg-white/55 dark:bg-black/35 text-[8px] font-black uppercase">
                          {chk.status === 'pass' ? t('תקין', 'Pass') : chk.status === 'warn' ? t('אזהרה', 'Warn') : t('חריג', 'Fail')}
                        </Badge>
                        <p className="text-sm font-bold">{t(chk.labelHe, chk.labelEn)}</p>
                      </div>
                      {chk.detail && <p className="text-[10px] leading-snug opacity-90">{t(chk.detail[0], chk.detail[1])}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </Card>
  );
}
