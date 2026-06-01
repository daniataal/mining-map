import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  Package,
  Ship,
  ShieldAlert,
  Users,
  Calculator,
  Route,
  CheckCircle2,
  Download,
} from 'lucide-react';
import {
  getOpportunityDealPack,
  type DealExecutionPack as DealPack,
  type MeridianCargoRecord,
} from '../../api/oilLiveApi';
import { getCommodityBenchmarks } from '../../api/commodityBenchmarks';
import { useI18n } from '../../lib/i18n';
import {
  buildRoutePlannerHintsFromCargo,
  type LiveDataRouteHints,
} from './liveDataRoutePrefill';
import { downloadDealPackMarkdown, printDealPack } from './dealPackExport';

export type DealExecutionPackProps = {
  opportunityId: string;
  onClose?: () => void;
  onOpenRoutePlanner?: (hints: Record<string, unknown>) => void;
  onOpenCompanyDossier?: (companyId: string) => void;
  onCreateDealRoom?: () => void;
};

const statusColor: Record<string, string> = {
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-500',
};

type SanctionsTone = 'clear' | 'flagged' | 'review' | 'unknown';

function sanctionsTone(value?: string | null): SanctionsTone {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (v === 'clear') return 'clear';
  if (v === 'flagged' || v === 'sanctioned' || v === 'match') return 'flagged';
  if (v === 'review' || v === 'pep') return 'review';
  return 'unknown';
}

const SANCTIONS_BADGE: Record<SanctionsTone, string> = {
  clear: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  flagged: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  unknown: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
};

function SanctionsChip({ status }: { status?: string | null }) {
  const tone = sanctionsTone(status);
  const label = tone === 'unknown' ? 'unscreened' : tone;
  return (
    <span
      className={`inline-block px-1.5 py-[1px] rounded text-[8px] font-black uppercase tracking-wide ${SANCTIONS_BADGE[tone]}`}
      title={`Sanctions: ${label}`}
    >
      {label}
    </span>
  );
}

function LeiChip({ lei }: { lei?: string | null }) {
  if (!lei) return null;
  return (
    <span
      className="inline-block px-1.5 py-[1px] rounded text-[8px] font-black uppercase tracking-wide bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
      title={`LEI ${lei}`}
    >
      LEI {lei.slice(0, 8)}…
    </span>
  );
}

function hasCounterpartyRisk(mcr?: MeridianCargoRecord | null): boolean {
  if (!mcr) return false;
  return Boolean(
    mcr.shipper_lei ||
      mcr.consignee_lei ||
      mcr.shipper_sanctions_status ||
      mcr.consignee_sanctions_status,
  );
}

