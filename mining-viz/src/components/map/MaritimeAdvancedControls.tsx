import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { VesselFilters } from '../../lib/vessels';

type TranslateFn = (he: string, en: string) => string;

type MaritimeFeedSummary = {
  cap_applied?: boolean;
  cached?: boolean;
  source?: string;
  geography_mode?: string;
  geography_note?: string;
  total_available?: number;
  returned_count?: number;
  persian_gulf_demo_synthetic?: boolean;
  aisstream_persian_gulf_coverage_gap?: boolean;
  maritime_aisstream_issue_url?: string;
};

type MaritimeAdvancedControlsProps = {
  t: TranslateFn;
  maritimeAdvancedOpen: boolean;
  onToggleAdvanced: () => void;
  maritimeMaxVessels: string;
  onMaritimeMaxVesselsChange: (value: string) => void;
  maritimeCaptureWindow: string;
  onMaritimeCaptureWindowChange: (value: string) => void;
  maritimeMaxVesselOptions: string[];
  maritimeCaptureWindowOptions: string[];
  vesselFilters: VesselFilters;
  onVesselFiltersChange: (update: (prev: VesselFilters) => VesselFilters) => void;
  maritimeVesselsInViewportCount: number;
  maritimeVesselsCount: number;
  lodFullDetailZoom: number;
  maritimeLegendKeys: readonly string[];
  vesselCategoryColors: Record<string, string>;
  vesselLegendT: Record<string, [string, string]>;
  maritimeFeed: MaritimeFeedSummary | null;
  maritimeDetailNote: string;
  maritimeLimitationText: string | null;
  maritimeErrorMessage: string | null;
};

