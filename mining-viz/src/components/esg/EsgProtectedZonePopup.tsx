import { Shield } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import {
  type EsgConservationZone,
  formatBufferRadiusMeters,
} from '../../lib/esgConservationZones';

interface EsgProtectedZonePopupProps {
  zone: EsgConservationZone;
}

function DetailRow({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
        {label}
      </p>
      <p className="text-[12px] font-medium text-slate-100 leading-snug break-words">{value}</p>
    </div>
  );
}

export default function EsgProtectedZonePopup({ zone }: EsgProtectedZonePopupProps) {
  const { t } = useI18n();
  const [lat, lng] = zone.center;

  const detailRows: { label: string; value: string; wide?: boolean }[] = [
    { label: t('סוג', 'Type'), value: zone.zoneType },
    { label: t('הגבלות', 'Restrictions'), value: zone.restrictions, wide: true },
    { label: t('מדינה', 'Country'), value: zone.country },
    {
      label: t('רדיוס חיץ', 'Buffer radius'),
      value: formatBufferRadiusMeters(zone.radius),
    },
  ];
  if (zone.source) {
    detailRows.push({ label: t('מקור', 'Source'), value: zone.source });
  }

  return (
    <article className="esg-map-popup w-[min(100vw-48px,360px)] border-l-2 border-emerald-500/30 pl-3 pr-1">
      <header className="mb-3 pr-7">
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            {t('אזור מוגן', 'Protected area')}
          </span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-300">
            {zone.zoneType}
          </span>
        </div>
        <h3 className="text-[15px] font-bold leading-snug text-white break-words">{zone.name}</h3>
      </header>

      <p className="mb-3 text-[11px] leading-relaxed text-slate-400 break-words">{zone.description}</p>

      <div className="grid grid-cols-1 gap-y-3 mb-3 sm:grid-cols-2 sm:gap-x-4">
        {detailRows.map((row) => (
          <DetailRow
            key={`${row.label}-${row.value}`}
            label={row.label}
            value={row.value}
            wide={row.wide}
          />
        ))}
      </div>

      <footer className="flex flex-col gap-2 border-t border-white/10 pt-3 mt-1">
        <div className="flex items-start gap-1.5 text-[11px] text-slate-400">
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500/80" aria-hidden />
          <span className="font-mono text-slate-300">
            {lat.toFixed(4)}°, {lng.toFixed(4)}°
          </span>
        </div>
        <p className="text-[9px] uppercase tracking-wide text-slate-600">
          {t('שכבת ESG', 'ESG compliance layer')} · conservation buffer
        </p>
      </footer>
    </article>
  );
}