export default function DealExecutionPack({
  opportunityId,
  onClose,
  onOpenRoutePlanner,
  onOpenCompanyDossier,
  onCreateDealRoom,
}: DealExecutionPackProps) {
  const { t } = useI18n();
  const { data, isLoading, error } = useQuery({
    queryKey: ['oil-live-deal-pack', opportunityId],
    queryFn: () => getOpportunityDealPack(opportunityId),
    enabled: Boolean(opportunityId),
  });
  const { data: benchmarks } = useQuery({
    queryKey: ['commodity-benchmarks', 'deal-pack'],
    queryFn: () => getCommodityBenchmarks('crude,diesel,jet,gold'),
    staleTime: 300_000,
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

  const routeHints: LiveDataRouteHints = (() => {
    if (pack.route_prefill && Object.keys(pack.route_prefill).length > 0) {
      return {
        ...(pack.route_prefill as LiveDataRouteHints),
        opportunity_id: opportunityId,
      };
    }
    const mcr = pack.cargo_records?.[0];
    if (mcr) return buildRoutePlannerHintsFromCargo(mcr);
    const terminal = pack.terminal as { name?: string; port?: string; country?: string } | undefined;
    const logistics = (pack as { logistics?: { terminal_name?: string; port?: string; country?: string } })
      .logistics;
    return {
      opportunity_id: opportunityId,
      load_port_name: logistics?.port ?? logistics?.terminal_name ?? terminal?.port ?? terminal?.name,
      load_country: logistics?.country ?? (terminal?.country as string | undefined),
      commodity_family: (pack.port_call as { product_family_inferred?: string } | undefined)
        ?.product_family_inferred,
    };
  })();

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

      {(pack.deal_score != null || (pack.source_tiers?.length ?? 0) > 0) && (
        <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              {t('רדאר עסקה', 'Deal Radar')}
            </p>
            {pack.deal_score != null && (
              <span className="text-lg font-black text-emerald-700 dark:text-emerald-300">
                {Math.round(pack.deal_score * 100)}%
              </span>
            )}
          </div>
          {(pack.source_tiers?.length ?? 0) > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {pack.source_tiers!.map((tier) => (
                <span
                  key={tier}
                  className="rounded-full bg-white px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-800 dark:bg-slate-950 dark:text-emerald-200"
                >
                  {tier}
                </span>
              ))}
            </div>
          )}
          {Array.isArray(pack.signal?.why_this_matters) && (
            <ul className="mt-2 list-disc pl-4 text-[10px] leading-relaxed text-slate-600 dark:text-slate-300">
              {(pack.signal!.why_this_matters as string[]).slice(0, 3).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {benchmarks?.benchmarks && benchmarks.benchmarks.length > 0 && (
        <div className="rounded-lg border border-slate-200 dark:border-white/10 p-2 space-y-1">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
            {t('מחירי מדף (ציבורי)', 'Public benchmarks')}
          </p>
          {benchmarks.benchmarks.slice(0, 6).map((b, i) => (
            <p key={i} className="text-[10px] text-slate-600 dark:text-slate-300">
              {b.product ?? b.source}: {b.value != null ? `${b.value} ${b.unit ?? ''}` : '—'}{' '}
              <span className="text-slate-400">({b.tier})</span>
            </p>
          ))}
        </div>
      )}

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

      {pack.cargo_records && pack.cargo_records.length > 0 && hasCounterpartyRisk(pack.cargo_records[0]) && (
        <section className="text-[11px] rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 space-y-1.5">
          <h4 className="text-[10px] font-black uppercase text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" />
            {t('סיכון צד נגדי', 'Counterparty risk')}
          </h4>
          {(() => {
            const mcr = pack.cargo_records![0];
            return (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase text-slate-500 min-w-[58px]">
                    {t('שולח', 'Shipper')}
                  </span>
                  <span className="text-[10px] font-bold text-slate-800 dark:text-slate-100">
                    {mcr.shipper_name ?? '—'}
                  </span>
                  <LeiChip lei={mcr.shipper_lei} />
                  <SanctionsChip status={mcr.shipper_sanctions_status} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase text-slate-500 min-w-[58px]">
                    {t('נמען', 'Consignee')}
                  </span>
                  <span className="text-[10px] font-bold text-slate-800 dark:text-slate-100">
                    {mcr.consignee_name ?? '—'}
                  </span>
                  <LeiChip lei={mcr.consignee_lei} />
                  <SanctionsChip status={mcr.consignee_sanctions_status} />
                </div>
                <p className="text-[9px] text-amber-700 dark:text-amber-300">
                  {t(
                    'מידע משלים — אינו חוסם עסקה אוטומטית. בדוק ב-OpenSanctions / GLEIF.',
                    'Info-only — does not auto-block deal. Verify in OpenSanctions / GLEIF.',
                  )}
                </p>
              </>
            );
          })()}
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
        <button
          type="button"
          className="text-[10px] font-bold uppercase text-violet-600 flex items-center gap-1"
          onClick={() => downloadDealPackMarkdown(pack, opportunityId)}
        >
          <Download className="w-3 h-3" />
          {t('ייצוא MD', 'Export MD')}
        </button>
        <button
          type="button"
          className="text-[10px] font-bold uppercase text-slate-600 flex items-center gap-1"
          onClick={() => printDealPack(pack, opportunityId)}
        >
          {t('הדפס / PDF', 'Print / PDF')}
        </button>
        {onOpenRoutePlanner && (
          <button
            type="button"
            className="text-[10px] font-bold uppercase text-sky-600 flex items-center gap-1"
            onClick={() => onOpenRoutePlanner(routeHints)}
          >
            <Route className="w-3 h-3" /> {t('פתח בתכנון מסלול', 'Open in Route Planner')}
          </button>
        )}
        {onOpenCompanyDossier &&
          pack.cargo_records?.[0]?.shipper_company_id && (
            <button
              type="button"
              className="text-[10px] font-bold uppercase text-slate-600 flex items-center gap-1"
              onClick={() => onOpenCompanyDossier(pack.cargo_records![0].shipper_company_id!)}
            >
              <Users className="w-3 h-3" /> {t('דוסיית שולח', 'Shipper dossier')}
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
