import {
  MiningLicense,
  UserAnnotation,
  EntityRelationship,
  DdReport,
} from '../types';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { useI18n } from '../lib/i18n';
import EntityRelationshipPanel from './EntityRelationshipPanel';
import MaritimeContextPanel from './MaritimeContextPanel';
import PortLogisticsPanel from './PortLogisticsPanel';
import {
  AlertTriangle as LucideAlertTriangle,
  Factory as LucideFactory,
  MapPin as LucideMapPin,
  ShieldCheck as LucideShieldCheck,
  Brain as LucideBrain,
} from 'lucide-react';

interface EsgZone {
  name: string;
  description: string;
}

export interface OperationsTabProps {
  item: MiningLicense;
  annotation: UserAnnotation;
  terminalDetails: MiningLicense;
  commodityListLabel: string;
  volumeUnit: string;
  pipelineStageLabel: string;
  isOilAndGas: boolean;
  isPortLogistics: boolean;
  isStorageTerminal: boolean;
  isLoadingStorageTerminal: boolean;
  isEsgRisk: boolean;
  esgZone: EsgZone | null;
  entityRelationships: EntityRelationship[];
  isLoadingRelationships: boolean;
  relationshipsError: string | null;
  roleSummary: string;
  latestDdReport: DdReport | null;
  isLoadingDdReport: boolean;
  ddLastRunLabel: string | null;
  onOpenIntelligenceTab?: () => void;
}

