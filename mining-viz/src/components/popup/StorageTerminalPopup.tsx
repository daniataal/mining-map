import { memo, useMemo } from 'react';
import { AlertTriangle, ExternalLink, MapPin } from 'lucide-react';
import { useStorageTerminalDetails } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import {
  buildStorageTerminalPopupModel,
  formatStorageOperatorDisplay,
} from '../../lib/storageTerminalPopup';
import type { MiningLicense } from '../../types';
import AddToDueDiligenceButton from '../AddToDueDiligenceButton';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface StorageTerminalPopupProps {
  item: MiningLicense;
  onOpenDossier?: () => void;
  isInDdQueue?: boolean;
  onAddToDueDiligence?: () => void;
  onRemoveFromDueDiligence?: () => void;
  isEsgRisk?: boolean;
  esgZoneName?: string;
  dealRoomTitle?: string;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
        {label}
      </p>
      <p className="text-[12px] font-medium text-slate-800 dark:text-slate-100 leading-snug break-words">
        {value}
      </p>
    </div>
  );
}

function StorageTerminalPopup({
  item,
  onOpenDossier,
  isInDdQueue = false,
  onAddToDueDiligence,
  onRemoveFromDueDiligence,
  isEsgRisk = false,
  esgZoneName,
  dealRoomTitle,
}: StorageTerminalPopupProps) {
  const { t } = useI18n();
  const { data: storageDetail } = useStorageTerminalDetails(item.id, Boolean(item.id));
  const displayItem = useMemo(
    () => ({ ...item, ...(storageDetail || {}) }),
    [item, storageDetail],
  );
  const model = useMemo(() => buildStorageTerminalPopupModel(displayItem), [displayItem]);

  const operatorMissingHint = t('מפעיל לא מתויג ב-OSM', 'Operator not tagged in OSM');
  const enrichedFromReference = Boolean(model.curatedEnrichmentSourceName);
  const enrichmentLabel =
    model.referenceEnrichmentKind === 'oil_terminal_reference'
      ? t('העשרה מ-DB', 'DB enrichment')
      : model.referenceEnrichmentKind === 'government_open'
        ? t('העשרה ממקור ממשלתי', 'Gov open data')
        : t('העשרה ממקור מובנה', 'Curated enrichment');

  const provenanceParts = [
    t('נתוני קהילה', 'Open data'),
    model.sourceShortLabel,
    enrichedFromReference ? enrichmentLabel : null,
    model.confidencePercent != null
      ? t(`${model.confidencePercent}% תיוג`, `${model.confidencePercent}% tags`)
      : null,
    model.lastSyncedAt
      ? `${t('סונכרן', 'synced')} ${new Date(model.lastSyncedAt).toLocaleDateString()}`
      : null,
  ].filter(Boolean);

  const showSecondaryActions =
    Boolean(onAddToDueDiligence && onRemoveFromDueDiligence) ||
    model.sourceRecordUrl ||
    model.enrichmentSourceUrl;

  return (
    <article className="storage-terminal-popup flex flex-col w-[360px] bg-white dark:bg-slate-950 border border-black/10 dark:border-white/10 overflow-hidden text-slate-800 dark:text-slate-100 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
      <div className="border-l-2 border-orange-500/30 pl-4 pr-4 pt-4 pb-3">
        <header className="mb-3 pr-6">
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <Badge className="text-[8px] font-bold uppercase border border-orange-500/30 bg-orange-500/15 text-orange-300">
              {t('מסוף אחסון', model.badgeLabel)}
            </Badge>
            {model.subtypeLabel && (
              <Badge className="text-[8px] font-bold uppercase border border-white/10 bg-white/5 text-slate-300">
                {model.subtypeLabel}
              </Badge>
            )}
            {enrichedFromReference && (
              <Badge
                title={
                  model.curatedEnrichmentDistanceKm != null
                    ? `Enriched from ${model.curatedEnrichmentSourceName} (~${model.curatedEnrichmentDistanceKm} km)`
                    : `Enriched from ${model.curatedEnrichmentSourceName}`
                }
                className="text-[8px] font-bold uppercase border border-sky-500/30 bg-sky-500/10 text-sky-300"
              >
                {t('העשרה', 'Enriched')}
              </Badge>
            )}
            {isEsgRisk && (
              <Badge
                title={esgZoneName}
                className="bg-red-500/90 text-white border-none text-[8px] font-black uppercase px-2 h-5 flex items-center gap-1"
              >
                <AlertTriangle className="w-3 h-3" aria-hidden />
                {t('סיכון סביבתי', 'ESG risk')}
              </Badge>
            )}
          </div>

          {dealRoomTitle && (
            <Badge className="mb-2 bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25 text-[8px] font-black uppercase max-w-full truncate">
              {t('בחדר עסקאות', 'In Deal Room')}: {dealRoomTitle}
            </Badge>
          )}

          <h3 className="text-[15px] font-bold leading-snug text-slate-900 dark:text-white break-words">
            {model.title}
          </h3>
          {model.subtitle && (
            <p className="mt-1 text-[12px] font-medium text-slate-500 leading-snug break-words">
              {model.subtitle}
            </p>
          )}
        </header>

        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
            {t('מפעיל', 'Operator')}
          </p>
          {model.operatorMissing ? (
            <p className="text-[12px] text-slate-400 italic">{operatorMissingHint}</p>
          ) : (
            <>
              <p className="text-[12px] font-medium text-slate-800 dark:text-slate-100 break-words">
                {model.operator}
              </p>
              {formatStorageOperatorDisplay(displayItem).inferred && (
                <p className="mt-1 text-[10px] text-amber-400/90 leading-snug">
                  {t(
                    'FOIZ מארח מספר מפעילים (VTTI, Vopak, ADNOC…). שיוך לפי פריסת מיכלי OSM — לא בעלות מאומתת למיכל.',
                    'FOIZ hosts multiple operators (VTTI, Vopak, ADNOC, etc.). Label is an inferred zone from OSM layout — not verified per-tank ownership.',
                  )}
                </p>
              )}
            </>
          )}
        </div>

        {model.detailRows.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
            {model.detailRows.map((row) => (
              <DetailRow key={`${row.label}-${row.value}`} label={row.label} value={row.value} />
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Button
            size="sm"
            className="w-full h-10 text-[10px] font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white shadow-lg"
            onClick={onOpenDossier}
          >
            {t('פרטי נכס', 'Open Dossier')}
          </Button>

          {showSecondaryActions && (
            <div
              className={
                (model.sourceRecordUrl ? 1 : 0) +
                  (model.enrichmentSourceUrl ? 1 : 0) +
                  (onAddToDueDiligence ? 1 : 0) >
                1
                  ? 'grid grid-cols-2 gap-2'
                  : ''
              }
            >
              {onAddToDueDiligence && onRemoveFromDueDiligence ? (
                <AddToDueDiligenceButton
                  isInQueue={isInDdQueue}
                  onAdd={onAddToDueDiligence}
                  onRemove={onRemoveFromDueDiligence}
                  compact
                  className={
                    isInDdQueue
                      ? model.sourceRecordUrl || model.enrichmentSourceUrl
                        ? ''
                        : 'w-full'
                      : `bg-transparent border border-amber-500/35 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 shadow-none${
                          model.sourceRecordUrl || model.enrichmentSourceUrl ? '' : ' w-full'
                        }`
                  }
                />
              ) : null}
              {model.enrichmentSourceUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={`h-8 text-[9px] font-black uppercase tracking-widest border-sky-500/25 text-sky-600 dark:text-sky-300 hover:bg-sky-500/10${
                    onAddToDueDiligence ? '' : ' w-full'
                  }`}
                  onClick={() =>
                    window.open(model.enrichmentSourceUrl!, '_blank', 'noopener,noreferrer')
                  }
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1 shrink-0" aria-hidden />
                  {t('מקור מפעיל', 'Operator source')}
                </Button>
              ) : null}
              {model.sourceRecordUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={`h-8 text-[9px] font-black uppercase tracking-widest border-white/10 text-slate-600 dark:text-slate-300 hover:bg-white/5${
                    onAddToDueDiligence || model.enrichmentSourceUrl ? '' : ' w-full'
                  }`}
                  onClick={() => window.open(model.sourceRecordUrl!, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1 shrink-0" aria-hidden />
                  {t('OSM', 'View on OSM')}
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <footer className="mt-4 border-t border-black/5 dark:border-white/10 pt-3 space-y-1.5">
          {model.lat != null && model.lng != null && (
            <div className="flex flex-wrap items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
              <span className="font-mono text-[11px] text-slate-500">
                {model.lat.toFixed(4)}, {model.lng.toFixed(4)}
              </span>
              {model.geoApproximated && (
                <Badge
                  title={
                    model.geoSource
                      ? `Coords approximated via ${model.geoSource}`
                      : 'Coords are an approximation'
                  }
                  className="text-[7px] font-bold uppercase border border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300 px-1.5 h-4"
                >
                  {t('מיקום משוער', 'Approx location')}
                </Badge>
              )}
            </div>
          )}
          <p
            className="text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-600 leading-relaxed"
            title={model.confidenceNote || model.sourceLabel}
          >
            {provenanceParts.join(' · ')}
          </p>
        </footer>
      </div>
    </article>
  );
}

export default memo(StorageTerminalPopup);
