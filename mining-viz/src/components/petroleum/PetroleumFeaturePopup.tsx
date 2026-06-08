import { useQuery } from '@tanstack/react-query';
import {
  buildPetroleumFeatureViewModel,
  collectGemCommercialDetails,
  formatCoordinates,
  petroleumLayerTypeLabel,
} from '../../lib/petroleumFeatureFields';
import { fetchNearestGemPipeline } from '../../lib/infrastructureCoverage';
import CompanyLeadButton from '../popup/CompanyLeadButton';
import type { MiningLicense } from '../../types';
import type { PetroleumLayerId } from '../../lib/petroleumLayers';
import { pipelineSubstancePopupLayerId } from '../../lib/pipelineSubstance';
import { useI18n } from '../../lib/i18n';
import { ExternalLink, MapPin } from 'lucide-react';

const LAYER_ACCENT: Record<
  PetroleumLayerId,
  { badge: string; border: string; dot: string }
> = {
  exploration: {
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    border: 'border-amber-500/25',
    dot: 'bg-amber-400',
  },
  production: {
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    border: 'border-emerald-500/25',
    dot: 'bg-emerald-400',
  },
  bid_rounds: {
    badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    border: 'border-violet-500/25',
    dot: 'bg-violet-400',
  },
  refineries: {
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    border: 'border-orange-500/25',
    dot: 'bg-orange-400',
  },
  oil_pipelines: {
    badge: 'bg-slate-500/20 text-slate-200 border-slate-500/35',
    border: 'border-slate-500/30',
    dot: 'bg-slate-300',
  },
  gas_pipelines: {
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    border: 'border-sky-500/25',
    dot: 'bg-sky-400',
  },
};

const WATER_PIPELINE_ACCENT = {
  badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  border: 'border-cyan-500/25',
  dot: 'bg-cyan-400',
};

interface PetroleumFeaturePopupProps {
  layerId: PetroleumLayerId;
  properties: Record<string, unknown>;
  coordinates?: { lat: number; lng: number } | null;
  onOpenCompanyLead?: (item: MiningLicense) => void;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
        {label}
      </p>
      <p className="text-[12px] font-medium text-slate-100 leading-snug break-words">{value}</p>
    </div>
  );
}

