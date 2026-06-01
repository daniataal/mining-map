import { ExternalLink, MapPin, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  buildPetroleumFeatureViewModel,
  formatCoordinates,
  petroleumLayerTypeLabel,
} from '../../lib/petroleumFeatureFields';
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

export default function InfrastructureFeatureDrawer({ selection, onClose }: Props) {
  const { t } = useI18n();
  const model = buildPetroleumFeatureViewModel(selection.properties, selection.popupLayerId);
  const layerLabel = model.pipelineBadgeLabel ?? petroleumLayerTypeLabel(selection.popupLayerId);
  const osmType =
    selection.properties.man_made != null
      ? String(selection.properties.man_made).replace(/_/g, ' ')
      : selection.layerId.replace(/_/g, ' ');

  const tagRows: { label: string; value: string }[] = [];
  if (model.facilityType && model.facilityType !== layerLabel) {
    tagRows.push({ label: t('סוג', 'Type'), value: model.facilityType });
  }
  for (const row of model.pipelineDetails) tagRows.push(row);
  if (model.operator) tagRows.push({ label: t('מפעיל', 'Operator'), value: model.operator });
  if (model.owner && model.owner !== model.operator) {
    tagRows.push({ label: t('בעלים', 'Owner'), value: model.owner });
  }
  if (model.country) tagRows.push({ label: t('מדינה', 'Country'), value: model.country });
  if (model.capacity) tagRows.push({ label: t('קיבולת', 'Capacity'), value: model.capacity });
  for (const row of model.extraRows) tagRows.push(row);

  const sourceLinkLabel =
    model.sourceLabel && model.sourceUrl && model.sourceLabel !== model.sourceUrl
      ? model.sourceLabel
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
        <DetailRow label={t('סוג תשתית', 'Infrastructure type')} value={osmType} />
        <DetailRow
          label={t('מקור', 'Source')}
          value={model.source ?? 'OpenStreetMap (community)'}
        />

        {tagRows.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {tagRows.map((row) => (
              <DetailRow key={`${row.label}-${row.value}`} label={row.label} value={row.value} />
            ))}
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
