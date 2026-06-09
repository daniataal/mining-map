import type { StsCargoHypothesis, StsEvent, StsLinkedPortCall } from '../../api/stsEventsApi';
import { isStsEventVerified, stsEventHasEnrichment } from '../../api/stsEventsApi';
import { useI18n } from '../../lib/i18n';
import OilLiveProvenanceBadge from './OilLiveProvenanceBadge';
import StsConfidenceBadge from './StsConfidenceBadge';

function tierKind(tier?: string, provenance?: string): string {
  return tier ?? provenance ?? 'inferred';
}

function formatTs(ts?: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function LinkedPortCallLine({ pc }: { pc: StsLinkedPortCall }) {
  const { t } = useI18n();
  return (
    <li className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <OilLiveProvenanceBadge kind={tierKind(pc.bol_tier, pc.data_provenance)} />
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {pc.terminal_name ?? pc.terminal_id ?? '—'}
        </span>
        {pc.role && <span className="text-[8px] uppercase text-slate-400">{pc.role}</span>}
      </div>
      <p className="text-slate-600 dark:text-slate-300">
        {[pc.vessel_name, pc.product_family_inferred].filter(Boolean).join(' · ')}
      </p>
      <p className="text-slate-500">
        {formatTs(pc.arrival_ts)} → {formatTs(pc.departure_ts)}
        {pc.confidence != null && ` · ${Math.round(pc.confidence * 100)}%`}
      </p>
      {pc.disclaimer && (
        <p className="text-[9px] text-amber-700 dark:text-amber-300">{pc.disclaimer}</p>
      )}
      {!pc.disclaimer && pc.bol_tier && (
        <p className="text-[9px] text-amber-700 dark:text-amber-300">
          {t('מסקנה — לא BOL מאומת', 'Inferred — not a verified BOL')}
        </p>
      )}
    </li>
  );
}

function CargoHypothesisLine({ row }: { row: StsCargoHypothesis }) {
  const { t } = useI18n();
  return (
    <li className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <OilLiveProvenanceBadge kind={tierKind(row.bol_tier, row.data_provenance)} />
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {row.commodity_family ?? row.commodity_description ?? t('מטען מסקני', 'Inferred cargo')}
        </span>
        {row.confidence != null && (
          <span className="text-[9px] text-slate-500">{Math.round(row.confidence * 100)}%</span>
        )}
      </div>
      <p className="text-slate-600 dark:text-slate-300">
        {row.shipper_name ?? '—'} → {row.consignee_name ?? row.discharge_hint ?? '—'}
      </p>
      <p className="text-slate-500">
        {[row.load_port_name, row.discharge_hint].filter(Boolean).join(' → ')}
      </p>
      {row.inference_basis && (
        <p className="text-[9px] text-slate-500">
          {t('בסיס', 'Basis')}: {row.inference_basis}
        </p>
      )}
      <p className="text-[9px] text-amber-700 dark:text-amber-300">
        {row.disclaimer ??
          t(
            'היפותזת מטען מסקנית — לא העברה מאומתת',
            'Inferred cargo hypothesis — not a verified transfer',
          )}
      </p>
    </li>
  );
}

type Props = {
  event: StsEvent;
  compact?: boolean;
};

/** Enrichment + verification block for STS events (graceful when backend fields absent). */
export default function StsEnrichmentBlock({ event, compact = false }: Props) {
  const { t } = useI18n();
  const verified = isStsEventVerified(event);
  const hasEnrichment = stsEventHasEnrichment(event);
  const portCalls = event.linked_port_calls ?? [];
  const hypotheses = event.cargo_hypotheses ?? [];

  if (!verified && !hasEnrichment) return null;

  return (
    <div
      className={`space-y-1.5 ${compact ? '' : 'mt-2 pt-2 border-t border-black/5 dark:border-white/10'}`}
    >
      {verified && (
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <StsConfidenceBadge tier="verified" />
            <span className="text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300">
              {t('אימות אנליסט', 'Analyst verified')}
            </span>
          </div>
          {event.verification_notes && (
            <p className="text-[9px] text-slate-600 dark:text-slate-300">{event.verification_notes}</p>
          )}
          {event.verified_at && (
            <p className="text-[9px] text-slate-500">
              {formatTs(event.verified_at)}
              {event.verified_by ? ` · ${event.verified_by}` : ''}
            </p>
          )}
        </div>
      )}

      {event.enrichment_status && event.enrichment_status !== 'none' && (
        <p className="text-[9px] uppercase text-slate-400">
          {t('העשרה', 'Enrichment')}: {event.enrichment_status}
        </p>
      )}

      {portCalls.length > 0 && (
        <div>
          <p className="text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-400 mb-0.5">
            {t('קריאות נמל מקושרות', 'Linked port calls')} ({portCalls.length})
          </p>
          <ul className={`space-y-1.5 ${compact ? '' : 'max-h-32 overflow-y-auto'}`}>
            {portCalls.map((pc, i) => (
              <LinkedPortCallLine key={pc.id ?? `pc-${i}`} pc={pc} />
            ))}
          </ul>
        </div>
      )}

      {hypotheses.length > 0 && (
        <div>
          <p className="text-[9px] font-black uppercase text-amber-600 dark:text-amber-400 mb-0.5">
            {t('השערות מטען', 'Cargo hypotheses')} ({hypotheses.length})
          </p>
          <ul className={`space-y-1.5 ${compact ? '' : 'max-h-32 overflow-y-auto'}`}>
            {hypotheses.map((row, i) => (
              <CargoHypothesisLine key={row.id ?? `cargo-${i}`} row={row} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
