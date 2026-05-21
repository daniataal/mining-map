import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Radio, X } from 'lucide-react';
import { getCargoRecord } from '../../api/oilLiveApi';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useI18n } from '../../lib/i18n';
import DealExecutionPack from './DealExecutionPack';
import OilLiveProvenanceBadge from './OilLiveProvenanceBadge';

export type OilLiveEntityKind = 'opportunity' | 'terminal' | 'vessel' | 'company' | 'cargo';

type DrawerTab = 'deal_pack' | 'overview';

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
  const [tab, setTab] = useState<DrawerTab>(resolvedOppId ? 'deal_pack' : 'overview');

  const { data: cargoRecord } = useQuery({
    queryKey: ['oil-live-cargo-record', entityId],
    queryFn: () => getCargoRecord(entityId),
    enabled: entityKind === 'cargo' && Boolean(entityId),
  });

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

      {resolvedOppId && (
        <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-black/5 dark:border-white/10">
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
          <button
            type="button"
            onClick={() => setTab('overview')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
              tab === 'overview'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            {t('סקירה', 'Overview')}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {tab === 'deal_pack' && resolvedOppId ? (
          <DealExecutionPack
            opportunityId={resolvedOppId}
            onOpenRoutePlanner={onOpenRoutePlanner}
            onOpenCompany={onOpenCompany}
            onCreateDealRoom={onCreateDealRoom}
          />
        ) : entityKind === 'cargo' && cargoRecord ? (
          <div className="space-y-3 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <OilLiveProvenanceBadge kind={cargoRecord.data_provenance ?? 'synthetic'} />
              <p className="text-[9px] font-black uppercase text-amber-600">
                {t('מטען סינתטי (BOL-like)', 'Synthetic cargo (BOL-like)')}
              </p>
            </div>
            <p>
              {cargoRecord.shipper_name && (
                <>
                  {t('שולח', 'Shipper')}: <strong>{cargoRecord.shipper_name}</strong>
                  <br />
                </>
              )}
              {cargoRecord.consignee_name && (
                <>
                  {t('נמען', 'Consignee')}: <strong>{cargoRecord.consignee_name}</strong>
                  <br />
                </>
              )}
              {cargoRecord.volume_best_estimate != null && (
                <>
                  {t('נפח', 'Volume')}: {cargoRecord.volume_best_estimate.toLocaleString()}{' '}
                  {cargoRecord.volume_unit ?? 'bbl'}
                  <br />
                </>
              )}
              {cargoRecord.triangulation_score != null && (
                <>
                  {t('מקורות', 'Sources')}: {cargoRecord.triangulation_score}{' '}
                  {t('מסכימים', 'agree')}
                </>
              )}
            </p>
            {cargoRecord.disclaimer && (
              <p className="text-[9px] text-amber-700 dark:text-amber-300">{cargoRecord.disclaimer}</p>
            )}
          </div>
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