function OpsSpec({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
      <span
        className={`text-[13px] font-black uppercase tracking-tight ${
          highlight ? 'text-amber-500 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function registryStatusTone(status: string): string {
  const normalized = (status || '').toLowerCase();
  if (normalized.includes('operat') || normalized === 'approved' || normalized === 'active') {
    return 'bg-emerald-500/10 text-emerald-500';
  }
  if (normalized.includes('pending') || normalized.includes('review')) {
    return 'bg-amber-500/10 text-amber-500';
  }
  if (normalized.includes('reject') || normalized.includes('expir') || normalized.includes('suspend')) {
    return 'bg-red-500/10 text-red-500';
  }
  return 'bg-slate-500/10 text-slate-400';
}

function extractOperationalAnalysis(analysis?: string | null): string | null {
  if (!analysis?.trim()) return null;
  const match = analysis.match(/##\s*Operational Analysis\s*([\s\S]*?)(?=\n##\s+|\n#\s+|$)/i);
  const section = match?.[1]?.trim();
  return section || null;
}

function formatCoords(lat?: number | null, lng?: number | null): string {
  if (lat == null || lng == null) return 'Coordinates unavailable';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatGeoSource(item: MiningLicense): string | null {
  if (!item.geoSource) return null;
  const parts = [item.geoSource.replaceAll('-', ' ')];
  if (item.geoApproximated) parts.push('approximate');
  if (item.geoConfidence != null) parts.push(`${Math.round(item.geoConfidence * 100)}% geo confidence`);
  return parts.join(' · ');
}

export default function OperationsTab({
  item,
  annotation,
  terminalDetails,
  commodityListLabel,
  volumeUnit,
  pipelineStageLabel,
  isOilAndGas,
  isPortLogistics,
  isStorageTerminal,
  isLoadingStorageTerminal,
  isEsgRisk,
  esgZone,
  entityRelationships,
  isLoadingRelationships,
  relationshipsError,
  roleSummary,
  latestDdReport,
  isLoadingDdReport,
  ddLastRunLabel,
  onOpenIntelligenceTab,
}: OperationsTabProps) {
  const { t } = useI18n();
  const registryStatus = (item.status || 'Unknown').toString();
  const operationalDd = extractOperationalAnalysis(latestDdReport?.analysis);
  const estimatedVolume = `${annotation.quantity ?? item.capacity ?? 0} ${volumeUnit}`;
  const geoLabel = formatGeoSource(item);
  const operatorFromRoles = entityRelationships.find(
    (rel) => (rel.relationshipType || '').toLowerCase() === 'operator',
  )?.targetName;
  const hasInfrastructurePanel = isPortLogistics || isStorageTerminal || isOilAndGas;
  const hasRoleData = entityRelationships.length > 0 || Boolean(terminalDetails.operatorName);
  const hasDdOperational = Boolean(operationalDd);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-slate-900/50 dark:bg-slate-950/50 border-black/10 dark:border-white/10 rounded-3xl p-6 shadow-lg flex flex-col justify-between min-h-[180px] relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl pointer-events-none" />
          <div>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
              {t('סטטוס רישום', 'Registry operational status')}
            </span>
            <p className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
              {registryStatus}
            </p>
            <p className="text-[10px] text-slate-500 font-bold uppercase mt-2">
              {item.licenseType || 'License'} · {commodityListLabel}
            </p>
          </div>
          <Badge className={`${registryStatusTone(registryStatus)} border-none text-[9px] font-black uppercase tracking-widest mt-4 w-fit`}>
            {item.sector || t('כרייה', 'Mining')}
          </Badge>
        </Card>

        <Card className="bg-slate-900/50 dark:bg-slate-950/50 border-black/10 dark:border-white/10 rounded-3xl p-6 shadow-lg md:col-span-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <OpsSpec label={t('שלב צינור', 'Pipeline stage')} value={pipelineStageLabel} highlight />
            <OpsSpec label={t('נפח מוערך', 'Estimated volume')} value={estimatedVolume} />
            <OpsSpec
              label={t('מיקום', 'Site coordinates')}
              value={formatCoords(item.lat, item.lng)}
            />
            <OpsSpec label={t('אזור', 'Jurisdiction')} value={`${item.region}, ${item.country}`} />
          </div>
          {geoLabel && (
            <p className="text-[10px] text-slate-500 mt-4 pt-4 border-t border-black/5 dark:border-white/5">
              <LucideMapPin className="w-3 h-3 inline mr-1 text-cyan-400" />
              {geoLabel}
            </p>
          )}
        </Card>
      </div>

      {isEsgRisk && esgZone && (
        <Card className="bg-red-500/10 border-red-500/20 rounded-3xl p-6 flex flex-col md:flex-row gap-4 items-start">
          <div className="w-12 h-12 bg-red-500/20 border border-red-500/30 text-red-500 rounded-2xl flex items-center justify-center shrink-0">
            <LucideAlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <Badge className="bg-red-500 text-white border-none text-[9px] font-black mb-2">
              {t('הגבלות תפעול', 'Operational constraints')}
            </Badge>
            <h4 className="text-md font-black text-slate-900 dark:text-white uppercase">
              {esgZone.name}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">{esgZone.description}</p>
          </div>
        </Card>
      )}

      <Card className="bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 rounded-3xl p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] flex items-center gap-3">
            <LucideFactory className="w-4 h-4 text-emerald-500" />
            {t('פרופיל תפעולי', 'Operational profile')}
          </h4>
          {roleSummary && (
            <Badge className="bg-cyan-500/10 text-cyan-400 border-none text-[9px] font-black uppercase tracking-widest">
              {roleSummary}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-8 gap-x-12">
          <OpsSpec label={t('סוג רשיון', 'License type')} value={item.licenseType || '—'} />
          <OpsSpec label={t('סחורה', 'Commodity focus')} value={commodityListLabel} highlight />
          <OpsSpec
            label={t('מפעיל', 'Operator')}
            value={operatorFromRoles || terminalDetails.operatorName || t('לא זוהה', 'Not identified')}
          />
          {terminalDetails.entitySubtype && (
            <OpsSpec
              label={t('סוג תשתית', 'Infrastructure')}
              value={terminalDetails.entitySubtype.replaceAll('_', ' ')}
            />
          )}
          {terminalDetails.capacityText && (
            <OpsSpec label={t('קיבולת', 'Tagged capacity')} value={terminalDetails.capacityText} />
          )}
          {terminalDetails.nearbyPort?.name && (
            <OpsSpec label={t('נמל קרוב', 'Nearest port')} value={terminalDetails.nearbyPort.name} />
          )}
          {item.date && <OpsSpec label={t('תאריך רישום', 'Issued')} value={item.date} />}
          {item.sourceName && (
            <OpsSpec label={t('מקור רשום', 'Registry source')} value={item.sourceName} />
          )}
        </div>

        {isLoadingRelationships ? (
          <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
              {t('טוען תפקידי תפעול', 'Loading operational roles')}
            </p>
          </div>
        ) : (
          <EntityRelationshipPanel
            relationships={entityRelationships}
            emptyTitle={t('אין פיצול תפעולי מאומת', 'No verified operational split yet')}
            emptyMessage={t(
              'כאשר המקור חושף מפעיל/בעלים/מחזיק נפרדים הם יופיעו כאן. עד אז מוצגים רק שדות הרישום.',
              'When the source exposes distinct operator/owner/holder roles they appear here. Until then only registry fields are shown.'
            )}
          />
        )}
        {relationshipsError && (
          <p className="text-[10px] text-red-500 font-bold">{relationshipsError}</p>
        )}
      </Card>

      {isLoadingDdReport && (
        <Card className="bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 rounded-3xl p-6">
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
            {t('טוען ניתוח תפעולי', 'Loading operational intelligence')}
          </p>
        </Card>
      )}

      {!isLoadingDdReport && hasDdOperational && (
        <Card className="bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 rounded-3xl p-6 md:p-8">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h4 className="text-[12px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-3">
              <LucideShieldCheck className="w-4 h-4 text-amber-500" />
              {t('ניתוח תפעולי (AI)', 'Operational analysis (AI)')}
            </h4>
            {ddLastRunLabel && (
              <span className="text-[9px] text-slate-400 font-bold uppercase">{ddLastRunLabel}</span>
            )}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
            {operationalDd}
          </div>
        </Card>
      )}

      {!isLoadingDdReport && !hasDdOperational && onOpenIntelligenceTab && (
        <Card className="bg-black/5 dark:bg-white/5 border-dashed border-black/10 dark:border-white/10 rounded-3xl p-8 text-center space-y-4">
          <LucideBrain className="w-8 h-8 text-amber-500 mx-auto opacity-80" />
          <div>
            <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase">
              {t('אין עדיין ניתוח תפעולי AI', 'No AI operational analysis yet')}
            </h4>
            <p className="text-[11px] text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
              {t(
                'הרץ Due Diligence בלשונית AI כדי לקבל ניתוח סיכון תפעולי, ציות ושרשרת אספקה.',
                'Run Due Diligence from the AI Intelligence tab to generate operational viability, compliance, and supply-chain analysis.'
              )}
            </p>
          </div>
          <Button
            onClick={onOpenIntelligenceTab}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] uppercase tracking-widest h-10 px-6"
          >
            {t('פתח AI Due Diligence', 'Open AI Due Diligence')}
          </Button>
        </Card>
      )}

      {isStorageTerminal && isLoadingStorageTerminal && (
        <Card className="bg-black/5 dark:bg-white/5 rounded-3xl p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
            {t('טוען פרטי מסוף', 'Loading terminal operations')}
          </p>
        </Card>
      )}

      {isPortLogistics && (
        <PortLogisticsPanel item={terminalDetails} section="all" />
      )}

      {isOilAndGas && (
        <MaritimeContextPanel
          query={{
            company: item.company,
            country: item.country,
            commodity: commodityListLabel,
            lat: item.lat,
            lng: item.lng,
          }}
          section="all"
        />
      )}

      {!hasRoleData && !hasInfrastructurePanel && !hasDdOperational && !isEsgRisk && (
        <p className="text-center text-[10px] text-slate-500 font-bold uppercase tracking-widest pb-4">
          {t(
            'מוצגים נתוני רישום בלבד — ייבא רשיון עם מפעיל/קואורדינטות או הרץ DD לעומק נוסף.',
            'Showing registry fields only — import a license with operator/coordinates or run DD for deeper operational context.'
          )}
        </p>
      )}
    </div>
  );
}
