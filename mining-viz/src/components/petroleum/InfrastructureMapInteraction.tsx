import { useMemo, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useGemPipelineGeoJson } from '../../lib/gemPipelines';
import {
  useOsmPetroleumCatalog,
  useOsmPetroleumLayerGeoJson,
} from '../../lib/osmPetroleumLayers';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';
import type { OsmPetroleumLayerId } from '../../lib/osmPetroleumLayers';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';
import { osmVectorTilesEnabled } from '../../lib/osmPetroleumVectorTiles';
import {
  enrichOsmSelectionProperties,
  enrichPipelineSelectionWithNearestGem,
  getRegisteredOsmMvtMaplibreMap,
  hoverHtmlForOsmFeature,
  infrastructureSelectionUsesPopup,
  markMapFeatureClickHandled,
  pickInfrastructureAtClick,
  selectionFromInfrastructurePick,
} from '../../lib/infrastructureMapInteraction';
import { openPetroleumFeaturePopupOnMap } from './bindPetroleumPopup';
import { buildPipelineHoverSummary } from '../../lib/petroleumFeatureFields';
import { escapeHtml } from '../../lib/htmlUtils';
import type { MiningLicense } from '../../types';
import { findNearestStorageTerminal } from '../../lib/storageTankFarmsLayer';
import { enrichSelectionWithMaterializedPopup } from '../../lib/mapFeaturePopup';

export interface InfrastructureMapInteractionProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  mapZoom?: number;
  loadOsmPipelines: boolean;
  loadGemPipelines: boolean;
  loadOsmRefineries: boolean;
  loadOsmStorage: boolean;
  storageEntities?: MiningLicense[];
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
  onStorageTerminalSelect?: (item: MiningLicense) => void;
  /** Close the infrastructure drawer when opening a point popup. */
  onDismissInfrastructureFeature?: () => void;
}

function escapeHtmlText(value: string): string {
  return escapeHtml(value);
}

const HOVER_THROTTLE_MS = 48;

/**
 * Single map-level interaction owner for OSM MVT + GeoJSON + GEM infrastructure.
 * Leaflet events → MVT queryRenderedFeatures → GeoJSON geom fallback → drawer.
 */
