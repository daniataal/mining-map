import { lazy, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import {
    MapContainer,
    useMap,
    LayersControl,
    useMapEvents,
    Marker,
    Popup,
    GeoJSON,
    ZoomControl,
    Tooltip,
    Polyline,
    CircleMarker,
    FeatureGroup,
    Circle,
    LayerGroup,
} from 'react-leaflet';
// @ts-ignore
import MarkerClusterGroup from 'react-leaflet-cluster';
import { useLeafletContext } from '@react-leaflet/core';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import { ChevronDown, ChevronUp, Loader2, Radar, RefreshCw, Ship } from 'lucide-react';
import { MiningLicense, UserAnnotation, MaritimeVessel, MaritimeViewportBounds, MaritimeVesselScope, OilAndGasDisplayMode } from '../types';
import { getCountryBorders, useMaritimeVessels } from '../lib/api';
import {
  applyVesselFilters,
  CanvasVesselLayer,
  clearMaritimeSnapshotCache,
  filterVesselsByViewport,
  MARITIME_INCLUDE_COASTAL_DEMO_LOCALSTORAGE_KEY,
  MARITIME_INCLUDE_GULF_DEMO_LOCALSTORAGE_KEY,
  sortVesselsForDisplay,
  toVesselDrawRecords,
  planVesselLodDraw,
  LOD_FULL_DETAIL_ZOOM,
  VESSEL_SHIP_TYPE_OPTIONS,
  MARITIME_LEGEND_KEYS,
  VESSEL_CATEGORY_COLORS,
  VESSEL_LEGEND_T,
  type VesselFilters,
} from '../lib/vessels';
import { buildMaritimeStatusMessages } from '../lib/vessels/maritimeFeedStatus';
import MaritimeLayerSync from './vessels/MaritimeLayerSync';
import CanvasVesselMarkers from './vessels/CanvasVesselMarkers';
import PetroleumMapLayers from './petroleum/PetroleumMapLayers';
import OsmPetroleumMapLayers from './petroleum/OsmPetroleumMapLayers';
import StorageTankFarmsMapLayer from './petroleum/StorageTankFarmsMapLayer';
import OilLiveMapOverlays, {
  type OilLiveEntityClickPayload,
  type OilLiveLayerVisibility,
} from './petroleum/OilLiveMapOverlays';
import LiveDataMapLayersPanel from '../features/live-data/LiveDataMapLayersPanel';
import EiaHistoricMapLayer from '../features/live-data/EiaHistoricMapLayer';
import MacroTradeFlowsMapLayer from '../features/live-data/MacroTradeFlowsMapLayer';
import type { EiaHistoricMapArc, EiaHistoricMapOrigin } from '../api/eiaHistoricApi';
import type { MacroTradeFlow } from '../api/oilLiveApi';
import InfrastructureLayersPanel from './map/InfrastructureLayersPanel';
import type { OsmPetroleumLayerId } from '../lib/osmPetroleumLayers';
import LiveDataMapLegend from '../features/live-data/LiveDataMapLegend';
import GraphSyncMapBanner from '../features/live-data/GraphSyncMapBanner';
import { getOilLiveSyncStatus } from '../api/oilLiveApi';
import { LIVE_DATA_HUB_BOUNDS } from '../features/live-data/liveDataMapDefaults';
import { createOilFieldMapIcon, createRefineryMapIcon } from './petroleum/refineryMapIcon';
import { WORLD_PETROLEUM_PRELOAD_BBOX } from '../lib/petroleumLayers';
import { isOilFieldEntity, isRefineryEntity } from '../lib/oilEntityKinds';
import { countEntitiesInViewport } from '../lib/viewportBounds';
import MapZoomTracker from './petroleum/MapZoomTracker';
import MapBasemapLayers from './map/MapBasemapLayers';
import { createLicenseClusterIconFactory } from '../lib/mapClusterIcons';
import { useI18n } from '../lib/i18n';
import type { RouteMapOverlay } from '../features/route-planner/types';
import RoutePlannerMapLayers from '../features/route-planner/RoutePlannerMapLayers';
import RoutePlannerFlyEffect from '../features/route-planner/RoutePlannerFlyEffect';

// Lazy hub layers — Profiler: avoid mounting hundreds of Leaflet markers until toggled.
const RoutePlannerPortMarkers = lazy(() => import('../features/route-planner/RoutePlannerPortMarkers'));
const RoutePlannerAirportMarkers = lazy(() => import('../features/route-planner/RoutePlannerAirportMarkers'));
import RoutePlannerMapResizeEffect from '../features/route-planner/RoutePlannerMapResizeEffect';
import type { RoutePlannerHubMarker } from '../features/route-planner/locationPresets';
import RouteLegend from '../features/route-planner/RouteLegend';
import { applyCollocationJitter } from '../lib/geo';
import {
  countriesWithVisibleLicenses,
  countryLicenseCounts,
} from '../lib/countriesWithVisibleLicenses';
import {
  createLicenseMarkerIconCache,
  markerIconSignature,
} from '../lib/licenseMarkerIconCache';
import {
  asLicenseMarkerClusterGroup,
  type LicenseMarkerClusterGroup,
} from '../lib/markerClusterTypes';
import LicenseMapPopupController from './map/LicenseMapPopupController';
import EsgProtectedZonePopup from './esg/EsgProtectedZonePopup';
import {
  ESG_CONSERVATION_ZONES,
  getEsgZoneIntersection,
} from '../lib/esgConservationZones';

import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';

// Fix for default marker icon in React Leaflet
// @ts-ignore
import icon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

export { ESG_CONSERVATION_ZONES, getEsgZoneIntersection };

const createCustomIcon = (
    color: string,
    isHovered: boolean,
    isEsgRisk: boolean | undefined,
    isDark: boolean,
) => {
    const isGold = color === '#FFD700';
    const size = isHovered ? 24 : (isGold ? 14 : 10);
    const lightStroke = isHovered ? '#0f172a' : 'rgba(15, 23, 42, 0.72)';
    let border = isDark
        ? (isHovered ? '2px solid white' : (isGold ? '1px solid rgba(255, 255, 255, 0.9)' : '1px solid rgba(255, 255, 255, 0.7)'))
        : (isHovered ? `2px solid ${lightStroke}` : `1.5px solid ${lightStroke}`);

    let boxShadow;
    if (isEsgRisk) {
        boxShadow = isHovered
            ? '0 0 25px #ef4444, 0 0 12px #ef4444'
            : '0 0 15px #ef4444, 0 0 8px #ef4444';
        border = isHovered ? '2.5px solid #ef4444' : '1.5px solid rgba(239, 68, 68, 0.9)';
    } else if (isGold) {
        boxShadow = isHovered
            ? '0 0 20px rgba(255, 215, 0, 0.8), 0 0 10px rgba(255, 215, 0, 0.6)'
            : '0 0 12px rgba(255, 215, 0, 0.6), 0 0 6px rgba(255, 215, 0, 0.4)';
    } else {
        boxShadow = isHovered
            ? `0 0 15px ${color}`
            : `0 0 8px ${color}`;
    }

    const customClass = isEsgRisk ? 'animate-ping-red' : '';

    return new L.DivIcon({
        className: 'custom-marker',
        html: `<div class="${customClass}" style="background-color: ${isEsgRisk ? '#ef4444' : color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: ${border}; box-shadow: ${boxShadow}; transition: all 0.3s ease; pointer-events: auto; cursor: pointer;"></div>`,
        iconSize: isHovered ? [24, 24] : [size, size],
        iconAnchor: isHovered ? [12, 12] : [size / 2, size / 2],
        popupAnchor: [0, -10]
    });
};


// Applied to the marker root (.leaflet-marker-icon) when an item is the
// active selection. We toggle a class instead of calling setIcon() because
// setIcon replaces the marker's _icon DOM node — and replacing that node
// while a cluster is in spiderfy mode resets every leg back to the centroid,
// which is exactly the bug that made popups fail to open over collocated
// points.
const SELECTED_CLASS = 'is-selected';
const PORTS_MAP_RENDER_LIMIT = 3000;
const MARITIME_MAX_VESSEL_OPTIONS = ['1000', '2000', '5000', '10000', '15000'];

const MARITIME_CAPTURE_WINDOW_OPTIONS = ['10', '15', '25', '30'];

const getMarkerColor = (
  commodity?: string,
  userStatus?: string,
  sector?: string,
  entitySubtype?: string | null
) => {
    if (userStatus === 'good' || userStatus === 'Approved') return '#22c55e';
    if (userStatus === 'bad' || userStatus === 'Rejected') return '#ef4444';
    if (userStatus === 'maybe' || userStatus === 'Needs Review' || userStatus === 'Investigating') return '#f59e0b';
    if (userStatus === 'Escalated') return '#ef4444';

    if (entitySubtype === 'tank_farm') return '#f97316';
    if (entitySubtype === 'storage_terminal') return '#06b6d4';
    if (entitySubtype === 'refinery') return '#fb923c';

    if (sector) {
      const s = sector.toLowerCase();
      if (s === 'oil_and_gas' || s === 'oil') return '#1e40af';
      if (s === 'suppliers' || s === 'logistics') return '#6366f1';
      if (s === 'ports') return '#0ea5e9';
    }

    if (!commodity) return '#64748b';
    const c = commodity.toLowerCase();
    if (c.includes('gold')) return '#FFD700';
    if (c.includes('diamond')) return '#60a5fa';
    if (c.includes('bauxite')) return '#f87171';
    if (c.includes('manganese')) return '#a78bfa';
    if (c.includes('lithium')) return '#34d399';
    if (c.includes('oil') || c.includes('petroleum')) return '#1e40af';
    if (c.includes('gas')) return '#94a3b8';
    return '#64748b';
};

interface MapComponentProps {
  processedData: MiningLicense[];
  /** Full unfiltered license dataset for the current sector — used to determine which countries get borders. */
  allLicenses: MiningLicense[];
  userAnnotations: Record<string, UserAnnotation>;
  selectedItem: MiningLicense | null;
  setSelectedItem: (item: MiningLicense | null) => void;
  mapCenter: [number, number];
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  deleteLicense: (id: string) => void;
  handleOpenDossier: (item: MiningLicense) => void;
  mapFlyTrigger: number;
  viewModeKey: string;
  worldCoverage?: { countries: { country: string }[] };
  /** True while the active sector's license query has no data yet (keeps map from feeling frozen on sector switch). */
  licensesFetchPending?: boolean;
  /** Background refetch (e.g. after map pan) — lighter cue than initial load. */
  licensesRefetching?: boolean;
  /** Optional status line while some country feeds are still loading or failed (non-blocking). */
  licensesSecondaryStatus?: string | null;
  /** Debounced map bounds → GET /licenses?min_lat&… (sparse wire). */
  onLicenseMapViewportChange?: (bbox: MaritimeViewportBounds | null) => void;
  selectedMaritimeVessel: MaritimeVessel | null;
  onSelectMaritimeVessel: (vessel: MaritimeVessel | null) => void;
  maritimeMapViewActive?: boolean;
  isMaritimeLayerEnabled?: boolean;
  onMaritimeLayerEnabledChange?: (enabled: boolean) => void;
  vesselFilters?: VesselFilters;
  onVesselFiltersChange?: (filters: VesselFilters) => void;
  maritimeMaxVessels?: string;
  onMaritimeMaxVesselsChange?: (value: string) => void;
  maritimeCaptureWindow?: string;
  onMaritimeCaptureWindowChange?: (value: string) => void;
  prioritizePetroleumVessels?: boolean;
  onPrioritizePetroleumVesselsChange?: (enabled: boolean) => void;
  routePlannerOverlay?: RouteMapOverlay | null;
  routePlannerPickRole?: 'supplier' | 'buyer' | null;
  onRoutePlannerMapPick?: (
    lat: number,
    lng: number,
    role: 'supplier' | 'buyer',
    label?: string,
    country?: string,
  ) => void;
  routePlannerPorts?: RoutePlannerHubMarker[];
  routePlannerShowPorts?: boolean;
  onRoutePlannerPortPick?: (port: RoutePlannerHubMarker, role: 'supplier' | 'buyer') => void;
  routePlannerAirports?: RoutePlannerHubMarker[];
  routePlannerShowAirports?: boolean;
  onRoutePlannerAirportPick?: (airport: RoutePlannerHubMarker, role: 'supplier' | 'buyer') => void;
  routePlannerFlyTrigger?: number;
  routePlannerFlyTarget?: { lat: number; lng: number } | null;
  isInDdQueue?: (id: string) => boolean;
  onAddToDueDiligence?: (id: string) => void;
  onRemoveFromDueDiligence?: (id: string) => void;
  getDealRoomForLicense?: (id: string, entityKind?: string) => { title: string } | null | undefined;
  /** When set, only this country's outline is requested and emphasized; global outlines are hidden. */
  countryFocusCountry?: string | null;
  /** Increment when country focus is applied so the map can fit bounds after borders load. */
  countryFocusBoundsTrigger?: number;
  /** Open-data storage terminals / tank farms (Oil & Gas view). */
  storageEntities?: MiningLicense[];
  onStorageInViewCountChange?: (count: number) => void;
  /** Live Data mode — oil-live-intel map overlays. */
  oilLiveOverlaysEnabled?: boolean;
  oilLiveProductFilter?: string;
  oilLiveTerminalSearch?: string;
  oilLiveLayers?: OilLiveLayerVisibility;
  onOilLiveLayersChange?: (layers: OilLiveLayerVisibility) => void;
  oilLiveTradeFlowGroup?: 'company_pair' | 'country_pair';
  onOilLiveTradeFlowGroupChange?: (group: 'company_pair' | 'country_pair') => void;
  oilLiveCoverageStats?: {
    terminals: number;
    vessels: number;
    opportunities: number;
    corridors: number;
  } | null;
  onOilLiveStatsChange?: (stats: {
    terminals: number;
    vessels: number;
    opportunities: number;
    corridors: number;
  }) => void;
  liveDataMacroTradeOn?: boolean;
  onLiveDataMacroTradeChange?: (on: boolean) => void;
  oilLiveSidebarActive?: boolean;
  onOilLiveEntityClick?: (payload: OilLiveEntityClickPayload) => void;
  onOilLiveDismiss?: () => void;
  /** Increment when entering Live Data to fly map to Gulf hub bbox. */
  liveDataFlyTrigger?: number;
  /** When set, fly to this point instead of the default hub (search hit). */
  liveDataFlyTarget?: { lat: number; lng: number } | null;
  /** EIA historic file-import corridor arcs (purple dashed). */
  eiaHistoricMapEnabled?: boolean;
  eiaHistoricMapArcs?: EiaHistoricMapArc[];
  eiaHistoricMapOrigins?: EiaHistoricMapOrigin[];
  eiaHistoricMapYear?: number;
  eiaHistoricShowCorridors?: boolean;
  onEiaHistoricSelectImporter?: (importerName: string) => void;
  /** Hide mining license clusters so historic EIA points are clickable */
  suppressLicenseClusters?: boolean;
  /** Show OSM petroleum infrastructure on mining/global/oil views. */
  showInfrastructureLayers?: boolean;
  infrastructureLayerVisibility?: Record<OsmPetroleumLayerId, boolean>;
  onInfrastructureLayerChange?: (layerId: OsmPetroleumLayerId, visible: boolean) => void;
  /** Comtrade/Census macro country-pair arcs (gray). */
  macroTradeFlowsEnabled?: boolean;
  macroTradeFlows?: MacroTradeFlow[];
}

/** Capture the Leaflet MarkerClusterGroup instance for popup spiderfy timing. */
function ClusterGroupRefBridge({
    clusterGroupRef,
}: {
    clusterGroupRef: React.MutableRefObject<LicenseMarkerClusterGroup | null>;
}) {
    const { layerContainer } = useLeafletContext();
    useEffect(() => {
        const group = asLicenseMarkerClusterGroup(layerContainer);
        clusterGroupRef.current = group;
        return () => {
            if (clusterGroupRef.current === group) {
                clusterGroupRef.current = null;
            }
        };
    }, [layerContainer, clusterGroupRef]);
    return null;
}

const MapEffect = ({
    selectedItem,
    mapFlyTrigger,
    flyTarget,
}: {
    selectedItem: MiningLicense | null;
    mapFlyTrigger: number;
    // Optional jittered display coords so the camera lands on the marker we
    // actually rendered (matters when the row was nudged due to collocation).
    flyTarget: { lat: number; lng: number } | null;
}) => {
    const map = useMap();
    useEffect(() => {
        if (!selectedItem || mapFlyTrigger <= 0) return;
        const tgt = flyTarget ?? (selectedItem.lat != null && selectedItem.lng != null
            ? { lat: selectedItem.lat, lng: selectedItem.lng }
            : null);
        if (!tgt) return;
        const currentZoom = map.getZoom();
        const targetZoom = Math.max(currentZoom, 16);
        map.flyTo([tgt.lat, tgt.lng], targetZoom, { duration: 1.0 });
    }, [mapFlyTrigger, map, selectedItem, flyTarget]);
    return null;
};

const MapClickHandler = ({
    onMapClick,
    routePlannerPickRole,
    onRoutePlannerMapPick,
}: {
    onMapClick: () => void;
    routePlannerPickRole?: 'supplier' | 'buyer' | null;
    onRoutePlannerMapPick?: (
      lat: number,
      lng: number,
      role: 'supplier' | 'buyer',
      label?: string,
      country?: string,
    ) => void;
}) => {
    useMapEvents({
        click(e) {
            if (routePlannerPickRole && onRoutePlannerMapPick) {
                onRoutePlannerMapPick(e.latlng.lat, e.latlng.lng, routePlannerPickRole);
                return;
            }
            onMapClick();
        },
    });
    return null;
};

function routeOverlayBounds(overlay: RouteMapOverlay): L.LatLngBounds | null {
    const points: [number, number][] = [];
    for (const leg of overlay.legs) {
        for (const coord of leg.path) {
            if (
                Array.isArray(coord) &&
                coord.length === 2 &&
                Number.isFinite(coord[0]) &&
                Number.isFinite(coord[1])
            ) {
                points.push([coord[0], coord[1]]);
            }
        }
    }
    for (const wp of overlay.waypoints) {
        points.push([wp.lat, wp.lng]);
    }
    if (!points.length) return null;
    const bounds = L.latLngBounds(points);
    return bounds.isValid() ? bounds : null;
}

const RoutePlannerBoundsEffect = ({
    overlay,
}: {
    overlay?: RouteMapOverlay | null;
}) => {
    const map = useMap();
    useEffect(() => {
        if (!overlay?.legs?.length) return;
        const bounds = routeOverlayBounds(overlay);
        if (!bounds) return;
        const timer = window.setTimeout(() => {
            map.invalidateSize({ animate: false, pan: false });
            map.fitBounds(bounds.pad(0.12), { animate: false, maxZoom: 7, padding: [40, 40] });
        }, 80);
        return () => window.clearTimeout(timer);
    }, [map, overlay]);
    return null;
};

const CountryFocusBoundsFly = ({
    active,
    geojson,
    trigger,
}: {
    active: boolean;
    geojson: object | null | undefined;
    trigger: number;
}) => {
    const map = useMap();
    useEffect(() => {
        if (!active || !geojson || trigger <= 0) return;
        const timer = window.setTimeout(() => {
            try {
                map.invalidateSize({ animate: false, pan: false });
                const gjLayer = L.geoJSON(geojson as never);
                const bounds = gjLayer.getBounds();
                if (!bounds.isValid()) return;
                map.fitBounds(bounds, { padding: [48, 48], maxZoom: 9, animate: true });
            } catch {
                /* ignore malformed GeoJSON during development */
            }
        }, 80);
        return () => window.clearTimeout(timer);
    }, [active, geojson, trigger, map]);
    return null;
};

const LiveDataMapFly = ({
    trigger,
    target,
}: {
    trigger: number;
    target: { lat: number; lng: number } | null;
}) => {
    const map = useMap();
    useEffect(() => {
        if (trigger <= 0) return;
        const timer = window.setTimeout(() => {
            map.invalidateSize({ animate: false, pan: false });
            if (target) {
                map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 8), { duration: 1.0 });
                return;
            }
            const bounds = L.latLngBounds(LIVE_DATA_HUB_BOUNDS);
            if (!bounds.isValid()) return;
            map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 6, duration: 1.2 });
        }, 120);
        return () => window.clearTimeout(timer);
    }, [trigger, target, map]);
    return null;
};

