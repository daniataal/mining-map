import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Loader2, Radio, X } from 'lucide-react';
import { getCargoRecord } from '../../api/oilLiveApi';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useI18n } from '../../lib/i18n';
import DealExecutionPack from './DealExecutionPack';
import OilLiveProvenanceBadge from './OilLiveProvenanceBadge';

export type OilLiveEntityKind = 'opportunity' | 'terminal' | 'vessel' | 'company' | 'cargo';

type DrawerTab = 'deal_pack' | 'overview' | 'mcr';

export interface OilLiveEntityDrawerProps {
  entityKind: OilLiveEntityKind;
  entityId: string;
  /** When set (or when entityKind is opportunity), renders Deal Execution Pack. */
  opportunityId?: string;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onOpenRoutePlanner?: (hints: Record<string, unknown>) => void;
  onOpenCompany?: (companyId: string) => void;
  onCreateDealRoom?: () => void;
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
  onOpenCompany,
  onCreateDealRoom,
}: OilLiveEntityDrawerProps) {
  const { t } = useI18n();
  const resolvedOppId = opportunityId ?? (entityKind === 'opportunity' ? entityId : undefined);
  const defaultTab: DrawerTab =
    entityKind === 'cargo' ? 'mcr' : resolvedOppId ? 'deal_pack' : 'overview';
  const [tab, setTab] = useState<DrawerTab>(defaultTab);

  const { data: cargoRecord, isLoading: cargoLoading } = useQuery({
    queryKey: ['oil-live-cargo-record', entityId],
    queryFn: () => getCargoRecord(entityId),
    enabled: entityKind === 'cargo' && Boolean(entityId),
  });

  const cargoOppId = cargoRecord?.opportunity_id ?? resolvedOppId;

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
        <Button
          onClick={onClose}
          variant="ghost"
          className="h-9 w-9 p-0 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-white shrink-0"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {(resolvedOppId || entityKind === 'cargo') && (
        <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-black/5 dark:border-white/10 flex-wrap">
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
          {resolvedOppId && entityKind !== 'cargo' && (
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
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {tab === 'deal_pack' && cargoOppId ? (
          <DealExecutionPack
            opportunityId={cargoOppId}
            onOpenRoutePlanner={onOpenRoutePlanner}
            onOpenCompany={onOpenCompany}
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
                  <dd>{cargoRecord.shipper_name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('נמען', 'Consignee')}</dt>
                  <dd>{cargoRecord.consignee_name ?? cargoRecord.discharge_hint ?? '—'}</dd>
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
            onOpenCompany={onOpenCompany}
            onCreateDealRoom={onCreateDealRoom}
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