function ExploringCompaniesSection({
  label,
  companies,
  unknownHint,
}: {
  label: string;
  companies: string[];
  unknownHint: string;
}) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        {label}
      </p>
      {companies.length > 0 ? (
        <ul className="space-y-1">
          {companies.map((company) => (
            <li
              key={company}
              className="text-[12px] font-medium text-slate-100 leading-snug break-words"
            >
              {company}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-slate-400 italic">{unknownHint}</p>
      )}
    </div>
  );
}

export default function PetroleumFeaturePopup({
  layerId,
  properties,
  coordinates,
  onOpenCompanyLead,
}: PetroleumFeaturePopupProps) {
  const { t } = useI18n();
  const model = buildPetroleumFeatureViewModel(properties, layerId);
  const accent =
    model.pipelineSubstance === 'water'
      ? WATER_PIPELINE_ACCENT
      : LAYER_ACCENT[
          model.pipelineSubstance != null
            ? pipelineSubstancePopupLayerId(model.pipelineSubstance)
            : layerId
        ] ?? LAYER_ACCENT[layerId];
  const storageLayer =
    String(properties.layer_id ?? '') === 'storage_terminals';
  const layerLabel = storageLayer
    ? t('אחסון', 'Storage')
    : model.pipelineBadgeLabel ?? petroleumLayerTypeLabel(layerId);
  const showExploringSection =
    layerId === 'exploration' || layerId === 'production' || layerId === 'bid_rounds';
  const isOsmPipeline =
    model.isOsmFeature &&
    (layerId === 'oil_pipelines' || layerId === 'gas_pipelines');
  const isOsmPoint =
    model.isOsmFeature &&
    (String(properties.layer_id ?? '') === 'refineries' ||
      String(properties.layer_id ?? '') === 'storage_terminals');
  const showOperatorSection =
    isOsmPipeline || isOsmPoint || (model.operator && !showExploringSection);
  const companiesUnknownHint = model.sourceUrl
    ? t('לא ידוע — ראה מקור', 'Unknown — see source')
    : t('לא ידוע', 'Unknown');
  const operatorMissingHint = t(
    'מפעיל לא מתויג ב-OSM',
    'Operator not tagged in OSM'
  );

  const { data: nearestGem } = useQuery({
    queryKey: ['nearest-gem-pipeline', coordinates?.lat, coordinates?.lng],
    queryFn: () =>
      fetchNearestGemPipeline(coordinates!.lat, coordinates!.lng),
    enabled: isOsmPipeline && coordinates != null,
    staleTime: 120_000,
  });

  const gemEnrichmentRows =
    nearestGem?.found && nearestGem.tags
      ? collectGemCommercialDetails({
          ...nearestGem.tags,
          source: 'gem_goit_oil_ngl_pipelines_march_2025',
        })
      : [];

  const detailRows: { label: string; value: string }[] = [];
  if (model.facilityType && model.facilityType !== layerLabel) {
    detailRows.push({ label: t('סוג', 'Type'), value: model.facilityType });
  }
  if (model.owner && model.owner !== model.operator) {
    detailRows.push({ label: t('בעלים', 'Owner'), value: model.owner });
  }
  for (const row of model.pipelineDetails) {
    detailRows.push(row);
  }
  if (model.country) {
    detailRows.push({ label: t('מדינה', 'Country'), value: model.country });
  }
  if (model.status) {
    detailRows.push({ label: t('סטטוס', 'Status'), value: model.status });
  }
  if (model.sector) {
    detailRows.push({ label: t('סקטור', 'Sector'), value: model.sector });
  }
  if (model.capacity) {
    detailRows.push({ label: t('קיבולת', 'Capacity'), value: model.capacity });
  }
  if (model.source) {
    detailRows.push({ label: t('מקור', 'Source'), value: model.source });
  }
  for (const row of model.extraRows) {
    detailRows.push(row);
  }

  const sourceLinkLabel =
    model.sourceLabel && model.sourceUrl && model.sourceLabel !== model.sourceUrl
      ? model.sourceLabel
      : t('מקור חיצוני', 'View source');

  return (
    <article
      className={`petroleum-map-popup w-[min(100vw-48px,360px)] border-l-2 pl-3 pr-1 ${accent.border}`}
    >
      <header className="mb-3 pr-7">
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${accent.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} aria-hidden />
            {layerLabel}
          </span>
          {model.facilityType && model.facilityType !== layerLabel && (
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-300">
              {model.facilityType}
            </span>
          )}
        </div>
        <h3 className="text-[15px] font-bold leading-snug text-white break-words">
          {model.title}
        </h3>
        {model.subtitle && (
          <p className="mt-1 text-[12px] font-medium text-slate-400 break-words">{model.subtitle}</p>
        )}
      </header>

      {model.description && (
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400 break-words">{model.description}</p>
      )}

      {showExploringSection && (
        <ExploringCompaniesSection
          label={t('חברות חוקרות', 'Exploring companies')}
          companies={model.exploringCompanies}
          unknownHint={companiesUnknownHint}
        />
      )}

      {showOperatorSection && !showExploringSection && (
        <ExploringCompaniesSection
          label={t('מפעיל', 'Operator')}
          companies={
            model.operator
              ? [model.operator]
              : model.exploringCompanies.length > 0
                ? model.exploringCompanies
                : []
          }
          unknownHint={isOsmPipeline ? operatorMissingHint : companiesUnknownHint}
        />
      )}

      {isOsmPipeline && gemEnrichmentRows.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-500/25 bg-amber-950/20 px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90 mb-2">
            {t('GEM GOIT (קרוב)', 'Nearby GEM GOIT (≤2 km)')}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {gemEnrichmentRows.map((row) => {
              const isParty =
                onOpenCompanyLead &&
                (row.label === 'Owner' ||
                  row.label === 'Operator' ||
                  row.label === 'Parent');
              return (
                <div key={`gem-${row.label}-${row.value}`} className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
                    {row.label}
                  </p>
                  {isParty ? (
                    <CompanyLeadButton
                      name={row.value}
                      country={String(model.country || '')}
                      source="gem_goit"
                      onOpenDossier={onOpenCompanyLead}
                      className="text-[12px]"
                    />
                  ) : (
                    <p className="text-[12px] font-medium text-slate-100 break-words">{row.value}</p>
                  )}
                </div>
              );
            })}
          </div>
          {nearestGem?.distance_m != null && (
            <p className="mt-1.5 text-[10px] text-slate-500">
              {t('מרחק', 'Distance')}: ~{Math.round(nearestGem.distance_m)} m
            </p>
          )}
        </div>
      )}

      {detailRows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
          {detailRows.map((row) => (
            <DetailRow key={`${row.label}-${row.value}`} label={row.label} value={row.value} />
          ))}
        </div>
      )}

      <footer className="flex flex-col gap-2 border-t border-white/10 pt-3 mt-1">
        {coordinates && (
          <div className="flex items-start gap-1.5 text-[11px] text-slate-400">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
            <span className="font-mono text-slate-300">
              {formatCoordinates(coordinates.lat, coordinates.lng)}
            </span>
          </div>
        )}
        {model.sourceUrl && (
          <a
            href={model.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-400 hover:text-cyan-300 break-all"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {sourceLinkLabel}
          </a>
        )}
        {model.wikipediaUrl && (
          <a
            href={model.wikipediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-400 hover:text-cyan-300 break-all"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('ויקיפדיה', 'Wikipedia')}
          </a>
        )}
        {model.wikidataUrl && (
          <a
            href={model.wikidataUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-400 hover:text-cyan-300 break-all"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Wikidata
          </a>
        )}
        <p className="text-[9px] uppercase tracking-wide text-slate-600">
          {model.isOsmFeature
            ? t('נתוני קהילה', 'Community layer') + ' · OpenStreetMap'
            : t('נתוני שכבה', 'Compiled layer') + ' · oilmap tileset'}
        </p>
      </footer>
    </article>
  );
}
