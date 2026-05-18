import { Crosshair } from 'lucide-react';
import { memo, startTransition, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useI18n } from '../../lib/i18n';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import type { LocationPreset } from './locationPresets';
import { canonicalRouteHubCountry, findNearestHubInCountry, matchPresetId } from './locationPresets';
import RouteCountryCombobox from './RouteCountryCombobox';
import type { RoutePartyLocation, RoutePickRole } from './useRoutePlanner';

interface RoutePlannerLocationBlockProps {
  role: RoutePickRole;
  title: string;
  titleClass: string;
  accentBorder: string;
  location: RoutePartyLocation;
  setLocation: Dispatch<SetStateAction<RoutePartyLocation>>;
  presets: LocationPreset[];
  pickRole: RoutePickRole | null;
  beginPick: (role: RoutePickRole) => void;
  onFlyTo: (lat: number, lng: number) => void;
  showBuyerGroups?: boolean;
  requireCountry?: boolean;
  presetsPending?: boolean;
}

function presetToLocation(preset: LocationPreset): RoutePartyLocation {
  return {
    lat: preset.lat,
    lng: preset.lng,
    label: preset.name,
    country: preset.country,
    licenseId: preset.licenseId,
    commodity: preset.commodity,
    sector: preset.sector,
  };
}

