import { useI18n } from '../../lib/i18n';
import type { StsConfidenceTier } from '../../api/stsEventsApi';

const TIER_STYLES: Record<string, { className: string; labelEn: string; labelHe: string }> = {
  low: {
    className: 'border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-200',
    labelEn: 'Low confidence',
    labelHe: 'ביטחון נמוך',
  },
  medium: {
    className: 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100',
    labelEn: 'Medium confidence',
    labelHe: 'ביטחון בינוני',
  },
  high: {
    className: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100',
    labelEn: 'High confidence',
    labelHe: 'ביטחון גבוה',
  },
  very_high: {
    className: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-950 dark:text-cyan-100',
    labelEn: 'Very high confidence',
    labelHe: 'ביטחון גבוה מאוד',
  },
  verified: {
    className: 'border-emerald-600/50 bg-emerald-600/20 text-emerald-950 dark:text-emerald-50',
    labelEn: 'Analyst verified',
    labelHe: 'אומת על ידי אנליסט',
  },
};

type Props = {
  tier?: StsConfidenceTier | null;
  className?: string;
};

/** Honest STS inference tier — proximity match, not verified transfer. */
export default function StsConfidenceBadge({ tier, className = '' }: Props) {
  const { t } = useI18n();
  const key = (tier ?? 'inferred').toLowerCase().replace(/\s+/g, '_');
  const style = TIER_STYLES[key] ?? {
    className: 'border-violet-500/40 bg-violet-500/15 text-violet-900 dark:text-violet-100',
    labelEn: tier ?? 'Inferred',
    labelHe: tier ?? 'מסקנה',
  };
  const title =
    key === 'verified'
      ? t(
          'אומת על ידי אנליסט — עדיין לא BOL / העברת מטען מאומתת',
          'Analyst verified — still not a verified BOL or cargo transfer',
        )
      : t(
          'קרבת AIS מסקנית — לא העברת מטען מאומתת',
          'AIS proximity inference — not a verified cargo transfer',
        );

  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${style.className} ${className}`}
      title={title}
    >
      {t(style.labelHe, style.labelEn)}
    </span>
  );
}