export default function MaritimeAdvancedControls({
  t,
  maritimeAdvancedOpen,
  onToggleAdvanced,
  maritimeMaxVessels,
  onMaritimeMaxVesselsChange,
  maritimeCaptureWindow,
  onMaritimeCaptureWindowChange,
  maritimeMaxVesselOptions,
  maritimeCaptureWindowOptions,
  vesselFilters,
  onVesselFiltersChange,
  maritimeVesselsInViewportCount,
  maritimeVesselsCount,
  lodFullDetailZoom,
  maritimeLegendKeys,
  vesselCategoryColors,
  vesselLegendT,
  maritimeFeed,
  maritimeDetailNote,
  maritimeLimitationText,
  maritimeErrorMessage,
}: MaritimeAdvancedControlsProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggleAdvanced}
        className="flex w-full items-center justify-between rounded-xl border border-black/10 px-2.5 py-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.04]"
      >
        {t('מתקדם', 'Advanced')}
        {maritimeAdvancedOpen ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-70" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        )}
      </button>

      {maritimeAdvancedOpen && (
        <div className="space-y-2.5 border-t border-black/5 pt-2.5 dark:border-white/5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                {t('מכסה', 'Cap')}
              </p>
              <Select value={maritimeMaxVessels} onValueChange={onMaritimeMaxVesselsChange}>
                <SelectTrigger className="h-8 w-full rounded-lg border-black/10 bg-white/70 text-[9px] font-black uppercase tracking-widest dark:border-white/10 dark:bg-slate-950/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-black/10 bg-white dark:border-white/10 dark:bg-slate-950">
                  {maritimeMaxVesselOptions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value} {t('כלי שיט', 'vessels')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                {t('חלון לכידה', 'Capture')}
              </p>
              <Select value={maritimeCaptureWindow} onValueChange={onMaritimeCaptureWindowChange}>
                <SelectTrigger className="h-8 w-full rounded-lg border-black/10 bg-white/70 text-[9px] font-black uppercase tracking-widest dark:border-white/10 dark:bg-slate-950/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-black/10 bg-white dark:border-white/10 dark:bg-slate-950">
                  {maritimeCaptureWindowOptions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-cyan-500/15 bg-cyan-500/5 px-2.5 py-2.5">
            <p className="text-[8px] font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-400">
              {t('מסנני תצוגה (מקומיים)', 'Display filters (client-side)')}
            </p>
            <Input
              value={vesselFilters.search}
              onChange={(e) => onVesselFiltersChange((f) => ({ ...f, search: e.target.value }))}
              placeholder={t('חיפוש שם, MMSI, IMO…', 'Search name, MMSI, IMO…')}
              className="h-8 rounded-lg border-black/10 bg-white/80 text-[10px] dark:border-white/10 dark:bg-slate-950/80"
            />
            <div className="flex flex-wrap gap-1">
              {(['Tanker'] as const).map((typeLabel) => {
                const active = vesselFilters.shipTypes.includes(typeLabel);
                return (
                  <button
                    key={typeLabel}
                    type="button"
                    onClick={() =>
                      onVesselFiltersChange((f) => ({
                        ...f,
                        shipTypes: active
                          ? f.shipTypes.filter((x) => x !== typeLabel)
                          : [...f.shipTypes, typeLabel],
                      }))
                    }
                    className={`rounded-md px-2 py-0.5 text-[8px] font-black uppercase tracking-widest border ${
                      active
                        ? 'border-cyan-500/40 bg-cyan-500/20 text-cyan-600 dark:text-cyan-300'
                        : 'border-black/10 bg-white/50 text-slate-500 dark:border-white/10 dark:bg-slate-900/50'
                    }`}
                  >
                    {typeLabel}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                  {t('מהירות מינ׳ (kn)', 'Min speed (kn)')}
                </p>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={vesselFilters.minSpeedKnots ?? ''}
                  onChange={(e) =>
                    onVesselFiltersChange((f) => ({
                      ...f,
                      minSpeedKnots: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  className="h-8 rounded-lg border-black/10 bg-white/80 text-[10px] dark:border-white/10 dark:bg-slate-950/80"
                />
              </div>
              <div>
                <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                  {t('מהירות מקס׳ (kn)', 'Max speed (kn)')}
                </p>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={vesselFilters.maxSpeedKnots ?? ''}
                  onChange={(e) =>
                    onVesselFiltersChange((f) => ({
                      ...f,
                      maxSpeedKnots: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  className="h-8 rounded-lg border-black/10 bg-white/80 text-[10px] dark:border-white/10 dark:bg-slate-950/80"
                />
              </div>
            </div>
            {maritimeVesselsInViewportCount > maritimeVesselsCount && (
              <p className="text-[9px] text-slate-500">
                {t(
                  `מוצגים ${maritimeVesselsCount} מתוך ${maritimeVesselsInViewportCount} לאחר סינון.`,
                  `Showing ${maritimeVesselsCount} of ${maritimeVesselsInViewportCount} after filters.`,
                )}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-black/5 bg-black/[0.03] px-2 py-1.5 dark:border-white/10 dark:bg-white/[0.04]">
            <p className="mb-0.5 text-[8px] font-black uppercase tracking-widest text-slate-500">
              {t('מקרא סימני כלי שיט', 'Vessel markers')}
            </p>
            <p className="mb-1 text-[9px] leading-snug text-slate-500">
              {t(
                'הסימון מצביע לכיוון השייט (צפון מעלה). צבע המילוי לפי קטגוריית סוג AIS. בזום עולמי מוצגת דגימת LOD (מכליות מועדפות) — לא קיבוץ; בזום אזורי מוצגים כל כלי השיט בתצוגה.',
                `Chevron points along heading (north up). Fill color follows AIS ship-type category. Below zoom ${lodFullDetailZoom} the map may subsample icons for performance (tankers preferred)—not clustering; zoom in for every in-view vessel.`,
              )}
            </p>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {maritimeLegendKeys.map((key) => (
                <span key={key} className="inline-flex items-center gap-0.5 text-[8px] text-slate-400">
                  <span
                    className="h-2 w-2 shrink-0 rounded-[1px] border border-white/25"
                    style={{ backgroundColor: vesselCategoryColors[key] }}
                    aria-hidden
                  />
                  <span>{t(vesselLegendT[key][0], vesselLegendT[key][1])}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="border-none bg-cyan-500/10 text-[8px] font-black uppercase text-cyan-500">
              {t('כל כלי השיט', 'All vessels')}
            </Badge>
            <Badge className="border-none bg-slate-950/10 text-[8px] font-black uppercase text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {Number(maritimeCaptureWindow)}s
            </Badge>
            <Badge className="border-none bg-slate-950/10 text-[8px] font-black uppercase text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {t('מכסה', 'Cap')} {Number(maritimeMaxVessels)}
            </Badge>
            {maritimeFeed?.cap_applied && (
              <Badge className="border-none bg-amber-500/10 text-[8px] font-black uppercase text-amber-500">
                {t('לא הכל נטען', 'Cap applied')}
              </Badge>
            )}
            {maritimeFeed?.cached && (
              <Badge className="border-none bg-amber-500/10 text-[8px] font-black uppercase text-amber-500">
                {t('מטמון', 'Cached')}
              </Badge>
            )}
          </div>

          <div className="min-w-0">
            <p className="truncate text-[9px] font-black uppercase tracking-widest text-slate-500">
              {maritimeFeed?.source || t('ממתין לטעינה', 'Waiting to load')}
            </p>
            <p className="text-[9px] text-slate-500">
              {maritimeFeed?.geography_mode === 'stored_view_filter'
                ? t(
                    'סינון תצוגה על בסיס הנתונים השמורים — לא משנה את גבולות ה-ingest.',
                    'Stored-data view filter — does not change ingest boundaries.',
                  )
                : maritimeFeed?.geography_mode === 'viewport_bbox'
                  ? t('מבוסס על גבולות המפה הנוכחיים', 'Using the current map bounds')
                  : maritimeFeed?.geography_mode === 'sampled_viewport_regions'
                    ? t(
                        'תצוגה רחבה מדי ולכן מתבצע דגימה אזורית בתוך המבט',
                        'View is too wide, so the watch samples regions inside it',
                      )
                    : t(
                        'ללא bbox זמין מוחלות גאוגרפיות ברירת מחדל',
                        'Default watch regions apply when no viewport bbox is available',
                      )}
            </p>
          </div>

          <p className="text-[9px] leading-snug text-slate-500">{maritimeDetailNote}</p>

          {maritimeFeed?.geography_note && (
            <p className="text-[9px] leading-snug text-slate-500">{maritimeFeed.geography_note}</p>
          )}
          {maritimeFeed?.total_available != null && (
            <p className="text-[9px] leading-snug text-slate-500">
              {t(
                `זמינים ${maritimeFeed.total_available}, הוחזרו ${maritimeFeed.returned_count ?? maritimeVesselsCount}.`,
                `${maritimeFeed.total_available} available, ${maritimeFeed.returned_count ?? maritimeVesselsCount} returned.`,
              )}
            </p>
          )}
          {maritimeFeed?.cap_applied && (
            <p className="text-[9px] leading-snug text-slate-500">
              {t(
                'המכסה מגבילה את התוצאה לביצועים. הגדל מכסה או הזז/קרב מפה כדי לראות יותר.',
                'Cap limits this result for performance. Increase cap or narrow the viewport to see more.',
              )}
            </p>
          )}
          {maritimeLimitationText && (
            <p className="text-[9px] leading-snug text-slate-500">{maritimeLimitationText}</p>
          )}
          {maritimeErrorMessage && (
            <p className="text-[9px] leading-snug text-red-500">{maritimeErrorMessage}</p>
          )}
        </div>
      )}
    </>
  );
}