const ViewportBoundsTracker = ({
    active,
    onBoundsChange,
    debounceMs = 0,
}: {
    active: boolean;
    onBoundsChange: (bbox: MaritimeViewportBounds | null) => void;
    debounceMs?: number;
}) => {
    const map = useMap();
    const lastSignatureRef = useRef<string>('');
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const emitBounds = useCallback(() => {
        if (!active) return;
        const bounds = map.getBounds();
        if (!bounds.isValid()) return;
        const nextBounds = {
            south: Number(bounds.getSouth().toFixed(4)),
            west: Number(bounds.getWest().toFixed(4)),
            north: Number(bounds.getNorth().toFixed(4)),
            east: Number(bounds.getEast().toFixed(4)),
        };
        const signature = `${nextBounds.south}:${nextBounds.west}:${nextBounds.north}:${nextBounds.east}`;
        if (signature === lastSignatureRef.current) return;
        lastSignatureRef.current = signature;
        onBoundsChange(nextBounds);
    }, [active, map, onBoundsChange]);

    const scheduleEmitBounds = useCallback(() => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        if (debounceMs <= 0) {
            emitBounds();
            return;
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            emitBounds();
        }, debounceMs);
    }, [debounceMs, emitBounds]);

    useEffect(() => {
        if (!active) {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            lastSignatureRef.current = '';
            onBoundsChange(null);
            return;
        }
        emitBounds();
    }, [active, emitBounds, onBoundsChange]);

    useEffect(
        () => () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        },
        [],
    );

    useMapEvents({
        moveend: scheduleEmitBounds,
        zoomend: scheduleEmitBounds,
    });

    return null;
};

