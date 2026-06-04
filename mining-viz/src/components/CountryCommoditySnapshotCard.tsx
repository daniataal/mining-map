import { useQuery } from '@tanstack/react-query';
import { ExternalLink, TrendingUp } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { getCountryCommoditySnapshot, type CountryCommoditySnapshot } from '../lib/api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

function fmtUsd(val: number | null | undefined): string {
  if (val == null || Number.isNaN(Number(val))) return '—';
  const n = Number(val);
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function fmtKg(val: number | null | undefined): string {
  if (val == null || Number.isNaN(Number(val))) return '—';
  const n = Number(val);
  if (n >= 1e9) return `${(n / 1e6).toFixed(1)} t`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} t`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} kg`;
  return `${n.toLocaleString()} kg`;
}

interface CountryCommoditySnapshotCardProps {
  entityId: string;
  entityKind?: string;
  /** Compact layout for map popup */
  variant?: 'compact' | 'full';
  onViewPartners?: () => void;
}

export default function CountryCommoditySnapshotCard({
  entityId,
  entityKind = 'license',
  variant = 'full',
  onViewPartners,
}: CountryCommoditySnapshotCardProps) {
  const { t } = useI18n();
  const compact = variant === 'compact';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['country-commodity-snapshot', entityId, entityKind],
    queryFn: () => getCountryCommoditySnapshot(entityId, entityKind),
    enabled: Boolean(entityId),
    staleTime: 30 * 60_000,
  });

  if (isLoading) {
    return (
      <div
        className={
          compact
            ? 'px-3 py-2 text-[10px] text-slate-500 border-t border-black/5 dark:border-white/5'
            : 'rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-slate-500'
        }
      >
        {t('טוען נתוני מדינה/סחורה…', 'Loading country commodity snapshot…')}
      </div>
    );
  }

  if (isError || !data) return null;

  return (
    <SnapshotBody data={data} compact={compact} onViewPartners={onViewPartners} />
  );
}

function SnapshotBody({
  data,
  compact,
  onViewPartners,
}: {
  data: CountryCommoditySnapshot;
  compact: boolean;
  onViewPartners?: () => void;
}) {
  const { t } = useI18n();
  const trade = data.trade;
  const extraction = data.extraction;
  const year = trade?.latestYear;
  const hasTrade =
    trade?.exportUsd != null ||
    trade?.importUsd != null ||
    (trade?.dataSources?.length ?? 0) > 0;
  const hasExtraction = extraction?.available;

  const wrapperClass = compact
    ? 'px-3 py-3 space-y-2 border-t border-black/5 dark:border-white/5 bg-amber-500/[0.04]'
    : 'rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5 space-y-4';

  return (
    <div className={wrapperClass}>
      <div className="flex items-start gap-2 flex-wrap">
        <TrendingUp className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p
            className={
              compact
                ? 'text-[9px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-200'
                : 'text-[10px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-200'
            }
          >
            {t('מדינה · סחורה (מאקרו)', 'Country · commodity (macro)')}
          </p>
          <p className="text-[10px] text-slate-500 break-words">
            {data.country || '—'}
            {data.commodity ? ` · ${data.commodity}` : ''}
            {data.hsCodes?.length ? ` · HS ${data.hsCodes.join(', ')}` : ''}
            {year != null ? ` · ${year}` : ''}
          </p>
        </div>
        <Badge variant="outline" className="text-[8px] font-black uppercase shrink-0">
          {data.bolTier || 'macro'}
        </Badge>
      </div>

      <p className="text-[9px] text-slate-500 leading-relaxed">
        {t(
          'נפחי יצוא/יבוא ברמת מדינה — לא דוח מכס של החברה על הרישיון.',
          'Country-level export/import — not this license holder’s customs filings.',
        )}
      </p>

      <div className={compact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 sm:grid-cols-4 gap-3'}>
        <Kpi
          label={t('יצוא', 'Export')}
          value={fmtUsd(trade?.exportUsd)}
          sub={trade?.exportKg != null ? fmtKg(trade.exportKg) : undefined}
          compact={compact}
        />
        <Kpi
          label={t('יבוא', 'Import')}
          value={fmtUsd(trade?.importUsd)}
          sub={trade?.importKg != null ? fmtKg(trade.importKg) : undefined}
          compact={compact}
        />
        <Kpi
          label={t('הפקה / כרייה', 'Extraction')}
          value={
            hasExtraction
              ? extraction?.summary
                ? compact
                  ? t('יש נתונים', 'Available')
                  : extraction.summary.slice(0, 120) + (extraction.summary.length > 120 ? '…' : '')
                : t('שדות GEM', 'GEM fields')
              : '—'
          }
          sub={
            extraction?.fieldCount
              ? `${extraction.fieldCount} ${t('שדות', 'fields')}`
              : undefined
          }
          compact={compact}
          wide={!compact}
        />
      </div>

      {!compact && extraction?.jodi?.summary && (
        <p className="text-[10px] text-slate-600 dark:text-slate-400">
          <span className="font-bold uppercase text-[9px] text-slate-500">JODI · </span>
          {extraction.jodi.summary}
        </p>
      )}

      {!compact && trade?.topExportPartners && trade.topExportPartners.length > 0 && (
        <p className="text-[10px] text-slate-600 dark:text-slate-400">
          <span className="font-bold uppercase text-[9px] text-slate-500">
            {t('יצוא ל', 'Export to')}:{' '}
          </span>
          {trade.topExportPartners
            .slice(0, 3)
            .map((p) => `${p.partner} (${fmtUsd(p.totalUsd)})`)
            .join(' · ')}
        </p>
      )}

      {(data.warnings || []).map((w) => (
        <p key={w} className="text-[9px] text-amber-700 dark:text-amber-400">
          {w}
        </p>
      ))}

      {!hasTrade && !hasExtraction && (
        <p className="text-[9px] text-slate-500">
          {t(
            'אין שורות מאוחסנות — הריצו graph-sync (Comtrade + GEM).',
            'No stored rows — run graph-sync (Comtrade + GEM ingest).',
          )}
        </p>
      )}

      {!compact && onViewPartners && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-[9px] font-black uppercase tracking-widest h-8"
          onClick={onViewPartners}
        >
          <ExternalLink className="w-3 h-3 mr-1.5" />
          {t('שותפי סחר מלאים', 'Full trade partners')}
        </Button>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  compact,
  wide,
}: {
  label: string;
  value: string;
  sub?: string;
  compact: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-black/5 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03] p-2 ${
        wide ? 'sm:col-span-2' : ''
      }`}
    >
      <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p
        className={
          compact
            ? 'text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate'
            : 'text-sm font-bold text-slate-800 dark:text-slate-100 break-words'
        }
        title={value}
      >
        {value}
      </p>
      {sub && <p className="text-[9px] text-slate-500">{sub}</p>}
    </div>
  );
}
