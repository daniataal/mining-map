import { useI18n } from '../../lib/i18n';

const TIER_STYLES: Record<string, string> = {
  customs_open:
    'border-sky-500/40 bg-sky-500/15 text-sky-900 dark:text-sky-100',
  historic: 'border-violet-500/40 bg-violet-500/15 text-violet-900 dark:text-violet-100',
  macro: 'border-slate-500/40 bg-slate-500/15 text-slate-800 dark:text-slate-200',
  user_upload:
    'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100',
};

type Props = {
  tier?: string | null;
  className?: string;
};

/** Honest bol_tier chip for open customs / macro manifest rows (not paid BOL). */
export default function CustomsOpenTierBadge({ tier, className = '' }: Props) {
  const { t } = useI18n();
  const key = (tier ?? 'unknown').toLowerCase();
  const style = TIER_STYLES[key] ?? TIER_STYLES.macro;

  const label =
    key === 'customs_open'
      ? t('מכס פתוח', 'Open customs')
      : key === 'historic'
        ? t('היסטורי', 'Historic')
        : key === 'user_upload'
          ? t('העלאת משתמש', 'User upload')
          : key === 'macro'
            ? t('מאקרו', 'Macro')
            : tier ?? '—';

  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${style} ${className}`}
      title={t(
        'שורת מסחר פתוחה — לא תעודת מטען בתשלום',
        'Open-government trade row — not a paid bill of lading',
      )}
    >
      {label}
    </span>
  );
}
