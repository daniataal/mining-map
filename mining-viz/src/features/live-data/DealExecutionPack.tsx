import { useQuery } from '@tanstack/react-query';
import { Loader2, Package, Ship, Users, Calculator, Route, CheckCircle2 } from 'lucide-react';
import { getOpportunityDealPack, type DealExecutionPack as DealPack } from '../../api/oilLiveApi';
import { useI18n } from '../../lib/i18n';

export type DealExecutionPackProps = {
  opportunityId: string;
  onClose?: () => void;
  onOpenRoutePlanner?: (hints: Record<string, unknown>) => void;
  onOpenCompany?: (companyId: string) => void;
  onCreateDealRoom?: () => void;
};

const statusColor: Record<string, string> = {
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-500',
};

export default function DealExecutionPack({
  opportunityId,
  onClose,
  onOpenRoutePlanner,
  onOpenCompany,
  onCreateDealRoom,
}: DealExecutionPackProps) {
  const { t } = useI18n();
  const { data, isLoading, error } = useQuery({
    queryKey: ['oil-live-deal-pack', opportunityId],
    queryFn: () => getOpportunityDealPack(opportunityId),
    enabled: Boolean(opportunityId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('טוען חבילת ביצוע…', 'Loading deal pack…')}
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="p-4 text-sm text-red-500">
        {error instanceof Error ? error.message : t('לא נמצא', 'Not found')}
      </p>
    );
  }

  const pack = data as DealPack;

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-white dark:bg-slate-900 shadow-xl p-4 max-w-md space-y-4">
      <div className="flex justify-between items-start gap-2">
        <div>
          <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">
            {t('חבילת ביצוע עסקה', 'Deal Execution Pack')}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">{pack.title}</p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-black text-amber-500">{pack.readiness_pct}%</span>
          <p className="text-[9px] uppercase font-bold text-slate-400">{t('מוכנות', 'Readiness')}</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xs">
            ✕
          </button>
        )}
      </div>

      <p className="text-[10px] text-amber-800 dark:text-amber-200">{pack.disclaimer}</p>

      <ul className="space-y-2">
        {pack.checklist?.map((item) => (
          <li key={item.id} className="flex gap-2 text-[11px]">
            <CheckCircle2 className={`w-4 h-4 shrink-0 ${statusColor[item.status] ?? 'text-slate-400'}`} />
            <span>
              <span className="font-bold">{item.label}</span>
              {item.detail && <span className="text-slate-500"> — {item.detail}</span>}
            </span>
          </li>
        ))}
      </ul>

      {pack.cargo_records && pack.cargo_records.length > 0 && (
        <section>
          <h4 className="text-[10px] font-black uppercase text-slate-500 flex items-center gap-1 mb-2">
            <Package className="w-3 h-3" />
            {t('מטען סינתטי (BOL)', 'Synthetic cargo (BOL-like)')}
          </h4>
          {pack.cargo_records.slice(0, 3).map((mcr) => (
            <div key={mcr.id} className="text-[11px] border rounded-lg p-2 mb-1 border-black/5 dark:border-white/10">
              <span className="font-mono text-[10px]">{mcr.synthetic_bol_id}</span>
              <br />
              {mcr.shipper_name} → {mcr.consignee_name ?? '—'}
              <br />
              {mcr.commodity_family} · {Math.round((mcr.confidence ?? 0) * 100)}% · {mcr.triangulation_score}{' '}
              {t('מקורות', 'sources')}
            </div>
          ))}
        </section>
      )}

      {pack.port_call && (
        <section className="text-[11px] flex gap-2 items-start">
          <Ship className="w-4 h-4 text-sky-500 shrink-0" />
          <span>{t('תנועה', 'Movement')}: {(pack.port_call as { event_type?: string }).event_type}</span>
        </section>
      )}

      {pack.economics && (
        <section className="text-[11px] flex gap-2 items-start">
          <Calculator className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>
            {t('כלכלת עסקה', 'Economics')}:{' '}
            {(pack.economics as { result?: { complete?: boolean } }).result?.complete
              ? t('הושלם', 'Complete')
              : t('חסר', 'Incomplete')}
          </span>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {onOpenRoutePlanner && (
          <button
            type="button"
            className="text-[10px] font-bold uppercase text-sky-600 flex items-center gap-1"
            onClick={() => onOpenRoutePlanner({ opportunity_id: opportunityId })}
          >
            <Route className="w-3 h-3" /> {t('תכנון מסלול', 'Route planner')}
          </button>
        )}
        {onOpenCompany && pack.terminal && (
          <button
            type="button"
            className="text-[10px] font-bold uppercase text-slate-600 flex items-center gap-1"
            onClick={() => onOpenCompany(String((pack.terminal as { id?: string }).id ?? ''))}
          >
            <Users className="w-3 h-3" /> {t('דוסייה', 'Dossier')}
          </button>
        )}
        {onCreateDealRoom && (
          <button
            type="button"
            className="text-[10px] font-bold uppercase text-emerald-600"
            onClick={onCreateDealRoom}
          >
            {t('חדר עסקה', 'Deal room')}
          </button>
        )}
      </div>
    </div>
  );
}