function RoutePlannerLocationBlock({
  role,
  title,
  titleClass,
  accentBorder,
  location,
  setLocation,
  presets,
  pickRole,
  beginPick,
  onFlyTo,
  showBuyerGroups = false,
  requireCountry = false,
  presetsPending = false,
}: RoutePlannerLocationBlockProps) {
  const { t } = useI18n();
  const active = pickRole === role;
  const [coordsOpen, setCoordsOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);

  useEffect(() => {
    if (presetsPending) setPresetOpen(false);
  }, [presetsPending]);

  const presetId = useMemo(
    () => matchPresetId(presets, location.lat, location.lng),
    [presets, location.lat, location.lng],
  );

  const licensePresets = useMemo(() => presets.filter((p) => p.group === 'licenses'), [presets]);
  const portPresets = useMemo(
    () => presets.filter((p) => p.group === 'ports' || (p.group === 'catalog' && !p.id.startsWith('air-'))),
    [presets],
  );
  const airportPresets = useMemo(
    () => presets.filter((p) => p.group === 'catalog' && p.id.startsWith('air-')),
    [presets],
  );
  const buyerPresets = useMemo(() => presets.filter((p) => p.group === 'buyers'), [presets]);

  const countrySelectValue = canonicalRouteHubCountry(location.country) ?? '';

  const handleCountryChange = useCallback(
    (val: string | undefined) => {
      startTransition(() => {
        if (!val) {
          setLocation((loc) => ({ ...loc, country: undefined }));
          return;
        }
        setLocation((loc) => {
          const snap = findNearestHubInCountry(loc.lat, loc.lng, val);
          if (snap) {
            onFlyTo(snap.lat, snap.lng);
            return {
              lat: snap.lat,
              lng: snap.lng,
              label: snap.name,
              country: val,
              ...(role === 'supplier' ? { licenseId: undefined } : {}),
            };
          }
          return { ...loc, country: val, ...(role === 'supplier' ? { licenseId: undefined } : {}) };
        });
      });
    },
    [role, setLocation, onFlyTo],
  );

  const applyPreset = (val: string) => {
    if (val === 'custom') return;
    const found = presets.find((p) => p.id === val);
    if (!found) return;
    startTransition(() => {
      setLocation(presetToLocation(found));
      onFlyTo(found.lat, found.lng);
    });
  };

  const updateCoord = (field: 'lat' | 'lng', raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped =
      field === 'lat' ? Math.max(-90, Math.min(90, parsed)) : Math.max(-180, Math.min(180, parsed));
    startTransition(() => {
      setLocation((loc) => ({
        ...loc,
        [field]: clamped,
        licenseId: undefined,
      }));
    });
  };

  return (
    <div
      className={`rounded-2xl border p-4 transition-all ${active ? accentBorder : 'border-black/10 dark:border-white/10'}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className={`text-[10px] font-black uppercase tracking-widest ${titleClass}`}>{title}</p>
          {location.label ? (
            <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate max-w-[200px]">
              {location.label}
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-1">{t('לא נבחר', 'Not selected')}</p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant={active ? 'default' : 'outline'}
          className="h-8 rounded-xl text-[8px] font-black uppercase"
          onClick={() => beginPick(role)}
        >
          <Crosshair className="w-3 h-3 mr-1" />
          {t('מהמפה', 'From map')}
        </Button>
      </div>

      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
        {role === 'buyer'
          ? t('מדינת יעד (נדרש לנמלים)', 'Destination country (required for hubs)')
          : t('מדינת מוצא', 'Origin country')}
      </p>
      <RouteCountryCombobox
        value={countrySelectValue}
        onChange={handleCountryChange}
        requireHighlight={requireCountry}
      />

      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
        {role === 'supplier'
          ? t('בחר נכס, נמל, או מיקום', 'Select asset, port, or location')
          : t('בחר יעד, נמל, או מיקום', 'Select destination, port, or location')}
      </p>
      <Select
        value={presetId}
        onValueChange={applyPreset}
        disabled={presetsPending}
        open={presetOpen && !presetsPending}
        onOpenChange={(open) => setPresetOpen(open && !presetsPending)}
      >
        <SelectTrigger
          className="h-9 rounded-xl text-xs font-semibold border-black/10 dark:border-white/10"
          disabled={presetsPending}
        >
          <SelectValue
            placeholder={
              presetsPending
                ? t('מעדכן רשימה...', 'Updating list...')
                : role === 'supplier'
                ? t('בחר נכס ממפת ה-AI שלך...', 'Choose an asset from your AI map...')
                : t('בחר נמל, מזקקה, או לקוח...', 'Select port, refinery, or buyer...')
            }
          />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="custom">{t('מיקום חופשי / מהמפה', 'Free pick / from map')}</SelectItem>
          {licensePresets.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[9px] font-black text-purple-500 uppercase tracking-wider">
                🏭 {t('הנכסים והזיכיונות שלך', 'Your Concessions & Assets')}
              </SelectLabel>
              {licensePresets.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {portPresets.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[9px] font-black text-blue-500 uppercase tracking-wider">
                🌊 {t('נמלים ומרכזי סחר', 'Ports & trade hubs')}
              </SelectLabel>
              {portPresets.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {airportPresets.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[9px] font-black text-indigo-500 uppercase tracking-wider">
                ✈ {t('שדות תעופה', 'Airports')}
              </SelectLabel>
              {airportPresets.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {showBuyerGroups && buyerPresets.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[9px] font-black text-emerald-500 uppercase tracking-wider">
                🏭 {t('קונים ומזקקות', 'Refineries & Buyers')}
              </SelectLabel>
              {buyerPresets.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      <div className="mt-3">
        {!coordsOpen ? (
          <button
            type="button"
            onClick={() => setCoordsOpen(true)}
            className="text-[9px] font-bold uppercase tracking-wide text-amber-600 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300"
          >
            {t('הזן קואורדינטות', 'Enter lat / lng')}
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                {t('קואורדינטות', 'Coordinates')}
              </p>
              <button
                type="button"
                onClick={() => setCoordsOpen(false)}
                className="text-[9px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                {t('הסתר', 'Hide')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  {t('קו רוחב', 'Latitude')}
                </p>
                <Input
                  type="number"
                  step="any"
                  value={Number.isFinite(location.lat) ? location.lat : ''}
                  onChange={(e) => updateCoord('lat', e.target.value)}
                  className="h-9 rounded-xl text-xs font-semibold border-black/10 dark:border-white/10"
                />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  {t('קו אורך', 'Longitude')}
                </p>
                <Input
                  type="number"
                  step="any"
                  value={Number.isFinite(location.lng) ? location.lng : ''}
                  onChange={(e) => updateCoord('lng', e.target.value)}
                  className="h-9 rounded-xl text-xs font-semibold border-black/10 dark:border-white/10"
                />
              </div>
            </div>
            <p className="mt-2 text-[9px] text-slate-400 font-bold">
              📍 {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(RoutePlannerLocationBlock);