export default function MapComponent({
  processedData,
  allLicenses,
  userAnnotations,
  selectedItem,
  setSelectedItem,
  mapCenter,
  updateAnnotation,
  deleteLicense,
  handleOpenDossier,
  mapFlyTrigger,
  viewModeKey,
  licensesFetchPending = false,
  licensesRefetching = false,
  licensesSecondaryStatus = null,
  selectedMaritimeVessel,
  onSelectMaritimeVessel,
  maritimeMapViewActive = false,
  isMaritimeLayerEnabled: isMaritimeLayerEnabledProp = false,
  onMaritimeLayerEnabledChange,
  vesselFilters: vesselFiltersProp,
  onVesselFiltersChange,
  maritimeMaxVessels: maritimeMaxVesselsProp = '15000',
  onMaritimeMaxVesselsChange,
  maritimeCaptureWindow: maritimeCaptureWindowProp = '25',
  onMaritimeCaptureWindowChange,
  prioritizePetroleumVessels = false,
  onPrioritizePetroleumVesselsChange,
  worldCoverage,
  routePlannerOverlay = null,
  routePlannerPickRole = null,
  onRoutePlannerMapPick,
  routePlannerPorts = [],
  routePlannerShowPorts = false,
  onRoutePlannerPortPick,
  routePlannerAirports = [],
  routePlannerShowAirports = false,
  onRoutePlannerAirportPick,
  routePlannerFlyTrigger = 0,
  routePlannerFlyTarget = null,
  isInDdQueue,
  onAddToDueDiligence,
  onRemoveFromDueDiligence,
  getDealRoomForLicense,
  countryFocusCountry = null,
  countryFocusBoundsTrigger = 0,
  onLicenseMapViewportChange,
  storageEntities = [],
  onStorageInViewCountChange,
  oilLiveOverlaysEnabled = false,
  oilLiveProductFilter = 'all',
  oilLiveTerminalSearch = '',
  oilLiveLayers = {
    terminals: true,
    vessels: true,
    corridors: true,
    opportunities: true,
    tradeFlows: false,
  },
  onOilLiveLayersChange,
  oilLiveTradeFlowGroup = 'company_pair',
  onOilLiveTradeFlowGroupChange,
  oilLiveCoverageStats = null,
  onOilLiveStatsChange,
  onOilLiveEntityClick,
  onOilLiveDismiss,
  liveDataFlyTrigger = 0,
  liveDataFlyTarget = null,
  eiaHistoricMapEnabled = false,
  eiaHistoricMapArcs = [],
  eiaHistoricMapOrigins = [],
  eiaHistoricMapYear,
  eiaHistoricShowCorridors = false,
  onEiaHistoricSelectImporter,
  suppressLicenseClusters = false,
  showInfrastructureLayers = false,
  infrastructureLayerVisibility,
  onInfrastructureLayerChange,
  macroTradeFlowsEnabled = false,
  macroTradeFlows = [],
  liveDataMacroTradeOn = true,
  onLiveDataMacroTradeChange,
  oilLiveSidebarActive = false,
}: MapComponentProps) {
    const { t } = useI18n();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme !== 'light';
    const isOilAndGasView = viewModeKey === 'oil_and_gas';
    const isLicenseMapView =
        viewModeKey === 'mining' ||
        viewModeKey === 'oil_and_gas' ||
        viewModeKey === 'global' ||
        viewModeKey === 'suppliers';
    const isLiveDataView = oilLiveSidebarActive;
    const { data: oilLiveSyncStatus } = useQuery({
        queryKey: ['oil-live-sync-status-map'],
        queryFn: getOilLiveSyncStatus,
        enabled: isLiveDataView && oilLiveOverlaysEnabled,
        staleTime: 60_000,
    });
    const isMaritimeMapView = maritimeMapViewActive;
    const isRoutePlannerView = viewModeKey === 'route_planner';
    const mapRef = useRef<L.Map | null>(null);
    const canvasVesselLayerRef = useRef<CanvasVesselLayer | null>(null);
    const markerRefs = useRef<Record<string, L.Marker>>({});
    const clusterGroupRef = useRef<LicenseMarkerClusterGroup | null>(null);
    const markerIconCacheRef = useRef(createLicenseMarkerIconCache());
    const prevSelectedIdRef = useRef<string | null>(null);
    const [currentVisibleViewport, setCurrentVisibleViewport] = useState<MaritimeViewportBounds | null>(null);
    const [oilGasMapViewport, setOilGasMapViewport] = useState<MaritimeViewportBounds | null>(null);
    const [liveDataMapViewport, setLiveDataMapViewport] = useState<MaritimeViewportBounds | null>(null);

    const isMobileDevice = useMemo(() => {
        if (typeof window === 'undefined') return false;
        return window.innerWidth < 768 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
    }, []);

    const isMaritimeLayerEnabled = isMaritimeLayerEnabledProp;
    const setIsMaritimeLayerEnabled = onMaritimeLayerEnabledChange ?? (() => {});
    const maritimeMaxVessels = maritimeMaxVesselsProp;
    const setMaritimeMaxVessels = onMaritimeMaxVesselsChange ?? (() => {});
    const maritimeCaptureWindow = maritimeCaptureWindowProp;
    const setMaritimeCaptureWindow = onMaritimeCaptureWindowChange ?? (() => {});
    const vesselFilters = vesselFiltersProp ?? { search: '', shipTypes: [], minSpeedKnots: null, maxSpeedKnots: null, navigationalStatuses: [] };
    const debouncedVesselSearch = useDebouncedValue(vesselFilters.search);
    const vesselFiltersApplied = useMemo(
        () => ({ ...vesselFilters, search: debouncedVesselSearch }),
        [vesselFilters, debouncedVesselSearch],
    );
    const setVesselFilters = useCallback(
        (update: VesselFilters | ((prev: VesselFilters) => VesselFilters)) => {
            if (!onVesselFiltersChange) return;
            const next = typeof update === 'function' ? update(vesselFilters) : update;
            onVesselFiltersChange(next);
        },
        [onVesselFiltersChange, vesselFilters],
    );
    const [oilAndGasDisplayMode, setOilAndGasDisplayMode] = useState<OilAndGasDisplayMode>('combined');
    const [maritimeViewport, setMaritimeViewport] = useState<MaritimeViewportBounds | null>(null);
    const [petroleumMapZoom, setPetroleumMapZoom] = useState(5);
    const [maritimeMapZoom, setMaritimeMapZoom] = useState(5);
    const [petroleumDetailZoom, setPetroleumDetailZoom] = useState(5);
    const [maritimeAdvancedOpen, setMaritimeAdvancedOpen] = useState(false);
    const [includeCoastalDemoVessels, setIncludeCoastalDemoVessels] = useState(() => {
        if (typeof window === 'undefined') return false;
        if (window.localStorage.getItem(MARITIME_INCLUDE_COASTAL_DEMO_LOCALSTORAGE_KEY) === '1') {
            return true;
        }
        return window.localStorage.getItem(MARITIME_INCLUDE_GULF_DEMO_LOCALSTORAGE_KEY) === '1';
    });
    const vesselLayerLabel = t('כלי שיט (AIS)', 'Vessels (AIS)');
    const handleMaritimeLayerActiveChange = useCallback(
        (active: boolean) => {
            setIsMaritimeLayerEnabled(active);
        },
        [setIsMaritimeLayerEnabled],
    );
    const vesselApiScope =
        prioritizePetroleumVessels && isOilAndGasView ? ('oil_tankers' as const) : ('all_vessels' as const);

    // Jitter rows that share exact coordinates so each marker has a unique
    // anchor for spiderfy + popup. See lib/geo.ts for the rationale.
    const displayData = useMemo(() => applyCollocationJitter(processedData), [processedData]);

    const mobileFilteredData = useMemo(() => {
        if (!isMobileDevice || !currentVisibleViewport) {
            return { data: displayData, capped: false };
        }
        const filtered = displayData.filter((item) => {
            if (item.lat == null || item.lng == null) return false;
            if (selectedItem && item.id === selectedItem.id) return true;
            return (
                item.lat >= currentVisibleViewport.south &&
                item.lat <= currentVisibleViewport.north &&
                item.lng >= currentVisibleViewport.west &&
                item.lng <= currentVisibleViewport.east
            );
        });

        const MOBILE_RENDER_LIMIT = 800;
        if (filtered.length > MOBILE_RENDER_LIMIT) {
            const capped = filtered.slice(0, MOBILE_RENDER_LIMIT);
            if (selectedItem) {
                const selected = filtered.find((item) => item.id === selectedItem.id);
                if (selected && !capped.some((item) => item.id === selected.id)) {
                    capped[capped.length - 1] = selected;
                }
            }
            return { data: capped, capped: true };
        }
        return { data: filtered, capped: false };
    }, [displayData, selectedItem, isMobileDevice, currentVisibleViewport]);

    const mapDisplayData = useMemo(() => {
        if (isMobileDevice) {
            return mobileFilteredData.data;
        }

        if (viewModeKey !== 'ports' || displayData.length <= PORTS_MAP_RENDER_LIMIT) {
            return displayData;
        }
        const capped = displayData.slice(0, PORTS_MAP_RENDER_LIMIT);
        if (!selectedItem) return capped;
        const selected = displayData.find((item) => item.id === selectedItem.id);
        if (!selected || capped.some((item) => item.id === selected.id)) {
            return capped;
        }
        return [selected, ...capped.slice(0, PORTS_MAP_RENDER_LIMIT - 1)];
    }, [displayData, selectedItem, viewModeKey, isMobileDevice, mobileFilteredData]);
    const {
        data: maritimeFeed,
        isLoading: isMaritimeLoading,
        isFetching: isMaritimeFetching,
        error: maritimeError,
        refetch: refetchMaritime,
    } = useMaritimeVessels({
        enabled: isMaritimeMapView && isMaritimeLayerEnabled,
        maxVessels: Number(maritimeMaxVessels),
        captureWindowSeconds: Number(maritimeCaptureWindow),
        scope: vesselApiScope,
        viewport: maritimeViewport,
        includeCoastalDemo: includeCoastalDemoVessels,
    });
    const maritimeSnapshotVessels = maritimeFeed?.vessels ?? [];
    const maritimeBboxTotal =
        maritimeFeed?.total_available ?? maritimeFeed?.effective_bbox_count ?? null;
    const maritimeSnapshotTotal =
        (maritimeViewport && maritimeBboxTotal != null
            ? maritimeBboxTotal
            : maritimeFeed?.snapshot_vessel_count) ??
        maritimeFeed?.total_available ??
        maritimeSnapshotVessels.length;
    const maritimeVesselsInViewport = useMemo(
        () => filterVesselsByViewport(maritimeSnapshotVessels, maritimeViewport),
        [maritimeSnapshotVessels, maritimeViewport],
    );
    const maritimeVessels = useMemo(() => {
        const filtered = applyVesselFilters(maritimeVesselsInViewport, vesselFiltersApplied);
        return sortVesselsForDisplay(filtered, prioritizePetroleumVessels && isOilAndGasView);
    }, [maritimeVesselsInViewport, vesselFiltersApplied, prioritizePetroleumVessels, isOilAndGasView]);
    const maritimeStatusMessages = useMemo(
        () =>
            buildMaritimeStatusMessages(maritimeFeed, {
                layerEnabled: isMaritimeLayerEnabled,
                vesselsInView: maritimeVessels.length,
                snapshotTotal: maritimeSnapshotTotal,
                isLoading: isMaritimeLoading,
                hasError: Boolean(maritimeError),
            }),
        [
            maritimeFeed,
            isMaritimeLayerEnabled,
            maritimeVessels.length,
            maritimeSnapshotTotal,
            isMaritimeLoading,
            maritimeError,
        ],
    );
    const maritimeServedFromCache = Boolean(
        maritimeFeed && (maritimeFeed.cached || maritimeFeed.memory_cached || !isMaritimeLoading),
    );
    const onGroundVisible =
      (!isOilAndGasView || oilAndGasDisplayMode !== 'vessels_only') &&
      !isRoutePlannerView &&
      !isLiveDataView;

    useEffect(() => {
        if (!isOilAndGasView || !onStorageInViewCountChange) return;
        onStorageInViewCountChange(countEntitiesInViewport(storageEntities, oilGasMapViewport));
    }, [isOilAndGasView, storageEntities, oilGasMapViewport, onStorageInViewCountChange]);
    const vesselsVisible =
      isMaritimeMapView &&
      (!isOilAndGasView || oilAndGasDisplayMode !== 'on_ground_only') &&
      (!isLiveDataView || isMaritimeLayerEnabled);
    const hideCountryBordersForVesselsOnly = isOilAndGasView && oilAndGasDisplayMode === 'vessels_only';

    const maritimeDrawRecords = useMemo(
        () => toVesselDrawRecords(maritimeVessels, maritimeMapZoom, selectedMaritimeVessel?.id ?? null),
        [maritimeVessels, maritimeMapZoom, selectedMaritimeVessel?.id],
    );

    const maritimeLodEstimate = useMemo(() => {
        if (!maritimeViewport || maritimeDrawRecords.length === 0) {
            return { drawn: maritimeDrawRecords.length, subsampling: false };
        }
        const plan = planVesselLodDraw(maritimeDrawRecords, maritimeViewport, maritimeMapZoom);
        return { drawn: plan.drawIndices.length, subsampling: plan.lodSubsampling };
    }, [maritimeDrawRecords, maritimeViewport, maritimeMapZoom]);

    const pushVesselsToCanvas = useCallback(() => {
        if (!vesselsVisible || !isMaritimeLayerEnabled) return;
        const layer = canvasVesselLayerRef.current;
        if (!layer) return;
        layer.setVessels(maritimeVessels, maritimeDrawRecords);
    }, [vesselsVisible, isMaritimeLayerEnabled, maritimeVessels, maritimeDrawRecords]);

    useLayoutEffect(() => {
        pushVesselsToCanvas();
    }, [pushVesselsToCanvas]);

    const handleCanvasVesselLayerReady = useCallback(() => {
        pushVesselsToCanvas();
    }, [pushVesselsToCanvas]);

    const prevCoastalDemoToggleMount = useRef(true);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (includeCoastalDemoVessels) {
            window.localStorage.setItem(MARITIME_INCLUDE_COASTAL_DEMO_LOCALSTORAGE_KEY, '1');
            window.localStorage.removeItem(MARITIME_INCLUDE_GULF_DEMO_LOCALSTORAGE_KEY);
        } else {
            window.localStorage.removeItem(MARITIME_INCLUDE_COASTAL_DEMO_LOCALSTORAGE_KEY);
            window.localStorage.removeItem(MARITIME_INCLUDE_GULF_DEMO_LOCALSTORAGE_KEY);
        }
    }, [includeCoastalDemoVessels]);

    useEffect(() => {
        if (prevCoastalDemoToggleMount.current) {
            prevCoastalDemoToggleMount.current = false;
            return;
        }
        clearMaritimeSnapshotCache();
    }, [includeCoastalDemoVessels]);

    useEffect(() => {
        if (isMaritimeMapView) return;
        setOilAndGasDisplayMode('combined');
        setMaritimeViewport(null);
        setMaritimeAdvancedOpen(false);
    }, [isMaritimeMapView]);

    useEffect(() => {
        const timer = window.setTimeout(() => setPetroleumDetailZoom(petroleumMapZoom), 400);
        return () => window.clearTimeout(timer);
    }, [petroleumMapZoom]);

    useEffect(() => {
        if (!isMaritimeLayerEnabled) setMaritimeAdvancedOpen(false);
    }, [isMaritimeLayerEnabled]);

    useEffect(() => {
        if (isMaritimeLayerEnabled) return;
        onSelectMaritimeVessel(null);
    }, [isMaritimeLayerEnabled, onSelectMaritimeVessel]);

    useEffect(() => {
        if (!selectedMaritimeVessel) return;
        if (maritimeVessels.some((vessel) => vessel.id === selectedMaritimeVessel.id)) return;
        onSelectMaritimeVessel(null);
    }, [maritimeVessels, onSelectMaritimeVessel, selectedMaritimeVessel]);

    const maritimeIdleHint = t(
        'הפעל את שכבת «כלי שיט (AIS)» במסננים (אייקון שכבות) או בבקרת השכבות למטה מימין.',
        'Enable «Vessels (AIS)» in the filter panel (layers icon) or the layer control (bottom-right).'
    );
    const maritimeHeadlineStatus = maritimeStatusMessages
        ? t(maritimeStatusMessages.headlineHe, maritimeStatusMessages.headlineEn)
        : '';
    const maritimeDetailNote = maritimeStatusMessages
        ? t(maritimeStatusMessages.detailHe, maritimeStatusMessages.detailEn)
        : '';
    const maritimeLimitationText =
        maritimeFeed?.limitations?.find((item) => item && item !== maritimeFeed?.geography_note) ?? null;
    const maritimeSparseWarning =
        maritimeStatusMessages?.sparseWarningHe && maritimeStatusMessages.sparseWarningEn
            ? t(maritimeStatusMessages.sparseWarningHe, maritimeStatusMessages.sparseWarningEn)
            : null;
    const maritimeViewportAisGap =
        isMaritimeLayerEnabled &&
        maritimeVessels.length === 0 &&
        Boolean(maritimeFeed?.viewport_ais_coverage_gap) &&
        !maritimeFeed?.coastal_demo_synthetic &&
        !includeCoastalDemoVessels;
    const maritimeLodUiNote =
        isMaritimeLayerEnabled &&
        maritimeVessels.length > 0 &&
        maritimeLodEstimate.subsampling &&
        maritimeLodEstimate.drawn < maritimeVessels.length
            ? t(
                  `בזום עולמי מוצגים ~${maritimeLodEstimate.drawn.toLocaleString()} סימני כלי שיט מתוך ${maritimeVessels.length.toLocaleString()} בתצוגה (דגימת LOD, לא קיבוץ). התקרבו לזום ≥${LOD_FULL_DETAIL_ZOOM} לכל הסימנים.`,
                  `At this zoom only ~${maritimeLodEstimate.drawn.toLocaleString()} ship icons are drawn from ${maritimeVessels.length.toLocaleString()} in view (display LOD, not clustering). Zoom to ≥${LOD_FULL_DETAIL_ZOOM} to show every vessel.`
              )
            : null;
    const maritimeClusterClarification =
        isMaritimeLayerEnabled && onGroundVisible && mapDisplayData.length > 0
            ? t(
                  'מספרים גדולים על המפה (למשל 1943) הם קיבוץ רישיונות/נכסים — לא כלי שיט. כלי שיט מוצגים כסימני משולש צבעוניים.',
                  'Large numbered map bubbles (e.g. 1943) are license/asset clusters—not vessels. Ships appear as small colored chevrons.'
              )
            : null;

    const flyTarget = useMemo(() => {
        if (!selectedItem) return null;
        const j = mapDisplayData.find(d => d.id === selectedItem.id) || displayData.find(d => d.id === selectedItem.id);
        if (!j || j._displayLat == null || j._displayLng == null) return null;
        return { lat: j._displayLat, lng: j._displayLng };
    }, [selectedItem, displayData, mapDisplayData]);

    const setMarkerSelectedVisual = useCallback((marker: L.Marker | undefined, selected: boolean) => {
        const el = marker?.getElement();
        if (!el) return;
        el.classList.toggle(SELECTED_CLASS, selected);
        const pin = el.querySelector('.refinery-marker-pin, .oil-field-marker-pin');
        if (pin) pin.classList.toggle('is-selected', selected);
    }, []);

    // Selection highlight only — popup open/close is handled by LicenseMapPopupController.
    useEffect(() => {
        const prevId = prevSelectedIdRef.current;
        if (prevId && prevId !== selectedItem?.id) {
            setMarkerSelectedVisual(markerRefs.current[prevId], false);
        }

        if (!selectedItem) {
            prevSelectedIdRef.current = null;
            return;
        }

        setMarkerSelectedVisual(markerRefs.current[selectedItem.id], true);
        prevSelectedIdRef.current = selectedItem.id;
    }, [selectedItem?.id, setMarkerSelectedVisual]);

    const borderCountries = useMemo(() => {
        if (isRoutePlannerView) {
            return [];
        }
        const focus = countryFocusCountry?.trim();
        if (focus) {
            return [focus].sort((a, b) => a.localeCompare(b));
        }
        // Outlines follow the same filtered license set as map markers (search + facet filters).
        const MAX_BORDER_COUNTRIES = 30;
        const all = countriesWithVisibleLicenses(processedData);
        if (all.length <= MAX_BORDER_COUNTRIES) return all;
        return countryLicenseCounts(processedData)
            .slice(0, MAX_BORDER_COUNTRIES)
            .map((row) => row.country);
    }, [processedData, countryFocusCountry, isRoutePlannerView]);

    const { data: filteredGeoJson } = useQuery({
        queryKey: ['country-borders', borderCountries],
        queryFn: () => getCountryBorders(borderCountries),
        enabled: borderCountries.length > 0,
        staleTime: 1000 * 60 * 60 * 24,
        gcTime: 1000 * 60 * 60 * 24 * 7,
    });

    /** High-contrast strokes on dark Carto tiles; cyan at 50% opacity + weight 1 was nearly invisible. */
    const countryBorderPathStyle = useMemo(
        () =>
            isDark
                ? {
                      className: 'map-country-border map-country-border--dark',
                      fillColor: '#06b6d4',
                      color: '#06b6d4',
                      weight: 1.5,
                      opacity: 0.5,
                      fillOpacity: 0.05,
                      lineCap: 'round' as const,
                      lineJoin: 'round' as const,
                  }
                : {
                      className: 'map-country-border map-country-border--light',
                      fillColor: '#0284c7',
                      color: '#0369a1',
                      weight: 2,
                      opacity: 0.85,
                      fillOpacity: 0.04,
                      lineCap: 'round' as const,
                      lineJoin: 'round' as const,
                  },
        [isDark]
    );

    const countryBorderLayerStyle = useMemo(() => {
        if (countryFocusCountry?.trim()) {
            return isDark
                ? {
                      className: 'map-country-border map-country-border--focus map-country-border--dark',
                      fillColor: '#f59e0b',
                      color: '#fbbf24',
                      weight: 3,
                      opacity: 0.95,
                      fillOpacity: 0.08,
                      lineCap: 'round' as const,
                      lineJoin: 'round' as const,
                  }
                : {
                      className: 'map-country-border map-country-border--focus map-country-border--light',
                      fillColor: '#f59e0b',
                      color: '#d97706',
                      weight: 2.5,
                      opacity: 0.9,
                      fillOpacity: 0.06,
                      lineCap: 'round' as const,
                      lineJoin: 'round' as const,
                  };
        }
        return countryBorderPathStyle;
    }, [countryFocusCountry, isDark, countryBorderPathStyle]);

    const licenseMarkerIcons = useMemo(() => {
        const cache = markerIconCacheRef.current;
        const icons = new Map<string, L.DivIcon>();
        const validIds = new Set<string>();
        for (const item of mapDisplayData) {
            if (item._displayLat == null || item._displayLng == null) continue;
            validIds.add(item.id);
            const annotation = userAnnotations[item.id] || {};
            const color = getMarkerColor(
                annotation.commodity || item.commodity,
                annotation.status,
                item.sector,
                item.entitySubtype,
            );
            const esgZone = getEsgZoneIntersection(item._displayLat, item._displayLng);
            const isEsgRisk = esgZone !== null;
            const refineryPin = isRefineryEntity(item);
            const oilFieldPin = !refineryPin && isOilFieldEntity(item);
            const sig = markerIconSignature(color, isEsgRisk, refineryPin, oilFieldPin, isDark);
            icons.set(
                item.id,
                cache.get(item.id, sig, () =>
                    refineryPin
                        ? createRefineryMapIcon()
                        : oilFieldPin
                          ? createOilFieldMapIcon()
                          : createCustomIcon(color, false, isEsgRisk, isDark),
                ),
            );
        }
        cache.prune(validIds);
        return icons;
    }, [mapDisplayData, userAnnotations, isDark]);

    const licenseClusterIconCreate = useMemo(
        () => createLicenseClusterIconFactory(isDark),
        [isDark],
    );

    const renderedMarkers = useMemo(() => {
        if (!onGroundVisible) return null;
        return mapDisplayData.map((item) => {
            if (item._displayLat == null || item._displayLng == null) return null;
            const markerIcon = licenseMarkerIcons.get(item.id);
            if (!markerIcon) return null;

            return (
                <Marker
                    key={item.id}
                    position={[item._displayLat, item._displayLng]}
                    icon={markerIcon}
                    ref={(el) => {
                        if (!el) {
                            delete markerRefs.current[item.id];
                            return;
                        }
                        markerRefs.current[item.id] = el;
                    }}
                    eventHandlers={{
                        click: (e) => {
                            L.DomEvent.stopPropagation(e);
                            onSelectMaritimeVessel(null);
                            setSelectedItem(item);
                        },
                    }}
                >
                    <Tooltip direction="top" offset={[0, -20]} opacity={1}>
                        <div className="bg-slate-950 border border-white/20 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md">
                            <span className="text-[10px] font-black uppercase text-white tracking-widest">{item.company}</span>
                            {item.entitySubtype && (
                              <p className="text-[8px] text-cyan-300 uppercase tracking-widest">
                                {item.entitySubtype.replaceAll('_', ' ')}
                              </p>
                            )}
                            {item._wasJittered && (
                              <span className="ml-1 text-[8px] font-bold text-amber-400">≈ approx ({item._collocatedCount})</span>
                            )}
                        </div>
                    </Tooltip>
                </Marker>
            );
        });
    }, [
        licenseMarkerIcons,
        mapDisplayData,
        userAnnotations,
        onSelectMaritimeVessel,
        setSelectedItem,
        onGroundVisible,
    ]);

    const handleMaritimeVesselClick = useCallback(
        (vessel: MaritimeVessel) => {
            setSelectedItem(null);
            onSelectMaritimeVessel(vessel);
        },
        [onSelectMaritimeVessel, setSelectedItem],
    );

    const formatMaritimeVesselTooltip = useCallback((vessel: MaritimeVessel) => {
        const wrap = document.createElement('div');
        wrap.className = 'bg-slate-950 border border-cyan-500/20 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md';
        const title = document.createElement('span');
        title.className = 'text-[10px] font-black uppercase text-cyan-300 tracking-widest';
        title.textContent = vessel.vessel_name;
        const meta = document.createElement('p');
        meta.className = 'text-[9px] text-slate-400';
        meta.textContent = [
            vessel.ship_type_label,
            vessel.speed_knots != null ? `${vessel.speed_knots} kn` : null,
            vessel.nearest_port?.name,
        ]
            .filter(Boolean)
            .join(' · ');
        wrap.append(title, meta);
        return wrap;
    }, []);

    return (
        <div className="w-full h-full relative bg-slate-100 dark:bg-slate-900">
            {licensesFetchPending && (
                <div
                    className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-white/30 dark:bg-slate-950/35 backdrop-blur-[2px]"
                    role="status"
                    aria-live="polite"
                >
                    <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/90 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-xl dark:border-white/10 dark:bg-slate-900/90 dark:text-slate-200">
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" aria-hidden />
                        <span>{t('טוען רישיונות…', 'Loading licenses…')}</span>
                    </div>
                </div>
            )}
            {licensesRefetching && !licensesFetchPending && (
                <div
                    className="pointer-events-none absolute left-1/2 top-20 z-[600] flex -translate-x-1/2 items-center gap-2 rounded-full border border-black/10 bg-white/90 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-600 shadow-lg dark:border-white/10 dark:bg-slate-900/90 dark:text-slate-300"
                    role="status"
                    aria-live="polite"
                >
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-500" aria-hidden />
                    <span>{t('מעדכן רישיונות…', 'Updating licenses…')}</span>
                </div>
            )}
            {licensesSecondaryStatus && (
                <div
                    className="pointer-events-none absolute left-1/2 top-32 z-[600] max-w-[min(90vw,28rem)] -translate-x-1/2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-center text-[9px] font-bold uppercase tracking-wide text-amber-900 shadow-md dark:border-amber-400/20 dark:bg-amber-500/15 dark:text-amber-100"
                    role="status"
                    aria-live="polite"
                >
                    {licensesSecondaryStatus}
                </div>
            )}

            {isOilAndGasView &&
                isMaritimeLayerEnabled &&
                maritimeFeed?.aisstream_persian_gulf_coverage_gap && (
                <div
                    className="pointer-events-auto absolute left-3 right-3 top-3 z-[650] rounded-2xl border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-[10px] font-semibold leading-snug text-amber-950 shadow-lg dark:text-amber-50 sm:left-6 sm:max-w-xl"
                    role="status"
                >
                    <p className="font-black uppercase tracking-widest text-[9px] text-amber-700 dark:text-amber-200">
                        {t('פער AIS במפרץ הפרסי', 'Persian Gulf AIS upstream gap')}
                    </p>
                    <p className="mt-1">
                        {t(
                            'AISStream מדלג על המפרץ — הפעילו הצג מיקומי הדגמה בפאנל כלי השיט או הריצו maritime-worker.',
                            'AISStream skips the Gulf — enable Show demo positions in the vessel panel or run maritime-worker.',
                        )}
                    </p>
                </div>
            )}
            {!isRoutePlannerView &&
              viewModeKey !== 'suppliers' &&
              !licensesFetchPending &&
              ((onGroundVisible ? processedData.length : 0) === 0) &&
              (vesselsVisible && isMaritimeLayerEnabled
                ? maritimeVessels.length === 0 && !(isMaritimeLoading && !maritimeFeed)
                : true) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-100/60 dark:bg-slate-900/60 backdrop-blur-sm">
                    <div className="text-4xl mb-2">🔍</div>
                    <h3 className="text-lg font-bold">{t("לא נמצאו נכסים", "No assets found")}</h3>
                    <p className="text-sm text-slate-400">{t("נסה לשנות את המסננים או להפעיל מחדש את שכבת האחסון", "Try adjusting filters or reloading the storage layer")}</p>
                </div>
            )}
            {isLiveDataView && oilLiveOverlaysEnabled && (
                <>
                <div className="absolute right-4 top-24 z-[950] pointer-events-auto hidden sm:block">
                    <LiveDataMapLegend
                        layers={oilLiveLayers}
                        eiaHistoricOn={eiaHistoricMapEnabled}
                        macroTradeOn={liveDataMacroTradeOn && macroTradeFlowsEnabled}
                    />
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 top-24 z-[950] pointer-events-auto">
                    <GraphSyncMapBanner cargoRecordCount={oilLiveSyncStatus?.cargo_record_count} />
                </div>
                </>
            )}
            {isLiveDataView && oilLiveOverlaysEnabled && onOilLiveLayersChange && (
                <div className="absolute left-4 bottom-4 z-[950] pointer-events-auto">
                    <LiveDataMapLayersPanel
                        layers={oilLiveLayers}
                        onLayersChange={onOilLiveLayersChange}
                        coverageStats={oilLiveCoverageStats}
                        allMaritimeEnabled={isMaritimeLayerEnabled}
                        onAllMaritimeChange={setIsMaritimeLayerEnabled}
                        globalMaritimeCount={maritimeSnapshotTotal}
                        tradeFlowGroup={oilLiveTradeFlowGroup}
                        onTradeFlowGroupChange={onOilLiveTradeFlowGroupChange}
                        macroTradeEnabled={liveDataMacroTradeOn}
                        onMacroTradeChange={onLiveDataMacroTradeChange}
                    />
                </div>
            )}
            {showInfrastructureLayers &&
                !isLiveDataView &&
                !isOilAndGasView &&
                infrastructureLayerVisibility &&
                onInfrastructureLayerChange && (
                <div className="absolute left-4 bottom-4 z-[950] pointer-events-auto">
                    <InfrastructureLayersPanel
                        visibility={infrastructureLayerVisibility}
                        onChange={onInfrastructureLayerChange}
                    />
                </div>
            )}
            {isMaritimeMapView && !isLiveDataView && (
                <div className="absolute left-4 bottom-4 z-[950] w-[min(100vw-2rem,480px)] rounded-2xl border border-stone-200/90 dark:border-white/10 bg-stone-50/95 dark:bg-slate-950/90 backdrop-blur-xl shadow-2xl">
                    <div className="border-b border-black/5 px-3.5 py-3 dark:border-white/5">
                        <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10">
                                <Radar className="h-4 w-4 text-cyan-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-500">
                                    {t('מעקב ימי', 'Maritime Watch')}
                                </p>
                                <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                                    {t('AIS לפי גבולות המפה', 'AIS for current map bounds')}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3 px-3.5 pb-3.5 pt-3">
                        <Button
                            type="button"
                            onClick={() => {
                                startTransition(() => setIsMaritimeLayerEnabled((current) => !current));
                            }}
                            className={`h-10 w-full rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm ${
                                isMaritimeLayerEnabled
                                    ? 'border border-black/10 bg-slate-900 text-white hover:bg-slate-800 dark:border-white/10 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100'
                                    : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                            }`}
                        >
                            {isMaritimeLayerEnabled && isMaritimeLoading && !maritimeFeed ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Ship className="mr-2 h-4 w-4" />
                            )}
                            {isMaritimeLayerEnabled
                                ? t('כבה שכבת כלי שיט', 'Turn off vessel layer')
                                : t('הפעל שכבת כלי שיט', 'Enable vessel layer')}
                        </Button>

                        {!isMaritimeLayerEnabled && (
                            <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{maritimeIdleHint}</p>
                        )}

                        <div>
                            <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                                {t('תצוגה', 'Display')}
                            </p>
                            <Select value={oilAndGasDisplayMode} onValueChange={(value) => setOilAndGasDisplayMode(value as OilAndGasDisplayMode)}>
                                <SelectTrigger className="h-9 w-full rounded-xl border-black/10 bg-white/80 text-[10px] font-black uppercase tracking-widest dark:border-white/10 dark:bg-slate-950/80">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="border-black/10 bg-white dark:border-white/10 dark:bg-slate-950">
                                    <SelectItem value="combined">{t('משולב', 'Combined')}</SelectItem>
                                    <SelectItem value="vessels_only">{t('כלי שיט בלבד', 'Vessels only')}</SelectItem>
                                    <SelectItem value="on_ground_only">{t('קרקע בלבד', 'On-ground only')}</SelectItem>
                                </SelectContent>
                            </Select>
                            {hideCountryBordersForVesselsOnly && (
                                <p className="mt-1.5 text-[9px] leading-snug text-slate-500 dark:text-slate-500">
                                    {t(
                                        'גבולות מדינות מוסתרים במצב זה לתצוגה ימית נקייה. חזרו למשולב או קרקע כדי להציג שוב.',
                                        'Country borders stay hidden in this mode for a cleaner sea view. Switch to Combined or On-ground to show them again.'
                                    )}
                                </p>
                            )}
                        </div>

                        <label
                            htmlFor="mining-include-coastal-demo"
                            className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-black/5 bg-black/[0.02] px-2.5 py-2.5 dark:border-white/10 dark:bg-white/[0.03]"
                        >
                            <Checkbox
                                id="mining-include-coastal-demo"
                                checked={includeCoastalDemoVessels}
                                onCheckedChange={(value) => setIncludeCoastalDemoVessels(value === true)}
                                className="mt-0.5"
                            />
                            <span className="min-w-0 text-[9px] leading-snug text-slate-600 dark:text-slate-300">
                                <span className="font-semibold text-slate-800 dark:text-slate-100">
                                    {t(
                                        'הצג מיקומי הדגמה כשה־AIS דליל (מפרץ + חופי אפריקה)',
                                        'Show demo positions where AIS feed is sparse (Gulf + Africa coasts)',
                                    )}
                                </span>
                                <span className="mt-0.5 block text-slate-500 dark:text-slate-400">
                                    {t(
                                        'שולח include_coastal_demo=1 לשרת; נשמר בדפדפן. כבו לתצוגת מאגר בלבד.',
                                        'Sends include_coastal_demo=1 to the API; saved in the browser. Turn off for snapshot-only.',
                                    )}
                                </span>
                            </span>
                        </label>

                        {isMaritimeLayerEnabled && (
                            <>
                                <div className="flex items-center justify-between gap-2 rounded-xl border border-black/5 bg-black/[0.02] px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                                    <div className="flex min-w-0 items-center gap-2">
                                        {isMaritimeFetching && (
                                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-500" aria-hidden />
                                        )}
                                        <span className="truncate text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                                            {maritimeHeadlineStatus}
                                        </span>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => void refetchMaritime()}
                                        disabled={isMaritimeFetching}
                                        className="h-7 shrink-0 rounded-lg px-2 text-[8px] font-black uppercase tracking-widest text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-400"
                                    >
                                        <RefreshCw className={`mr-1 h-3 w-3 ${isMaritimeFetching ? 'animate-spin' : ''}`} />
                                        {t('רענון', 'Refresh')}
                                    </Button>
                                </div>

                                {maritimeSparseWarning && (
                                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[9px] leading-snug text-amber-800 dark:text-amber-200">
                                        {maritimeSparseWarning}
                                    </p>
                                )}

                                {maritimeViewportAisGap && (
                                    <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[9px] leading-snug text-amber-900 dark:text-amber-100">
                                        {t(
                                            'אין AIS חי באזור זה — המאגר מכיל כלי שיט באזורים אחרים (למשל אירופה). הרחב את maritime-worker, או סמן «מיקומי הדגמה» לתצוגה סינתטית.',
                                            'No live AIS in this region — the feed has vessels elsewhere (e.g. Europe). Expand maritime-worker watches or enable demo positions in the checkbox above.',
                                        )}
                                    </p>
                                )}

                                {maritimeLodUiNote && (
                                    <p className="rounded-lg border border-slate-500/25 bg-slate-500/10 px-2.5 py-2 text-[9px] leading-snug text-slate-700 dark:text-slate-200">
                                        {maritimeLodUiNote}
                                    </p>
                                )}

                                {maritimeClusterClarification && (
                                    <p className="text-[9px] leading-snug text-slate-500 dark:text-slate-400">
                                        {maritimeClusterClarification}
                                    </p>
                                )}

                                {(((maritimeFeed?.coastal_demo_regions?.length ?? 0) > 0) ||
                                    maritimeFeed?.persian_gulf_demo_synthetic) && (
                                    <p className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-2 text-[9px] leading-snug text-cyan-900 dark:text-cyan-100">
                                        {(maritimeFeed?.coastal_demo_regions?.length ?? 0) > 0 && (
                                            <span className="block font-semibold text-cyan-950 dark:text-cyan-50">
                                                {t(
                                                    `אזורי הדגמה: ${(maritimeFeed?.coastal_demo_regions ?? []).join(' · ')}.`,
                                                    `Demo regions: ${(maritimeFeed?.coastal_demo_regions ?? []).join(' · ')}.`,
                                                )}
                                            </span>
                                        )}
                                        <span className="mt-1 block">
                                            {(() => {
                                                const mode = maritimeFeed?.persian_gulf_demo_mode;
                                                if (mode === 'api_opt_in') {
                                                    return includeCoastalDemoVessels
                                                        ? t(
                                                              'נקודות סינתטיות/קובץ הדגמה (בקשת משתמש include_coastal_demo) לצד כלי שיט אמיתיים מהמאגר — לא AIS חי באותם תיבות.',
                                                              'Synthetic / seed-file demo positions (your include_coastal_demo opt-in) appear alongside real snapshot vessels—not live AIS in those boxes.',
                                                          )
                                                        : t(
                                                              'נקודות סינתטיות במפרץ (בקשת משתמש) לצד כלי שיט אמיתיים אחרים מהמאגר — לא AIS חי מהמפרץ.',
                                                              'Synthetic Gulf demo markers (your opt-in) appear alongside other real snapshot vessels in this feed—not live Gulf AIS.',
                                                          );
                                                }
                                                if (mode === 'env_coverage_gap') {
                                                    return t(
                                                        'נקודות הדגמה במפרץ (MARITIME_GULF_DEMO_SEED + פער AISStream) — לא AIS חי מהמפרץ.',
                                                        'Gulf demo positions (MARITIME_GULF_DEMO_SEED + AISStream gap)—not live Gulf AIS.',
                                                    );
                                                }
                                                if (mode === 'env_coastal_sparse') {
                                                    return t(
                                                        'נקודות הדגמה (MARITIME_COASTAL_DEMO_SEED) לתיבות יעד דלילות — לא AIS חי משוחזר.',
                                                        'Demo positions (MARITIME_COASTAL_DEMO_SEED) for sparse target boxes—not restored live AIS.',
                                                    );
                                                }
                                                return t(
                                                    'נקודות הדגמה — לא AIS חי באותם אזורים; שאר הסימנים עלולים להיות AIS אמיתי מהמאגר.',
                                                    'Demo positions—not live AIS in those areas; other markers may still be real snapshot AIS.',
                                                );
                                            })()}
                                        </span>
                                    </p>
                                )}

                                {maritimeFeed?.aisstream_persian_gulf_coverage_gap &&
                                    !maritimeFeed?.persian_gulf_demo_synthetic && (
                                        <p className="rounded-lg border border-slate-400/30 bg-slate-500/10 px-2.5 py-2 text-[9px] leading-snug text-slate-700 dark:text-slate-200">
                                            {t(
                                                'פער במקור AISStream במפרץ הפרסי — המפרץ עלול להיראות ריק למרות תנועה צפופה במקורות מסחריים.',
                                                'AIS feed gap in the Persian Gulf — the Gulf may look empty even when commercial trackers show dense traffic.'
                                            )}{' '}
                                            <a
                                                href={
                                                    maritimeFeed.maritime_aisstream_issue_url ||
                                                    'https://github.com/aisstream/aisstream/issues/17'
                                                }
                                                target="_blank"
                                                rel="noreferrer"
                                                className="font-semibold text-cyan-700 underline underline-offset-2 hover:text-cyan-600 dark:text-cyan-300 dark:hover:text-cyan-200"
                                            >
                                                {t('מעקב בעיה', 'Track issue')}
                                            </a>
                                        </p>
                                    )}

                                <button
                                    type="button"
                                    onClick={() => setMaritimeAdvancedOpen((o) => !o)}
                                    className="flex w-full items-center justify-between rounded-xl border border-black/10 px-2.5 py-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.04]"
                                >
                                    {t('מתקדם', 'Advanced')}
                                    {maritimeAdvancedOpen ? (
                                        <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                    ) : (
                                        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                    )}
                                </button>

                                {maritimeAdvancedOpen && (
                                    <div className="space-y-2.5 border-t border-black/5 pt-2.5 dark:border-white/5">
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            <div>
                                                <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                                                    {t('מכסה', 'Cap')}
                                                </p>
                                                <Select value={maritimeMaxVessels} onValueChange={setMaritimeMaxVessels}>
                                                    <SelectTrigger className="h-8 w-full rounded-lg border-black/10 bg-white/70 text-[9px] font-black uppercase tracking-widest dark:border-white/10 dark:bg-slate-950/70">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="border-black/10 bg-white dark:border-white/10 dark:bg-slate-950">
                                                        {MARITIME_MAX_VESSEL_OPTIONS.map((value) => (
                                                            <SelectItem key={value} value={value}>
                                                                {value} {t('כלי שיט', 'vessels')}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                                                    {t('חלון לכידה', 'Capture')}
                                                </p>
                                                <Select value={maritimeCaptureWindow} onValueChange={setMaritimeCaptureWindow}>
                                                    <SelectTrigger className="h-8 w-full rounded-lg border-black/10 bg-white/70 text-[9px] font-black uppercase tracking-widest dark:border-white/10 dark:bg-slate-950/70">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="border-black/10 bg-white dark:border-white/10 dark:bg-slate-950">
                                                        {MARITIME_CAPTURE_WINDOW_OPTIONS.map((value) => (
                                                            <SelectItem key={value} value={value}>
                                                                {value}s
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="space-y-2 rounded-xl border border-cyan-500/15 bg-cyan-500/5 px-2.5 py-2.5">
                                            <p className="text-[8px] font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-400">
                                                {t('מסנני תצוגה (מקומיים)', 'Display filters (client-side)')}
                                            </p>
                                            <Input
                                                value={vesselFilters.search}
                                                onChange={(e) => setVesselFilters((f) => ({ ...f, search: e.target.value }))}
                                                placeholder={t('חיפוש שם, MMSI, IMO…', 'Search name, MMSI, IMO…')}
                                                className="h-8 rounded-lg border-black/10 bg-white/80 text-[10px] dark:border-white/10 dark:bg-slate-950/80"
                                            />
                                            <div className="flex flex-wrap gap-1">
                                                {VESSEL_SHIP_TYPE_OPTIONS.map((typeLabel) => {
                                                    const active = vesselFilters.shipTypes.includes(typeLabel);
                                                    return (
                                                        <button
                                                            key={typeLabel}
                                                            type="button"
                                                            onClick={() =>
                                                                setVesselFilters((f) => ({
                                                                    ...f,
                                                                    shipTypes: active
                                                                        ? f.shipTypes.filter((x) => x !== typeLabel)
                                                                        : [...f.shipTypes, typeLabel],
                                                                }))
                                                            }
                                                            className={`rounded-md px-2 py-0.5 text-[8px] font-black uppercase tracking-widest border ${
                                                                active
                                                                    ? 'border-cyan-500/40 bg-cyan-500/20 text-cyan-600 dark:text-cyan-300'
                                                                    : 'border-black/10 bg-white/50 text-slate-500 dark:border-white/10 dark:bg-slate-900/50'
                                                            }`}
                                                        >
                                                            {typeLabel}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                                                        {t('מהירות מינ׳ (kn)', 'Min speed (kn)')}
                                                    </p>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        step={0.1}
                                                        value={vesselFilters.minSpeedKnots ?? ''}
                                                        onChange={(e) =>
                                                            setVesselFilters((f) => ({
                                                                ...f,
                                                                minSpeedKnots: e.target.value === '' ? null : Number(e.target.value),
                                                            }))
                                                        }
                                                        className="h-8 rounded-lg border-black/10 bg-white/80 text-[10px] dark:border-white/10 dark:bg-slate-950/80"
                                                    />
                                                </div>
                                                <div>
                                                    <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                                                        {t('מהירות מקס׳ (kn)', 'Max speed (kn)')}
                                                    </p>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        step={0.1}
                                                        value={vesselFilters.maxSpeedKnots ?? ''}
                                                        onChange={(e) =>
                                                            setVesselFilters((f) => ({
                                                                ...f,
                                                                maxSpeedKnots: e.target.value === '' ? null : Number(e.target.value),
                                                            }))
                                                        }
                                                        className="h-8 rounded-lg border-black/10 bg-white/80 text-[10px] dark:border-white/10 dark:bg-slate-950/80"
                                                    />
                                                </div>
                                            </div>
                                            {maritimeVesselsInViewport.length > maritimeVessels.length && (
                                                <p className="text-[9px] text-slate-500">
                                                    {t(
                                                        `מוצגים ${maritimeVessels.length} מתוך ${maritimeVesselsInViewport.length} לאחר סינון.`,
                                                        `Showing ${maritimeVessels.length} of ${maritimeVesselsInViewport.length} after filters.`
                                                    )}
                                                </p>
                                            )}
                                        </div>

                                        <div className="rounded-xl border border-black/5 bg-black/[0.03] px-2 py-1.5 dark:border-white/10 dark:bg-white/[0.04]">
                                            <p className="mb-0.5 text-[8px] font-black uppercase tracking-widest text-slate-500">
                                                {t('מקרא סימני כלי שיט', 'Vessel markers')}
                                            </p>
                                            <p className="mb-1 text-[9px] leading-snug text-slate-500">
                                                {t(
                                                    'הסימון מצביע לכיוון השייט (צפון מעלה). צבע המילוי לפי קטגוריית סוג AIS. בזום עולמי מוצגת דגימת LOD (מכליות מועדפות) — לא קיבוץ; בזום אזורי מוצגים כל כלי השיט בתצוגה.',
                                                    `Chevron points along heading (north up). Fill color follows AIS ship-type category. Below zoom ${LOD_FULL_DETAIL_ZOOM} the map may subsample icons for performance (tankers preferred)—not clustering; zoom in for every in-view vessel.`
                                                )}
                                            </p>
                                            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                                                {MARITIME_LEGEND_KEYS.map((key) => (
                                                    <span key={key} className="inline-flex items-center gap-0.5 text-[8px] text-slate-400">
                                                        <span
                                                            className="h-2 w-2 shrink-0 rounded-[1px] border border-white/25"
                                                            style={{ backgroundColor: VESSEL_CATEGORY_COLORS[key] }}
                                                            aria-hidden
                                                        />
                                                        <span>{t(VESSEL_LEGEND_T[key][0], VESSEL_LEGEND_T[key][1])}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Badge className="border-none bg-cyan-500/10 text-[8px] font-black uppercase text-cyan-500">
                                                {t('כל כלי השיט', 'All vessels')}
                                            </Badge>
                                            <Badge className="border-none bg-slate-950/10 text-[8px] font-black uppercase text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                                {Number(maritimeCaptureWindow)}s
                                            </Badge>
                                            <Badge className="border-none bg-slate-950/10 text-[8px] font-black uppercase text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                                {t('מכסה', 'Cap')} {Number(maritimeMaxVessels)}
                                            </Badge>
                                            {maritimeFeed?.cap_applied && (
                                                <Badge className="border-none bg-amber-500/10 text-[8px] font-black uppercase text-amber-500">
                                                    {t('לא הכל נטען', 'Cap applied')}
                                                </Badge>
                                            )}
                                            {maritimeFeed?.cached && (
                                                <Badge className="border-none bg-amber-500/10 text-[8px] font-black uppercase text-amber-500">
                                                    {t('מטמון', 'Cached')}
                                                </Badge>
                                            )}
                                        </div>

                                        <div className="min-w-0">
                                            <p className="truncate text-[9px] font-black uppercase tracking-widest text-slate-500">
                                                {maritimeFeed?.source || t('ממתין לטעינה', 'Waiting to load')}
                                            </p>
                                            <p className="text-[9px] text-slate-500">
                                                {maritimeFeed?.geography_mode === 'viewport_bbox'
                                                    ? t('מבוסס על גבולות המפה הנוכחיים', 'Using the current map bounds')
                                                    : maritimeFeed?.geography_mode === 'sampled_viewport_regions'
                                                        ? t(
                                                              'תצוגה רחבה מדי ולכן מתבצע דגימה אזורית בתוך המבט',
                                                              'View is too wide, so the watch samples regions inside it'
                                                          )
                                                        : t(
                                                              'ללא bbox זמין מוחלות גאוגרפיות ברירת מחדל',
                                                              'Default watch regions apply when no viewport bbox is available'
                                                          )}
                                            </p>
                                        </div>

                                        <p className="text-[9px] leading-snug text-slate-500">{maritimeDetailNote}</p>

                                        {maritimeFeed?.geography_note && (
                                            <p className="text-[9px] leading-snug text-slate-500">{maritimeFeed.geography_note}</p>
                                        )}
                                        {maritimeFeed?.total_available != null && (
                                            <p className="text-[9px] leading-snug text-slate-500">
                                                {t(
                                                    `זמינים ${maritimeFeed.total_available}, הוחזרו ${maritimeFeed.returned_count ?? maritimeVessels.length}.`,
                                                    `${maritimeFeed.total_available} available, ${maritimeFeed.returned_count ?? maritimeVessels.length} returned.`
                                                )}
                                            </p>
                                        )}
                                        {maritimeFeed?.cap_applied && (
                                            <p className="text-[9px] leading-snug text-slate-500">
                                                {t(
                                                    'המכסה מגבילה את התוצאה לביצועים. הגדל מכסה או הזז/קרב מפה כדי לראות יותר.',
                                                    'Cap limits this result for performance. Increase cap or narrow the viewport to see more.'
                                                )}
                                            </p>
                                        )}
                                        {maritimeLimitationText && (
                                            <p className="text-[9px] leading-snug text-slate-500">{maritimeLimitationText}</p>
                                        )}
                                        {maritimeError && (
                                            <p className="text-[9px] leading-snug text-red-500">
                                                {maritimeError instanceof Error
                                                    ? maritimeError.message
                                                    : t('שגיאת טעינה לא ידועה', 'Unknown vessel loading error')}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
            <MapContainer 
              center={mapCenter} 
              zoom={
                viewModeKey === 'ports' || oilLiveSidebarActive
                  ? 3
                  : viewModeKey === 'route_planner'
                    ? 4
                    : 7
              } 
              className="w-full h-full"
              zoomControl={false}
              preferCanvas
              // @ts-ignore
              ref={mapRef}
            >
                <ZoomControl position="bottomleft" />
                <MapClickHandler
                    routePlannerPickRole={isRoutePlannerView ? routePlannerPickRole ?? undefined : undefined}
                    onRoutePlannerMapPick={isRoutePlannerView ? onRoutePlannerMapPick : undefined}
                    onMapClick={() => {
                      setSelectedItem(null);
                      onSelectMaritimeVessel(null);
                      if (isLiveDataView) onOilLiveDismiss?.();
                    }}
                />
                <ViewportBoundsTracker
                    active={isMaritimeMapView && isMaritimeLayerEnabled}
                    debounceMs={50}
                    onBoundsChange={setMaritimeViewport}
                />
                <ViewportBoundsTracker active={isMobileDevice} onBoundsChange={setCurrentVisibleViewport} />
                <ViewportBoundsTracker
                    active={Boolean(onLicenseMapViewportChange) && isLicenseMapView && !isLiveDataView}
                    debounceMs={0}
                    onBoundsChange={(bbox) => onLicenseMapViewportChange?.(bbox)}
                />
                <ViewportBoundsTracker
                    active={isOilAndGasView}
                    debounceMs={100}
                    onBoundsChange={setOilGasMapViewport}
                />
                <ViewportBoundsTracker
                    active={isLiveDataView && oilLiveOverlaysEnabled}
                    debounceMs={100}
                    onBoundsChange={setLiveDataMapViewport}
                />
                {isMobileDevice && mobileFilteredData.capped && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-slate-950/85 text-slate-100 border border-cyan-500/20 rounded-2xl px-4 py-2 shadow-2xl backdrop-blur-xl">
                        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300 text-center">
                            {t('ביצועי מובייל אופטימליים', 'Mobile performance optimized')}
                        </p>
                        <p className="text-[10px] text-slate-400 text-center text-xs">
                            {t(
                                'מוצגות רק 800 הקונססיות הקרובות ביותר. עשה זום-אין לצפייה בשאר.',
                                'Showing nearest 800 concessions only. Zoom in to view others.'
                            )}
                        </p>
                    </div>
                )}
                {isOilAndGasView && onGroundVisible && (
                    <MapZoomTracker onZoomChange={setPetroleumMapZoom} />
                )}
                {isMaritimeMapView && isMaritimeLayerEnabled && (
                    <MapZoomTracker onZoomChange={setMaritimeMapZoom} />
                )}
                <MapEffect selectedItem={selectedItem} mapFlyTrigger={mapFlyTrigger} flyTarget={flyTarget} />
                <LicenseMapPopupController
                    selectedItem={selectedItem}
                    mapFlyTrigger={mapFlyTrigger}
                    markerRefs={markerRefs}
                    clusterGroupRef={clusterGroupRef}
                    userAnnotations={userAnnotations}
                    updateAnnotation={updateAnnotation}
                    deleteLicense={deleteLicense}
                    handleOpenDossier={handleOpenDossier}
                    isInDdQueue={isInDdQueue}
                    onAddToDueDiligence={onAddToDueDiligence}
                    onRemoveFromDueDiligence={onRemoveFromDueDiligence}
                    getDealRoomForLicense={getDealRoomForLicense}
                />
                <RoutePlannerBoundsEffect overlay={isRoutePlannerView ? routePlannerOverlay : null} />
                <RoutePlannerFlyEffect
                  target={isRoutePlannerView ? routePlannerFlyTarget : null}
                  trigger={isRoutePlannerView ? routePlannerFlyTrigger : 0}
                />
                <RoutePlannerMapResizeEffect
                  active={isRoutePlannerView}
                  resizeKey={
                    isRoutePlannerView
                      ? `${routePlannerOverlay?.legs.length ?? 0}:${routePlannerOverlay?.waypoints.length ?? 0}`
                      : 0
                  }
                />
                <CountryFocusBoundsFly
                    active={Boolean(countryFocusCountry?.trim())}
                    geojson={filteredGeoJson ?? null}
                    trigger={countryFocusBoundsTrigger}
                />
                {isLiveDataView && (
                    <LiveDataMapFly trigger={liveDataFlyTrigger} target={liveDataFlyTarget} />
                )}
                {viewModeKey === 'ports' && processedData.length > mapDisplayData.length && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-slate-950/85 text-slate-100 border border-cyan-500/20 rounded-2xl px-4 py-2 shadow-2xl backdrop-blur-xl">
                        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300 text-center">
                            {t('מפה מוגבלת לביצועים', 'Map limited for performance')}
                        </p>
                        <p className="text-[10px] text-slate-400 text-center">
                            {t(
                                'מוצגים רק 3000 הצמתים הראשונים אחרי סינון. השתמש בחיפוש/מדינה כדי לצמצם.',
                                'Showing only the first 3000 filtered nodes. Use search or country filters to narrow.'
                            )}
                        </p>
                    </div>
                )}
                
                <MapBasemapLayers isDark={isDark}>
                    <LayersControl.Overlay checked name={t("אזורי שימור סביבתיים (ESG)", "ESG Protected Zones")}>
                        <FeatureGroup>
                            {ESG_CONSERVATION_ZONES.map((zone, idx) => (
                                <Circle
                                    key={idx}
                                    center={zone.center}
                                    radius={zone.radius}
                                    pathOptions={{
                                        color: zone.color,
                                        fillColor: zone.fillColor,
                                        fillOpacity: 0.15,
                                        weight: 2.2,
                                        dashArray: "6, 6"
                                    }}
                                    eventHandlers={{
                                        click: (e) => {
                                            L.DomEvent.stopPropagation(e);
                                        },
                                    }}
                                >
                                    <Popup
                                        className="esg-leaflet-popup"
                                        minWidth={320}
                                        maxWidth={380}
                                        autoPanPadding={[16, 16]}
                                    >
                                        <EsgProtectedZonePopup zone={zone} />
                                    </Popup>
                                </Circle>
                            ))}
                        </FeatureGroup>
                    </LayersControl.Overlay>

                    {filteredGeoJson && !hideCountryBordersForVesselsOnly && !isRoutePlannerView && (
                        <LayersControl.Overlay checked={!isOilAndGasView} name={t("גבולות מדינות", "Country borders")}>
                            <GeoJSON
                                key={`${borderCountries.join(',')}:${isDark ? 'd' : 'l'}:${countryFocusCountry ?? 'all'}`}
                                data={filteredGeoJson}
                                interactive={false}
                                style={countryBorderLayerStyle}
                            />
                        </LayersControl.Overlay>
                    )}
                    {isLiveDataView && oilLiveOverlaysEnabled && (
                        <OilLiveMapOverlays
                            enabled
                            productFilter={oilLiveProductFilter}
                            terminalSearch={oilLiveTerminalSearch}
                            layers={oilLiveLayers}
                            tradeFlowGroup={oilLiveTradeFlowGroup}
                            viewport={liveDataMapViewport}
                            onStatsChange={onOilLiveStatsChange}
                            onEntityClick={onOilLiveEntityClick}
                        />
                    )}
                    {eiaHistoricMapEnabled && (eiaHistoricMapArcs.length > 0 || (eiaHistoricMapOrigins?.length ?? 0) > 0) && (
                        <EiaHistoricMapLayer
                            enabled={eiaHistoricMapEnabled}
                            arcs={eiaHistoricMapArcs}
                            origins={eiaHistoricMapOrigins}
                            year={eiaHistoricMapYear}
                            showCorridors={eiaHistoricShowCorridors}
                            onSelectImporter={onEiaHistoricSelectImporter}
                        />
                    )}
                    {macroTradeFlowsEnabled && macroTradeFlows.length > 0 && (
                        <MacroTradeFlowsMapLayer
                            enabled={macroTradeFlowsEnabled}
                            flows={macroTradeFlows}
                        />
                    )}
                    {showInfrastructureLayers && onGroundVisible && !isLiveDataView && (
                        <OsmPetroleumMapLayers
                            bbox={WORLD_PETROLEUM_PRELOAD_BBOX}
                            enabled
                            layerVisibility={infrastructureLayerVisibility}
                        />
                    )}
                    {isOilAndGasView && onGroundVisible && (
                        <>
                            <PetroleumMapLayers
                                bbox={WORLD_PETROLEUM_PRELOAD_BBOX}
                                mapZoom={petroleumDetailZoom}
                                enabled={isOilAndGasView && onGroundVisible}
                            />
                            <OsmPetroleumMapLayers
                                bbox={WORLD_PETROLEUM_PRELOAD_BBOX}
                                enabled={isOilAndGasView && onGroundVisible}
                            />
                            <StorageTankFarmsMapLayer
                                entities={storageEntities}
                                enabled={isOilAndGasView && onGroundVisible}
                                mapZoom={petroleumDetailZoom}
                                selectedId={selectedItem?.entityKind === 'storage_terminal' ? selectedItem.id : null}
                                onSelect={(item) => {
                                    onSelectMaritimeVessel(null);
                                    setSelectedItem(item);
                                }}
                            />
                        </>
                    )}
                    {vesselsVisible && isMaritimeLayerEnabled && (
                        <LayersControl.Overlay checked={isMaritimeLayerEnabled} name={vesselLayerLabel}>
                            <LayerGroup>
                                <CanvasVesselMarkers
                                    layerApiRef={canvasVesselLayerRef}
                                    mapZoom={maritimeMapZoom}
                                    selectedId={selectedMaritimeVessel?.id ?? null}
                                    onVesselClick={handleMaritimeVesselClick}
                                    formatTooltip={formatMaritimeVesselTooltip}
                                    onLayerReady={handleCanvasVesselLayerReady}
                                />
                            </LayerGroup>
                        </LayersControl.Overlay>
                    )}
                </MapBasemapLayers>
                {isMaritimeMapView && (!isLiveDataView || isMaritimeLayerEnabled) && (
                    <MaritimeLayerSync layerName={vesselLayerLabel} onLayerActiveChange={handleMaritimeLayerActiveChange} />
                )}

                {/* spiderLegPolylineOptions interactive:false prevents spider-leg polylines from
                    eating clicks meant for the spiderfied markers beneath them.
                    showCoverageOnHover:false removes the coverage polygon overlay that can
                    also intercept pointer events in dense areas. */}
                {onGroundVisible && !suppressLicenseClusters && (
                <MarkerClusterGroup
                    showCoverageOnHover={false}
                    iconCreateFunction={licenseClusterIconCreate}
                    spiderLegPolylineOptions={{
                        weight: 1.5,
                        color: isDark ? '#64748b' : '#334155',
                        opacity: isDark ? 0.5 : 0.65,
                        interactive: false,
                    }}
                >
                    <ClusterGroupRefBridge clusterGroupRef={clusterGroupRef} />
                    {renderedMarkers}
                </MarkerClusterGroup>
                )}
                {isRoutePlannerView && routePlannerShowPorts && routePlannerPorts.length > 0 && onRoutePlannerPortPick && (
                  <Suspense fallback={null}>
                    <RoutePlannerPortMarkers
                      ports={routePlannerPorts}
                      pickRole={routePlannerPickRole ?? null}
                      onPortPick={onRoutePlannerPortPick}
                    />
                  </Suspense>
                )}
                {isRoutePlannerView && routePlannerShowAirports && routePlannerAirports.length > 0 && onRoutePlannerAirportPick && (
                  <Suspense fallback={null}>
                    <RoutePlannerAirportMarkers
                      airports={routePlannerAirports}
                      pickRole={routePlannerPickRole ?? null}
                      onAirportPick={onRoutePlannerAirportPick}
                    />
                  </Suspense>
                )}
                {isRoutePlannerView && routePlannerOverlay && (
                  <RoutePlannerMapLayers overlay={routePlannerOverlay} />
                )}
            </MapContainer>
            {isRoutePlannerView && routePlannerOverlay && routePlannerOverlay.legs.length > 0 && (
              <RouteLegend className="absolute bottom-6 right-4 z-[900] max-w-[min(100vw-2rem,240px)]" />
            )}
        </div>
    );
}
