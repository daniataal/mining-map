import { ExternalLink, MapPin, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import CompanyLeadButton from '../../components/popup/CompanyLeadButton';
import {
  buildPetroleumFeatureViewModel,
  collectGemCommercialDetails,
  formatCoordinates,
  isGemPipelineFeature,
  petroleumLayerTypeLabel,
} from '../../lib/petroleumFeatureFields';
import type { MiningLicense } from '../../types';
import {
  INFRASTRUCTURE_BOL_TIER,
  INFRASTRUCTURE_DISCLAIMER_EN,
  INFRASTRUCTURE_DISCLAIMER_HE,
} from '../../lib/infrastructureLayer';
import type { PetroleumLayerId } from '../../lib/petroleumLayers';
import type { OsmPetroleumLayerId } from '../../lib/osmPetroleumLayers';
import { useI18n } from '../../lib/i18n';

export type InfrastructureFeatureSelection = {
  layerId: OsmPetroleumLayerId;
  popupLayerId: PetroleumLayerId;
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry | null;
  coordinates: { lat: number; lng: number } | null;
};

type Props = {
  selection: InfrastructureFeatureSelection;
  onClose: () => void;
  onOpenDossier?: (item: MiningLicense) => void;
};

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

export default function InfrastructureFeatureDrawer({ selection, onClose, onOpenDossier }: Props) {
  const { t } = useI18n();
  const model = buildPetroleumFeatureViewModel(selection.properties, selection.popupLayerId);
  const isGem = isGemPipelineFeature(selection.properties);
  const layerLabel = model.pipelineBadgeLabel ?? petroleumLayerTypeLabel(selection.popupLayerId);
  const infrastructureType = isGem
    ? model.sector
      ? `${model.sector} pipeline`
      : 'Oil/NGL pipeline (GEM GOIT)'
    : selection.properties.man_made != null
      ? String(selection.properties.man_made).replace(/_/g, ' ')
      : selection.layerId.replace(/_/g, ' ');

  const tagRows: { label: string; value: string }[] = [];
  const gemCommercial = collectGemCommercialDetails(selection.properties);
  const operatorRow = gemCommercial.find((r) => r.label.toLowerCase() === 'operator') ?? (
    model.operator ? { label: t('מפעיל', 'Operator'), value: model.operator } : null
  );
  const ownerRow = gemCommercial.find((r) => r.label.toLowerCase() === 'owner') ?? (
    model.owner && model.owner !== model.operator
      ? { label: t('בעלים', 'Owner'), value: model.owner }
      : null
  );

  if (model.capacity) {
    tagRows.push({ label: t('קיבולת', 'Capacity'), value: model.capacity });
  }
  for (const row of gemCommercial) {
    if (onOpenDossier && (row.label.toLowerCase() === 'operator' || row.label.toLowerCase() === 'owner')) {
      continue;
    }
    tagRows.push(row);
  }
  if (model.facilityType && model.facilityType !== layerLabel) {
    tagRows.push({ label: t('סוג', 'Type'), value: model.facilityType });
  }
  for (const row of model.pipelineDetails) {
    if (row.label.toLowerCase() === 'capacity' && model.capacity) continue;
    if (row.label.toLowerCase() === 'operator' && operatorRow) continue;
    if (row.label.toLowerCase() === 'owner' && ownerRow) continue;
    tagRows.push(row);
  }
  if (model.country) tagRows.push({ label: t('מדינה', 'Country'), value: model.country });
  for (const row of model.extraRows) tagRows.push(row);

  const leadCountry = model.country || String(selection.properties.country || '');
  const gemSource = isGem ? String(selection.properties.source || 'gem_goit') : undefined;

  const sourceLinkLabel =
    model.sourceLabel && model.sourceUrl && model.sourceLabel !== model.sourceUrl
      ? model.sourceLabel
      : isGem
        ? t('GEM wiki', 'GEM wiki')
        : t('מקור OSM', 'View on OpenStreetMap');

  return (
    <div className="flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 sm:w-[min(400px,calc(100vw-2rem))]">
      <header className="flex items-start gap-2 border-b border-black/5 px-4 py-3 dark:border-white/10">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex rounded-md border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-orange-700 dark:text-orange-200">
              {layerLabel}
            </span>
            <span className="inline-flex rounded-md border border-slate-500/25 bg-slate-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
              {INFRASTRUCTURE_BOL_TIER}
            </span>
          </div>
          <h2 className="text-base font-bold leading-snug text-slate-900 dark:text-white break-words">
            {model.title}
          </h2>
          {model.subtitle && (
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{model.subtitle}</p>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <DetailRow label={t('סוג תשתית', 'Infrastructure type')} value={infrastructureType} />
        <DetailRow
          label={t('מקור', 'Source')}
          value={
            model.source ??
            (isGem ? 'Global Energy Monitor (CC BY 4.0)' : 'OpenStreetMap (community)')
          }
        />

        {tagRows.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {tagRows.map((row) => (
              <DetailRow key={`${row.label}-${row.value}`} label={row.label} value={row.value} />
            ))}
          </div>
        )}

        {(operatorRow || ownerRow) && onOpenDossier && (
          <div className="space-y-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-300">
              {t('זיהוי מפעיל', 'Operator identity')}
            </p>
            {operatorRow && (
              <p className="text-[12px]">
                <span className="text-slate-500">{operatorRow.label}: </span>
                <CompanyLeadButton
                  name={operatorRow.value}
                  country={leadCountry}
                  source={gemSource}
                  onOpenDossier={onOpenDossier}
                />
              </p>
            )}
            {ownerRow && ownerRow.value !== operatorRow?.value && (
              <p className="text-[12px]">
                <span className="text-slate-500">{ownerRow.label}: </span>
                <CompanyLeadButton
                  name={ownerRow.value}
                  country={leadCountry}
                  source={gemSource}
                  onOpenDossier={onOpenDossier}
                />
              </p>
            )}
          </div>
        )}

        {selection.coordinates && (
          <div className="flex items-start gap-1.5 text-[11px] text-slate-500">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {formatCoordinates(selection.coordinates.lat, selection.coordinates.lng)}
            </span>
          </div>
        )}

        {model.sourceUrl && (
          <a
            href={model.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-600 hover:text-cyan-500 dark:text-cyan-400"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {sourceLinkLabel}
          </a>
        )}

        <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] leading-relaxed text-amber-900/90 dark:text-amber-100/90">
          {t(INFRASTRUCTURE_DISCLAIMER_HE, INFRASTRUCTURE_DISCLAIMER_EN)}
        </p>
      </div>
    </div>
  );
}
