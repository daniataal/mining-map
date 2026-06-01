import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Briefcase,
  Bell,
  Bookmark,
  ExternalLink,
  Loader2,
  Radio,
  Route,
  Workflow,
  X,
} from 'lucide-react';
import {
  getCargoRecord,
  getOilOpportunities,
  getOilWatchlists,
  type OilOpportunity,
} from '../../api/oilLiveApi';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useI18n } from '../../lib/i18n';
import { toast } from 'sonner';
import DealExecutionPack from './DealExecutionPack';
import OilLiveProvenanceBadge from './OilLiveProvenanceBadge';
import CompanyImportsExportsTab, {
  type CompanyImportsExportsHighlight,
} from './CompanyImportsExportsTab';
import {
  isOnWatchlist,
  opportunityWatchTarget,
  saveCompanyToSuppliers,
  watchOpportunity,
} from './liveDataWorkflow';
import { buildRoutePlannerHintsFromCargo } from './liveDataRoutePrefill';
import TradingWorkflowPanel from './TradingWorkflowPanel';
import VesselDrawerPanel from './VesselDrawerPanel';
import { tradingWorkflowContextFromEntity } from './tradingWorkflowState';

export type OilLiveEntityKind = 'opportunity' | 'terminal' | 'vessel' | 'company' | 'cargo';

export type OilLiveDrawerTab = 'deal_pack' | 'overview' | 'mcr' | 'imports_exports' | 'workflow';

type DrawerTab = OilLiveDrawerTab;

export interface OilLiveEntityDrawerProps {
  entityKind: OilLiveEntityKind;
  entityId: string;
  /** When set (or when entityKind is opportunity), renders Deal Execution Pack. */
  opportunityId?: string;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onOpenRoutePlanner?: (hints: Record<string, unknown>) => void;
  onOpenCompanyDossier?: (companyId: string) => void;
  onCreateDealRoom?: () => void;
  /**
   * Emitted when the user clicks "Highlight on map" from the Imports & Exports
   * tab. Parent decides what to do (zoom, filter Trade Flow layer, etc.).
   */
  onHighlightOnMap?: (selection: CompanyImportsExportsHighlight) => void;
  /** Open another cargo (MCR) in this same drawer from the I/E tab. */
  onOpenCargo?: (cargoId: string, label?: string) => void;
  /** Map entry: open directly on Trading workflow tab (MAD-46 §8). */
  initialDrawerTab?: OilLiveDrawerTab;
}

function formatVolumeBand(record: {
  volume_low?: number;
  volume_high?: number;
  volume_best_estimate?: number;
  volume_unit?: string;
}): string {
  const unit = record.volume_unit ?? 'bbl';
  if (record.volume_low != null && record.volume_high != null) {
    return `${Math.round(record.volume_low).toLocaleString()}–${Math.round(record.volume_high).toLocaleString()} ${unit}`;
  }
  if (record.volume_best_estimate != null) {
    return `~${Math.round(record.volume_best_estimate).toLocaleString()} ${unit}`;
  }
  return '—';
}

