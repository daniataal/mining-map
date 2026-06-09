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
  const hoverPopupRef = useRef<L.Popup | null>(null);
  const pendingClickRef = useRef<AbortController | null>(null);
  const pointPopupRef = useRef<ReturnType<typeof openPetroleumFeaturePopupOnMap> | null>(null);
  const lastHoverAtRef = useRef(0);

  const { data: osmCatalog } = useOsmPetroleumCatalog(enabled);
  const mvtMode = osmVectorTilesEnabled(osmCatalog);

  const { data: gemData } = useGemPipelineGeoJson(bbox, enabled && loadGemPipelines, mapZoom);
  const { data: osmPipelineData } = useOsmPetroleumLayerGeoJson(
    'pipelines',
    bbox,
    enabled && loadOsmPipelines && !mvtMode,
    mapZoom,
  );
  const { data: osmRefineryData } = useOsmPetroleumLayerGeoJson(
    'refineries',
    bbox,
    enabled && loadOsmRefineries && !mvtMode,
    mapZoom,
  );
  const { data: osmStorageData } = useOsmPetroleumLayerGeoJson(
    'storage_terminals',
    bbox,
    enabled && loadOsmStorage && !mvtMode,
    mapZoom,
  );

  const pipelineFeatures = useMemo(() => {
    const out: GeoJSON.Feature[] = [];
    if (loadGemPipelines) out.push(...(gemData?.features ?? []));
    if (loadOsmPipelines && !mvtMode) out.push(...(osmPipelineData?.features ?? []));
    return out;
  }, [gemData, loadGemPipelines, loadOsmPipelines, mvtMode, osmPipelineData]);

  const refineryFeatures = useMemo(
    () => (loadOsmRefineries && !mvtMode ? (osmRefineryData?.features ?? []) : []),
    [loadOsmRefineries, mvtMode, osmRefineryData],
  );

  const storageFeatures = useMemo(
    () => (loadOsmStorage && !mvtMode ? (osmStorageData?.features ?? []) : []),
    [loadOsmStorage, mvtMode, osmStorageData],
  );

  const hasAnyTarget =
    loadOsmPipelines ||
    loadGemPipelines ||
    loadOsmRefineries ||
    loadOsmStorage;

  useMapEvents({
    mousemove(e) {
      if (!enabled || !hasAnyTarget) {
        hoverPopupRef.current?.remove();
        hoverPopupRef.current = null;
        map.getContainer().style.cursor = '';
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
        hoverPopupRef.current?.remove();
        hoverPopupRef.current = null;
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

      if (!hoverPopupRef.current) {
        hoverPopupRef.current = L.popup({
          closeButton: false,
          autoPan: false,
          className: 'osm-pipeline-hover-tip pipeline-map-hover-tooltip',
          offset: [0, -6],
        });
      }
      hoverPopupRef.current
        .setLatLng(e.latlng)
        .setContent(`<div class="text-xs leading-snug">${labelHtml}</div>`)
        .openOn(map);
    },
    mouseout() {
      hoverPopupRef.current?.remove();
      hoverPopupRef.current = null;
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

      if (!pick) return;

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
        );

        void (async () => {
          const enriched = await enrichOsmSelectionProperties(selection, controller.signal);
          if (controller.signal.aborted) return;
          if (enriched !== selection.properties) {
            pointPopupRef.current?.updateProperties(enriched);
          }
        })();
        return;
      }

      if (!onFeatureClick) return;

      onFeatureClick(selection);

      const layerId = selection.layerId as OsmPetroleumLayerId;
      const needsEnrich =
        pick.kind === 'mvt' ||
        (layerId === 'pipelines' || layerId === 'refineries' || layerId === 'storage_terminals');

      if (!needsEnrich) return;

      void (async () => {
        const enriched = await enrichOsmSelectionProperties(selection, controller.signal);
        if (controller.signal.aborted) return;
        if (enriched !== selection.properties) {
          onFeatureClick({ ...selection, properties: enriched });
        }
      })();
    },
  });

  return null;
}
