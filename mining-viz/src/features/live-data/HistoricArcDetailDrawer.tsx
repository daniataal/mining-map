import { Archive, ExternalLink, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  EIA_HISTORIC_BOL_TIER,
  EIA_HISTORIC_DISCLAIMER_EN,
  EIA_HISTORIC_DISCLAIMER_HE,
  enrichHistoricArc,
  historicArcRouteLabels,
  type EnrichedHistoricArc,
} from '../../lib/eiaHistoricLayer';
import type { EiaHistoricMapArc } from '../../api/eiaHistoricApi';
import { useI18n } from '../../lib/i18n';

export type HistoricArcSelection = {
  arc: EiaHistoricMapArc;
  year: number;
};

function formatBbl(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '—';
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B bbl`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M bbl`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(0)}K bbl`;
  return `${Math.round(val)} bbl`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-[12px] font-medium leading-snug text-slate-800 break-words dark:text-slate-100">
        {value}
      </p>
    </div>
  );
}

type Props = {
  selection: HistoricArcSelection;
  onClose: () => void;
};

export default function HistoricArcDetailDrawer({ selection, onClose }: Props) {
  const { t } = useI18n();
  const enriched: EnrichedHistoricArc = enrichHistoricArc(selection.arc, selection.year);
  const { originLabel, dischargeLabel } = historicArcRouteLabels(selection.arc);

  return (
    <div className="flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-violet-500/30 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-violet-400/20 dark:bg-slate-950/95 sm:w-[min(400px,calc(100vw-2rem))]">
      <header className="flex items-start gap-2 border-b border-black/5 px-4 py-3 dark:border-white/10">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Archive className="h-4 w-4 text-violet-500" aria-hidden />
            <span className="inline-flex rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-200">
              {EIA_HISTORIC_BOL_TIER}
            </span>
          </div>
          <h2 className="text-base font-bold leading-snug text-slate-900 dark:text-white">
            {originLabel} → {dischargeLabel}
          </h2>
          <p className="mt-0.5 text-[11px] capitalize text-slate-500 dark:text-slate-400">
            {selection.arc.commodity_family} · {selection.year}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <DetailRow label={t('מקור', 'Source')} value={enriched.source} />
          <DetailRow label={t('תקופה', 'Period')} value={enriched.period} />
          <DetailRow label={t('מוצר', 'Product')} value={selection.arc.commodity_family} />
          <DetailRow label={t('bol_tier', 'bol_tier')} value={enriched.bol_tier} />
          <DetailRow label={t('מקור (מדינה)', 'Origin')} value={originLabel} />
          <DetailRow label={t('יעד', 'Destination')} value={dischargeLabel} />
          <DetailRow label={t('נפח', 'Volume')} value={formatBbl(selection.arc.volume_bbl)} />
          <DetailRow label={t('ביטחון', 'Confidence')} value={enriched.confidence} />
        </div>

        <p
          className="rounded-lg border border-violet-500/25 bg-violet-500/8 px-2.5 py-2 text-[11px] leading-relaxed text-violet-950 dark:text-violet-100"
          role="note"
        >
          {t(EIA_HISTORIC_DISCLAIMER_HE, EIA_HISTORIC_DISCLAIMER_EN)}
        </p>

        <a
          href={enriched.source_record_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-600 hover:underline dark:text-sky-400"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('אמת במקור (EIA)', 'Verify at source (EIA)')}
        </a>
      </div>
    </div>
  );
}
