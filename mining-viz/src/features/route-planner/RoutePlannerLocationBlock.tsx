import { Crosshair } from 'lucide-react';
import { memo, startTransition, useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useI18n } from '../../lib/i18n';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import type { LocationPreset } from './locationPresets';
import { canonicalRouteHubCountry, findNearestHubInCountry } from './locationPresets';
import RouteCountryCombobox from './RouteCountryCombobox';
import RoutePresetPicker from './RoutePresetPicker';
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
  onPresetPickerOpenChange?: (open: boolean) => void;
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

const LocationBlockHeader = memo(function LocationBlockHeader({
  title,
  titleClass,
  location,
  active,
  beginPick,
  role,
  t,
}: {
  title: string;
  titleClass: string;
  location: RoutePartyLocation;
  active: boolean;
  beginPick: (role: RoutePickRole) => void;
  role: RoutePickRole;
  t: (he: string, en: string) => string;
}) {
  return (
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
  );
});

const CoordField = memo(function CoordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (raw: string) => void;
}) {
  return (
    <div>
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      <Input
        type="number"
        step="any"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-xl text-xs font-semibold border-black/10 dark:border-white/10"
      />
    </div>
  );
});

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
  onPresetPickerOpenChange,
}: RoutePlannerLocationBlockProps) {
  const { t } = useI18n();
  const active = pickRole === role;
  const [coordsOpen, setCoordsOpen] = useState(false);

  const countrySelectValue = canonicalRouteHubCountry(location.country) ?? '';

  // Profiler: country combobox must commit in one frame; hub snap + map fly are deferred.
  const handleCountryChange = useCallback(
    (val: string | undefined) => {
      setLocation((loc) => ({
        ...loc,
        country: val,
        ...(role === 'supplier' ? { licenseId: undefined } : {}),
      }));
      if (!val) return;

      startTransition(() => {
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

  const applyPreset = useCallback(
    (found: LocationPreset) => {
      startTransition(() => {
        setLocation(presetToLocation(found));
        onFlyTo(found.lat, found.lng);
      });
    },
    [setLocation, onFlyTo],
  );

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

  const presetPlaceholder =
    role === 'supplier'
      ? t('בחר מיקום...', 'Choose location...')
      : t('בחר יעד...', 'Choose destination...');

  const pickerDisabled = requireCountry && !countrySelectValue;

  return (
    <div
      className={`rounded-2xl border p-4 transition-all ${active ? accentBorder : 'border-black/10 dark:border-white/10'}`}
    >
      <LocationBlockHeader
        title={title}
        titleClass={titleClass}
        location={location}
        active={active}
        beginPick={beginPick}
        role={role}
        t={t}
      />

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
      <RoutePresetPicker
        presets={presets}
        selectedLabel={location.label}
        placeholder={presetPlaceholder}
        pending={presetsPending}
        disabled={pickerDisabled}
        showBuyerGroups={showBuyerGroups}
        onOpenChange={onPresetPickerOpenChange}
        onSelect={applyPreset}
        onFreePick={() => beginPick(role)}
      />

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
              <CoordField label={t('קו רוחב', 'Latitude')} value={location.lat} onChange={(v) => updateCoord('lat', v)} />
              <CoordField label={t('קו אורך', 'Longitude')} value={location.lng} onChange={(v) => updateCoord('lng', v)} />
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