export default function OilLiveEntityDrawer({
  entityKind,
  entityId,
  opportunityId,
  title,
  subtitle,
  onClose,
  onOpenRoutePlanner,
  onOpenCompanyDossier,
  onCreateDealRoom,
  onHighlightOnMap,
  onOpenCargo,
  initialDrawerTab,
}: OilLiveEntityDrawerProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [savingCompanyId, setSavingCompanyId] = useState<string | null>(null);
  const [watchLoading, setWatchLoading] = useState(false);
  const resolvedOppId = opportunityId ?? (entityKind === 'opportunity' ? entityId : undefined);
  const showImportsExportsTab = entityKind === 'company' || entityKind === 'terminal';
  const isVesselDrawer = entityKind === 'vessel';
  const defaultTab: DrawerTab = useMemo(
    () =>
      entityKind === 'cargo'
        ? 'mcr'
        : isVesselDrawer
          ? 'overview'
          : resolvedOppId
            ? 'deal_pack'
            : showImportsExportsTab
              ? 'imports_exports'
              : 'overview',
    [entityKind, isVesselDrawer, resolvedOppId, showImportsExportsTab],
  );
  const [tab, setTab] = useState<DrawerTab>(initialDrawerTab ?? defaultTab);

  useEffect(() => {
    setTab(initialDrawerTab ?? defaultTab);
  }, [entityKind, entityId, initialDrawerTab, defaultTab]);

  const { data: cargoRecord, isLoading: cargoLoading } = useQuery({
    queryKey: ['oil-live-cargo-record', entityId],
    queryFn: () => getCargoRecord(entityId),
    enabled: entityKind === 'cargo' && Boolean(entityId),
  });

  const { data: watchlistsData } = useQuery({
    queryKey: ['oil-live-watchlists'],
    queryFn: async () => (await getOilWatchlists()).watchlists,
    staleTime: 30_000,
  });

  const { data: opportunityRow } = useQuery({
    queryKey: ['oil-live-opportunity-row', resolvedOppId],
    queryFn: async () => {
      const opps = (await getOilOpportunities(0.45)).opportunities;
      return opps.find((o) => o.id === resolvedOppId) ?? null;
    },
    enabled: Boolean(resolvedOppId),
    staleTime: 60_000,
  });

  const cargoOppId = cargoRecord?.opportunity_id ?? resolvedOppId;
  const workflowContext = tradingWorkflowContextFromEntity({
    entityKind,
    entityId,
    opportunityId: resolvedOppId,
    hasEvidence:
      (cargoRecord?.evidence_chain?.length ?? 0) > 0 ||
      (cargoRecord?.sources?.length ?? 0) > 0,
  });
  const watches = watchlistsData ?? [];
  const watchTarget = opportunityRow ? opportunityWatchTarget(opportunityRow) : null;
  const alreadyWatching =
    watchTarget != null && isOnWatchlist(watches, watchTarget.watch_type, watchTarget.watch_ref);

  async function handleSaveCompany(companyId: string, label: string) {
    setSavingCompanyId(companyId);
    try {
      const result = await saveCompanyToSuppliers(companyId);
      if (result.status === 'saved') {
        toast.success(t('נשמר בספקים', 'Saved to Suppliers'), { description: label });
        void queryClient.invalidateQueries({ queryKey: ['oil-live-companies'] });
        void queryClient.invalidateQueries({ queryKey: ['licenses'] });
      } else {
        toast.warning(
          t('ייצוא נכשל — ניתן ליצור ידנית', 'Export failed — use returned payload manually'),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingCompanyId(null);
    }
  }

  async function handleWatchOpportunity(opp: OilOpportunity) {
    setWatchLoading(true);
    try {
      const { already } = await watchOpportunity(opp, watches);
      if (already) {
        toast.info(t('כבר ברשימת מעקב', 'Already on watchlist'));
      } else {
        toast.success(t('נוסף לרשימת מעקב', 'Added to watchlist'));
        void queryClient.invalidateQueries({ queryKey: ['oil-live-watchlists'] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Watch failed');
    } finally {
      setWatchLoading(false);
    }
  }

  return (
    <Card className="flex flex-col h-full min-h-0 bg-stone-50/98 dark:bg-slate-950/95 border border-stone-200/90 dark:border-white/10 rounded-none sm:rounded-l-3xl shadow-2xl overflow-hidden">
      <div className="shrink-0 flex items-start justify-between gap-3 p-4 border-b border-black/5 dark:border-white/10">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-widest text-sky-500 flex items-center gap-1">
            <Radio className="w-3 h-3" />
            {t('נתונים חיים', 'Live Data')}
          </p>
          <h2 className="text-base font-black text-slate-900 dark:text-white truncate">
            {title || entityId}
          </h2>
          {subtitle && <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {resolvedOppId && opportunityRow && watchTarget && (
            <Button
              type="button"
              variant="ghost"
              disabled={watchLoading || alreadyWatching}
              title={
                alreadyWatching
                  ? t('ברשימת מעקב', 'On watchlist')
                  : t('עקוב אחר הזדמנות', 'Watch opportunity')
              }
              onClick={() => void handleWatchOpportunity(opportunityRow)}
              className="h-9 px-2 rounded-full text-violet-600 hover:bg-violet-500/10"
            >
              {watchLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Bell className={`w-4 h-4 ${alreadyWatching ? 'fill-current' : ''}`} />
              )}
            </Button>
          )}
          <Button
            onClick={onClose}
            variant="ghost"
            className="h-9 w-9 p-0 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-black/5 dark:border-white/10 flex-wrap">
          <button
            type="button"
            onClick={() => setTab('workflow')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
              tab === 'workflow'
                ? 'bg-indigo-500 text-white'
                : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <Workflow className="w-3.5 h-3.5" />
            {t('תהליך מסחר', 'Workflow')}
          </button>
          {entityKind === 'cargo' && (
            <button
              type="button"
              onClick={() => setTab('mcr')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
                tab === 'mcr'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {t('מטען MCR', 'MCR detail')}
            </button>
          )}
          {cargoOppId && (
            <button
              type="button"
              onClick={() => setTab('deal_pack')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
                tab === 'deal_pack'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              {t('חבילת עסקה', 'Deal pack')}
            </button>
          )}
          {showImportsExportsTab && (
            <button
              type="button"
              onClick={() => setTab('imports_exports')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
                tab === 'imports_exports'
                  ? 'bg-violet-500 text-white'
                  : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              {t('יבוא ויצוא', 'Imports & Exports')}
            </button>
          )}
          {(isVesselDrawer || (resolvedOppId && entityKind !== 'cargo')) && (
            <button
              type="button"
              onClick={() => setTab('overview')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
                tab === 'overview'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {t('סקירה', 'Overview')}
            </button>
          )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {tab === 'workflow' ? (
          <TradingWorkflowPanel context={workflowContext} />
        ) : tab === 'imports_exports' && showImportsExportsTab ? (
          <CompanyImportsExportsTab
            entityKind={entityKind === 'company' ? 'company' : 'terminal'}
            entityId={entityId}
            entityName={title}
            onHighlightOnMap={onHighlightOnMap}
            onCargoClick={(cargoId) => onOpenCargo?.(cargoId)}
          />
        ) : tab === 'deal_pack' && cargoOppId ? (
          <DealExecutionPack
            opportunityId={cargoOppId}
            onOpenRoutePlanner={onOpenRoutePlanner}
            onOpenCompanyDossier={onOpenCompanyDossier}
            onCreateDealRoom={onCreateDealRoom}
          />
        ) : tab === 'mcr' && entityKind === 'cargo' ? (
          cargoLoading ? (
            <p className="text-[11px] text-slate-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('טוען רשומת מטען…', 'Loading cargo record…')}
            </p>
          ) : cargoRecord ? (
            <div className="space-y-4 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <OilLiveProvenanceBadge kind={cargoRecord.data_provenance ?? 'synthetic'} />
                <span className="text-[9px] font-mono text-amber-700 dark:text-amber-300">
                  {cargoRecord.synthetic_bol_id ?? cargoRecord.id.slice(0, 8)}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('סחורה', 'Commodity')}</dt>
                  <dd className="font-semibold text-slate-800 dark:text-slate-100">
                    {cargoRecord.commodity_family ?? cargoRecord.commodity_description ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('ביטחון', 'Confidence')}</dt>
                  <dd>{Math.round((cargoRecord.confidence ?? 0) * 100)}%</dd>
                </div>
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('שולח', 'Shipper')}</dt>
                  <dd className="font-semibold text-slate-800 dark:text-slate-100">
                    {cargoRecord.shipper_name ?? '—'}
                    {cargoRecord.shipper_company_id && onOpenCompanyDossier && (
                      <button
                        type="button"
                        className="ml-2 text-sky-600 font-bold uppercase text-[9px] inline-flex items-center gap-0.5"
                        onClick={() => onOpenCompanyDossier(cargoRecord.shipper_company_id!)}
                      >
                        <ExternalLink className="w-3 h-3" />
                        {t('דוסייה', 'Dossier')}
                      </button>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('נמען', 'Consignee')}</dt>
                  <dd className="font-semibold text-slate-800 dark:text-slate-100">
                    {cargoRecord.consignee_name ?? cargoRecord.discharge_hint ?? '—'}
                    {cargoRecord.consignee_company_id && onOpenCompanyDossier && (
                      <button
                        type="button"
                        className="ml-2 text-sky-600 font-bold uppercase text-[9px] inline-flex items-center gap-0.5"
                        onClick={() => onOpenCompanyDossier(cargoRecord.consignee_company_id!)}
                      >
                        <ExternalLink className="w-3 h-3" />
                        {t('דוסייה', 'Dossier')}
                      </button>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('נפח', 'Volume')}</dt>
                  <dd>{formatVolumeBand(cargoRecord)}</dd>
                </div>
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('מקורות', 'Sources')}</dt>
                  <dd>
                    {cargoRecord.triangulation_score ?? 0} {t('מסכימים', 'agree')} ·{' '}
                    {cargoRecord.bol_tier ?? 'inferred'}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-slate-400 uppercase font-bold">{t('מסלול', 'Route')}</dt>
                  <dd>
                    {[cargoRecord.load_port_name, cargoRecord.load_country].filter(Boolean).join(', ') || '—'}
                    {' → '}
                    {[cargoRecord.discharge_hint, cargoRecord.discharge_country].filter(Boolean).join(', ') ||
                      '—'}
                  </dd>
                </div>
                {cargoRecord.vessel_name && (
                  <div className="col-span-2">
                    <dt className="text-slate-400 uppercase font-bold">{t('כלי', 'Vessel')}</dt>
                    <dd>
                      {cargoRecord.vessel_name}
                      {cargoRecord.mmsi != null && ` · MMSI ${cargoRecord.mmsi}`}
                    </dd>
                  </div>
                )}
                {cargoRecord.recipe && (
                  <div className="col-span-2">
                    <dt className="text-slate-400 uppercase font-bold">{t('מתכון', 'Recipe')}</dt>
                    <dd className="font-mono text-[9px]">{cargoRecord.recipe}</dd>
                  </div>
                )}
              </dl>

              {(cargoRecord.evidence_chain?.length ?? 0) > 0 && (
                <section>
                  <p className="text-[9px] font-black uppercase text-slate-500 mb-1.5">
                    {t('שרשרת ראיות', 'Evidence chain')}
                  </p>
                  <ul className="text-[10px] text-slate-600 dark:text-slate-300 list-disc pl-4 space-y-1">
                    {cargoRecord.evidence_chain!.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </section>
              )}

              {(cargoRecord.sources?.length ?? 0) > 0 && (
                <section>
                  <p className="text-[9px] font-black uppercase text-slate-500 mb-1.5">
                    {t('מקורות נתונים', 'Data sources')}
                  </p>
                  <ul className="text-[10px] space-y-1">
                    {cargoRecord.sources!.map((src, i) => (
                      <li key={i}>
                        {src.url ? (
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-600 dark:text-sky-400 underline"
                          >
                            {src.name ?? src.url}
                          </a>
                        ) : (
                          src.name ?? '—'
                        )}
                        {src.fetched_at && (
                          <span className="text-slate-400 ml-1">({src.fetched_at})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {cargoRecord.disclaimer && (
                <p className="text-[9px] text-amber-700 dark:text-amber-300">{cargoRecord.disclaimer}</p>
              )}

              {onOpenRoutePlanner && (
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-1.5 min-h-[36px] rounded-lg border border-sky-500/40 text-[10px] font-bold uppercase text-sky-700 dark:text-sky-300 hover:bg-sky-500/10"
                  onClick={() => onOpenRoutePlanner(buildRoutePlannerHintsFromCargo(cargoRecord))}
                >
                  <Route className="w-3.5 h-3.5" />
                  {t('פתח בתכנון מסלול', 'Open in Route Planner')}
                </button>
              )}

              {(cargoRecord.shipper_company_id || cargoRecord.consignee_company_id) && (
                <section className="pt-2 border-t border-black/5 dark:border-white/10 space-y-2">
                  <p className="text-[9px] font-black uppercase text-slate-500">
                    {t('ספקים / צדדים', 'Suppliers / counterparties')}
                  </p>
                  {cargoRecord.shipper_company_id && (
                    <button
                      type="button"
                      disabled={savingCompanyId === cargoRecord.shipper_company_id}
                      onClick={() =>
                        void handleSaveCompany(
                          cargoRecord.shipper_company_id!,
                          cargoRecord.shipper_name ?? 'Shipper',
                        )
                      }
                      className="w-full flex items-center justify-center gap-1.5 min-h-[36px] rounded-lg border border-amber-500/40 text-[10px] font-bold uppercase text-amber-800 dark:text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                    >
                      {savingCompanyId === cargoRecord.shipper_company_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Bookmark className="w-3.5 h-3.5" />
                      )}
                      {t('שמור שולח לספקים', 'Save shipper to Suppliers')}
                    </button>
                  )}
                  {cargoRecord.consignee_company_id && (
                    <button
                      type="button"
                      disabled={savingCompanyId === cargoRecord.consignee_company_id}
                      onClick={() =>
                        void handleSaveCompany(
                          cargoRecord.consignee_company_id!,
                          cargoRecord.consignee_name ?? 'Consignee',
                        )
                      }
                      className="w-full flex items-center justify-center gap-1.5 min-h-[36px] rounded-lg border border-amber-500/40 text-[10px] font-bold uppercase text-amber-800 dark:text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                    >
                      {savingCompanyId === cargoRecord.consignee_company_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Bookmark className="w-3.5 h-3.5" />
                      )}
                      {t('שמור נמען לספקים', 'Save consignee to Suppliers')}
                    </button>
                  )}
                  <p className="text-[9px] text-slate-500">
                    {t(
                      'דורש קישור חברה בגרף — יוצר רישיון + סימון Deal במפה',
                      'Requires linked company in graph — creates license + Deal signal on map',
                    )}
                  </p>
                </section>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-red-500">{t('לא נמצא', 'Not found')}</p>
          )
        ) : entityKind === 'cargo' && cargoRecord ? (
          <div className="space-y-3 text-[11px]">
            <OilLiveProvenanceBadge kind={cargoRecord.data_provenance ?? 'synthetic'} />
            <p>{cargoRecord.shipper_name} → {cargoRecord.consignee_name ?? '—'}</p>
          </div>
        ) : tab === 'deal_pack' && resolvedOppId ? (
          <DealExecutionPack
            opportunityId={resolvedOppId}
            onOpenRoutePlanner={onOpenRoutePlanner}
            onOpenCompanyDossier={onOpenCompanyDossier}
            onCreateDealRoom={onCreateDealRoom}
          />
        ) : isVesselDrawer && tab === 'overview' ? (
          <VesselDrawerPanel
            mmsi={entityId}
            title={title}
            onOpenCargo={onOpenCargo}
            onOpenCompanyDossier={onOpenCompanyDossier}
          />
        ) : (
          <div className="space-y-3 text-[11px] text-slate-500">
            <p>
              {t('סוג ישות', 'Entity type')}: <span className="font-bold uppercase">{entityKind}</span>
            </p>
            <p>
              ID: <span className="font-mono text-[10px]">{entityId}</span>
            </p>
            {!resolvedOppId && (
              <p>
                {t(
                  'חבילת ביצוע עסקה זמינה להזדמנויות בלבד',
                  'Deal execution pack is available for opportunities only',
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