export default function InfrastructureMapInteraction({
  bbox,
  enabled,
  mapZoom,
  loadOsmPipelines,
  loadGemPipelines,
  loadOsmRefineries,
  loadOsmStorage,
  storageEntities = [],
  onFeatureClick,
  onStorageTerminalSelect,
  onDismissInfrastructureFeature,
}: InfrastructureMapInteractionProps) {
  const map = useMap();
  const hoverTooltipRef = useRef<L.Tooltip | null>(null);
  const pendingClickRef = useRef<AbortController | null>(null);
  const pointPopupRef = useRef<ReturnType<typeof openPetroleumFeaturePopupOnMap> | null>(null);
  const stickyPopupOpenRef = useRef(false);
  const lastHoverAtRef = useRef(0);

  const { data: osmCatalog } = useOsmPetroleumCatalog(enabled);
  const mvtMode = osmVectorTilesEnabled(osmCatalog);

  const { data: gemData } = useGemPipelineGeoJson(bbox, enabled && loadGemPipelines, mapZoom);
  const pickFallbackEnabled = enabled && Boolean(bbox);
  const { data: osmPipelineData } = useOsmPetroleumLayerGeoJson(
    'pipelines',
    bbox,
    pickFallbackEnabled && loadOsmPipelines,
    mapZoom,
  );
  const { data: osmRefineryData } = useOsmPetroleumLayerGeoJson(
    'refineries',
    bbox,
    pickFallbackEnabled && loadOsmRefineries,
    mapZoom,
  );
  const { data: osmStorageData } = useOsmPetroleumLayerGeoJson(
    'storage_terminals',
    bbox,
    pickFallbackEnabled && loadOsmStorage,
    mapZoom,
  );

  const pipelineFeatures = useMemo(() => {
    const out: GeoJSON.Feature[] = [];
    if (loadGemPipelines) out.push(...(gemData?.features ?? []));
    if (loadOsmPipelines) out.push(...(osmPipelineData?.features ?? []));
    return out;
  }, [gemData, loadGemPipelines, loadOsmPipelines, osmPipelineData]);

  const refineryFeatures = useMemo(
    () => (loadOsmRefineries ? (osmRefineryData?.features ?? []) : []),
    [loadOsmRefineries, osmRefineryData],
  );

  const storageFeatures = useMemo(
    () => (loadOsmStorage ? (osmStorageData?.features ?? []) : []),
    [loadOsmStorage, osmStorageData],
  );

  const hasAnyTarget =
    loadOsmPipelines ||
    loadGemPipelines ||
    loadOsmRefineries ||
    loadOsmStorage;

  useMapEvents({
    mousemove(e) {
      if (!enabled || !hasAnyTarget || stickyPopupOpenRef.current) {
        hoverTooltipRef.current?.remove();
        hoverTooltipRef.current = null;
        if (!stickyPopupOpenRef.current) map.getContainer().style.cursor = '';
        return;
      }

      const now = performance.now();
      if (now - lastHoverAtRef.current < HOVER_THROTTLE_MS) return;
      lastHoverAtRef.current = now;

      const pick = pickInfrastructureAtClick({
        mvtMap: getRegisteredOsmMvtMaplibreMap(),
        leafletEvent: e,
        mvtMode,
        pipelineFeatures,
        refineryFeatures,
        storageFeatures,
        mapZoom,
        loadPipelines: loadOsmPipelines || loadGemPipelines,
        loadRefineries: loadOsmRefineries,
        loadStorage: loadOsmStorage,
      });

      if (!pick) {
        hoverTooltipRef.current?.remove();
        hoverTooltipRef.current = null;
        map.getContainer().style.cursor = '';
        return;
      }

      map.getContainer().style.cursor = 'pointer';
      let labelHtml = '';
      if (pick.kind === 'mvt') {
        const props = (pick.feature.properties ?? {}) as Record<string, unknown>;
        labelHtml = hoverHtmlForOsmFeature(props, pick.layerId);
      } else if (pick.kind === 'point') {
        const props = (pick.pick.feature.properties ?? {}) as Record<string, unknown>;
        labelHtml = hoverHtmlForOsmFeature(props, pick.pick.layerId);
      } else {
        const summary = buildPipelineHoverSummary(
          (pick.pick.feature.properties ?? {}) as Record<string, unknown>,
        );
        labelHtml = `<span class="font-semibold">${escapeHtmlText(summary.title)}</span>${
          summary.subtitle
            ? `<br/><span class="text-slate-300/90">${escapeHtmlText(summary.subtitle)}</span>`
            : ''
        }`;
      }

      if (!hoverTooltipRef.current) {
        hoverTooltipRef.current = L.tooltip({
          sticky: true,
          opacity: 1,
          className: 'osm-pipeline-hover-tip pipeline-map-hover-tooltip',
          direction: 'top',
          offset: [0, -6],
        });
      }
      hoverTooltipRef.current
        .setLatLng(e.latlng)
        .setContent(`<div class="text-xs leading-snug">${labelHtml}</div>`)
        .addTo(map);
    },
    mouseout() {
      if (stickyPopupOpenRef.current) return;
      hoverTooltipRef.current?.remove();
      hoverTooltipRef.current = null;
      map.getContainer().style.cursor = '';
    },
    click(e) {
      if (!enabled || !hasAnyTarget) return;
      if (!onFeatureClick && !loadOsmRefineries && !loadOsmStorage) return;

      const pick = pickInfrastructureAtClick({
        mvtMap: getRegisteredOsmMvtMaplibreMap(),
        leafletEvent: e,
        mvtMode,
        pipelineFeatures,
        refineryFeatures,
        storageFeatures,
        mapZoom,
        loadPipelines: loadOsmPipelines || loadGemPipelines,
        loadRefineries: loadOsmRefineries,
        loadStorage: loadOsmStorage,
      });

      if (!pick) {
        onDismissInfrastructureFeature?.();
        pointPopupRef.current?.close();
        pointPopupRef.current = null;
        return;
      }

      L.DomEvent.stopPropagation(e);
      markMapFeatureClickHandled(e);

      const click = { lat: e.latlng.lat, lng: e.latlng.lng };
      const selection = selectionFromInfrastructurePick(pick, click);

      pendingClickRef.current?.abort();
      const controller = new AbortController();
      pendingClickRef.current = controller;

      if (infrastructureSelectionUsesPopup(selection)) {
        if (
          selection.popupLayerId === 'storage_terminals' &&
          storageEntities.length > 0 &&
          onStorageTerminalSelect
        ) {
          const nearest = findNearestStorageTerminal(
            storageEntities,
            e.latlng.lat,
            e.latlng.lng,
          );
          if (nearest) {
            onDismissInfrastructureFeature?.();
            pointPopupRef.current?.close();
            onStorageTerminalSelect(nearest);
            return;
          }
        }

        onDismissInfrastructureFeature?.();
        pointPopupRef.current?.close();
        hoverTooltipRef.current?.remove();
        hoverTooltipRef.current = null;
        stickyPopupOpenRef.current = true;
        const latlng =
          selection.coordinates != null
            ? L.latLng(selection.coordinates.lat, selection.coordinates.lng)
            : e.latlng;
        pointPopupRef.current = openPetroleumFeaturePopupOnMap(
          map,
          latlng,
          selection.popupLayerId,
          selection.properties,
          selection.coordinates,
          () => {
            stickyPopupOpenRef.current = false;
            pointPopupRef.current = null;
          },
        );

        void (async () => {
          let enriched = await enrichSelectionWithMaterializedPopup(selection, controller.signal);
          if (controller.signal.aborted) return;
          enriched = await enrichOsmSelectionProperties(
            { ...selection, properties: enriched },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (
            selection.popupLayerId === 'storage_terminals' &&
            storageEntities.length > 0 &&
            !String(enriched.operator ?? enriched.Operator ?? '').trim()
          ) {
            const nearest = findNearestStorageTerminal(
              storageEntities,
              e.latlng.lat,
              e.latlng.lng,
            );
            const fusedOperator = nearest?.operatorName?.trim();
            if (fusedOperator) {
              enriched = {
                ...enriched,
                operator: fusedOperator,
                operatorName: fusedOperator,
                fused_from_curated: nearest?.id,
              };
            }
          }
          if (enriched !== selection.properties) {
            pointPopupRef.current?.updateProperties(enriched);
          }
        })();
        return;
      }

      if (!onFeatureClick) return;

      hoverTooltipRef.current?.remove();
      hoverTooltipRef.current = null;

      void (async () => {
        let props = await enrichSelectionWithMaterializedPopup(selection, controller.signal);
        if (controller.signal.aborted) return;
        let resolved = { ...selection, properties: props };
        if (selection.layerId === 'pipelines' && !props.materialized_popup) {
          resolved = await enrichPipelineSelectionWithNearestGem(resolved, controller.signal);
          props = resolved.properties;
        }
        if (controller.signal.aborted) return;
        onFeatureClick(resolved);

        const layerId = resolved.layerId as OsmPetroleumLayerId;
        const needsEnrich =
          pick.kind === 'mvt' ||
          (layerId === 'pipelines' || layerId === 'refineries' || layerId === 'storage_terminals');

        if (!needsEnrich) return;

        const enriched = await enrichOsmSelectionProperties(resolved, controller.signal);
        if (controller.signal.aborted) return;
        if (enriched !== resolved.properties) {
          onFeatureClick({ ...resolved, properties: enriched });
        }
      })();
    },
  });

  return null;
}
