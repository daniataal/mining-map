import { useI18n } from '../../lib/i18n';

export type OilLiveProvenanceKind = 'seed_port_calls' | 'synthetic' | 'live_ais' | string;

const STYLES: Record<string, { bg: string; text: string; labelEn: string; labelHe: string }> = {
  seed_port_calls: {
    bg: 'bg-violet-500/15',
    text: 'text-violet-800 dark:text-violet-200',
    labelEn: 'Seed port calls',
    labelHe: 'קריאות נמל מזרע',
  },
  synthetic: {
    bg: 'bg-amber-500/15',
    text: 'text-amber-800 dark:text-amber-200',
    labelEn: 'Synthetic',
    labelHe: 'סינתטי',
  },
  live_ais: {
    bg: 'bg-sky-500/15',
    text: 'text-sky-800 dark:text-sky-200',
    labelEn: 'Live AIS',
    labelHe: 'AIS חי',
  },
};

type Props = {
  kind?: OilLiveProvenanceKind | null;
  className?: string;
};

export default function OilLiveProvenanceBadge({ kind, className = '' }: Props) {
  const { t } = useI18n();
  if (!kind || kind === 'unknown') return null;
  const style = STYLES[kind] ?? {
    bg: 'bg-slate-500/10',
    text: 'text-slate-600 dark:text-slate-300',
    labelEn: kind,
    labelHe: kind,
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wide ${style.bg} ${style.text} ${className}`}
    >
      {t(style.labelHe, style.labelEn)}
    </span>
  );
}
