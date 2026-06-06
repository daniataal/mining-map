import {
    lazy,
    startTransition,
    Suspense,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { useOilLiveMapSyncStatus } from '../hooks/useOilLiveMapSyncStatus';
import { useMapLayerViewports } from '../hooks/useMapLayerViewports';
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
import { MiningLicense, UserAnnotation, MaritimeVessel, MaritimeTankerView, MaritimeViewportBounds, MaritimeVesselScope, OilAndGasDisplayMode } from '../types';
import { useMaritimeVessels } from '../lib/api';
import {
  applyVesselFilters,
  CanvasVesselLayer,
  filterVesselsByViewport,
  sortVesselsForDisplay,
  toVesselDrawRecords,
  planVesselLodDraw,
  LOD_FULL_DETAIL_ZOOM,
  MARITIME_LEGEND_KEYS,
  VESSEL_CATEGORY_COLORS,
  VESSEL_LEGEND_T,
  type VesselFilters,
} from '../lib/vessels';
import { buildMaritimeStatusMessages } from '../lib/vessels/maritimeFeedStatus';
import MaritimeLayerSync from './vessels/MaritimeLayerSync';
import MaritimeVesselFocusLayers from './vessels/MaritimeVesselFocusLayers';
import MaritimeFocusLegend from './vessels/MaritimeFocusLegend';
import CanvasVesselMarkers from './vessels/CanvasVesselMarkers';
import CanvasLiveDealLayer from './petroleum/CanvasLiveDealLayer';
import OsmPetroleumMapLayers from './petroleum/OsmPetroleumMapLayers';
import StorageTankFarmsMapLayer from './petroleum/StorageTankFarmsMapLayer';
import GemGoitPipelineMapLayer from './petroleum/GemGoitPipelineMapLayer';
import GemGogptPlantMapLayer from './petroleum/GemGogptPlantMapLayer';
import GemGgitLngMapLayer from './petroleum/GemGgitLngMapLayer';
import InfrastructureCoverageBanner from './petroleum/InfrastructureCoverageBanner';
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
import { LiveDataHealthMapStatus } from '../features/data-health/LiveDataHealthMapStatus.tsx';
import LiveDataMapCompanySearch from '../features/live-data/LiveDataMapCompanySearch';
import StsEventsMapLayer from '../features/live-data/StsEventsMapLayer';
import StsEventsMapStatus from '../features/live-data/StsEventsMapStatus';
import { useStsEventsSummary } from '../features/live-data/useStsEventsSummary';
import {
  LIVE_DATA_HUB_BOUNDS,
  LIVE_DATA_DEFAULT_LAYERS,
  GOVERNMENT_AIS_COVERAGE_SOURCES,
  viewportOverlapsPersianGulfHub,
  type LiveDataLensMode,
} from '../features/live-data/liveDataMapDefaults';
import { resolveLiveDataVesselStatus } from '../features/live-data/liveDataVesselStatus';
import { countEntitiesInViewport } from '../lib/viewportBounds';
import MapZoomTracker from './petroleum/MapZoomTracker';
import MapBasemapLayers from './map/MapBasemapLayers';
import {
    clusterTargetZoom,
    isServerLicenseCluster,
    LICENSE_CLIENT_CLUSTER_EXPAND_ZOOM,
    LICENSE_MAP_DEFAULT_ZOOM,
    licenseClusterVisualDrillZoom,
    planClusterDrillFly,
    serverClusterFlyBounds,
    SERVER_CLUSTER_MIN_DRILL_ZOOM,
} from '../lib/licenseMapCluster';
import { LICENSE_MAP_DOM_MARKER_CAP, MAP_VIEWPORT_DEBOUNCE_MS } from '../lib/mapViewportDebounce';
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
import { isLiveDealClientClusterData } from '../lib/liveDealMap/liveDealMapLod';
import type { LiveDealFeatureKind, LiveDealMapFeature } from '../lib/liveDealMap/liveDealMapTypes';
import { isCountryLicenseSummary, LICENSE_MAP_BORDER_COUNTRY_CAP } from '../lib/licenseCountrySummary';
import {
  createLicenseMarkerIconCache,
} from '../lib/licenseMarkerIconCache';
import {
  asLicenseMarkerClusterGroup,
  type LicenseMarkerClusterGroup,
} from '../lib/markerClusterTypes';
import LicenseMapPopupController from './map/LicenseMapPopupController';
import MapOverlayStatusPanel from './map/MapOverlayStatusPanel';
import MapEmptyStateOverlay from './map/MapEmptyStateOverlay';
import MapCoverageBanners from './map/MapCoverageBanners';
import MaritimeControlPanel from './map/MaritimeControlPanel';
import LayerDrawer from './map/LayerDrawer';
import { MapIntelligenceLegend } from './map/MapIntelligenceLegend';
import type { IntelligenceMode, IntelligenceSublayer } from '../lib/intelligenceModes';
import MaritimeAdvancedControls from './map/MaritimeAdvancedControls';
import { useCountryBordersLayer } from './map/useCountryBordersLayer';
import { resolvePetroleumViewportBounds } from '../lib/petroleumLayers';
import { useLicenseDisplayData } from './map/useLicenseDisplayData';
import { useLicenseInteractions } from './map/useLicenseInteractions';
import { useLicenseMarkerVisuals } from './map/useLicenseMarkerVisuals';
import { useLicenseMarkerNodes } from './map/useLicenseMarkerNodes';
import { useMarkerSelectionVisual } from './map/useMarkerSelectionVisual';
import EsgProtectedZonePopup from './esg/EsgProtectedZonePopup';
import {
  ESG_CONSERVATION_ZONES,
  getEsgZoneIntersection,
} from '../lib/esgConservationZones';
import { WorkspaceMapLayer } from '../features/broker-workspace/WorkspaceMapLayer';
import type { WorkspaceMapSnapshot } from '../api/brokerWorkspaceApi';

import { Badge } from './ui/badge';
import { Button } from './ui/button';
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


const MARITIME_MAX_VESSEL_OPTIONS = ['1000', '2000', '5000', '10000', '15000'];

const MARITIME_CAPTURE_WINDOW_OPTIONS = ['10', '15', '25', '30'];
const MARITIME_TANKER_VIEW_OPTIONS: { value: MaritimeTankerView; labelHe: string; labelEn: string }[] = [
    { value: 'worldwide', labelHe: 'מכליות בעולם', labelEn: 'Worldwide Tankers' },
    { value: 'middle_east', labelHe: 'מזרח תיכון', labelEn: 'Middle East' },
    { value: 'persian_gulf', labelHe: 'המפרץ הפרסי', labelEn: 'Persian Gulf' },
    { value: 'strait_of_hormuz', labelHe: 'הורמוז', labelEn: 'Hormuz' },
    { value: 'gulf_of_oman', labelHe: 'מפרץ עומאן', labelEn: 'Gulf of Oman' },
    { value: 'fujairah', labelHe: "פוג'יירה", labelEn: 'Fujairah' },
    { value: 'dubai_jebel_ali', labelHe: 'דובאי / ג׳בל עלי', labelEn: 'Dubai / Jebel Ali' },
    { value: 'ras_tanura', labelHe: 'ראס תנורה', labelEn: 'Ras Tanura' },
    { value: 'qatar_ras_laffan', labelHe: 'קטאר / ראס לפאן', labelEn: 'Qatar / Ras Laffan' },
    { value: 'kuwait_iraq_terminals', labelHe: 'כווית / עיראק', labelEn: 'Kuwait / Iraq terminals' },
];
const MARITIME_TANKER_VIEW_BOUNDS: Partial<Record<MaritimeTankerView, [[number, number], [number, number]]>> = {
    middle_east: [[16.0, 46.0], [31.5, 62.0]],
    persian_gulf: [[23.5, 47.5], [30.8, 56.8]],
    strait_of_hormuz: [[25.3, 55.9], [27.0, 57.3]],
    gulf_of_oman: [[22.0, 56.0], [26.8, 61.5]],
    fujairah: [[24.85, 56.20], [25.45, 56.75]],
    dubai_jebel_ali: [[24.80, 54.70], [25.45, 55.45]],
    ras_tanura: [[26.30, 49.70], [27.20, 50.40]],
    qatar_ras_laffan: [[24.5, 50.5], [27.0, 52.4]],
    kuwait_iraq_terminals: [[28.5, 47.5], [30.8, 49.9]],
};

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
  /** Map zoom for license clustering and overlay LOD. */
  onLicenseMapZoomChange?: (zoom: number) => void;
  /** Current map zoom for license clustering (from App). */
  licenseMapZoom?: number;
  /** After cluster drill fly completes — refetch with expanded grid-cell bbox. */
  onLicenseClusterDrillComplete?: (expandBounds: MaritimeViewportBounds, zoom?: number) => void;
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
  onOilGasMapViewportChange?: (bbox: MaritimeViewportBounds | null) => void;
  /** Live Data mode — oil-live-intel map overlays. */
  oilLiveOverlaysEnabled?: boolean;
  oilLiveProductFilter?: string;
  oilLiveTerminalSearch?: string;
  oilLiveLens?: LiveDataLensMode;
  onOilLiveLensChange?: (lens: LiveDataLensMode) => void;
  oilLiveLayers?: OilLiveLayerVisibility;
  onOilLiveLayersChange?: (layers: OilLiveLayerVisibility) => void;
  oilLiveTradeFlowGroup?: 'company_pair' | 'country_pair';
  onOilLiveTradeFlowGroupChange?: (group: 'company_pair' | 'country_pair') => void;
  oilLiveCoverageStats?: {
    terminals: number;
    vessels: number;
    opportunities: number;
    corridors: number;
    vesselMeta?: import('../api/oilLiveApi').OilLiveVesselMeta | null;
  } | null;
  onOilLiveStatsChange?: (stats: {
    terminals: number;
    vessels: number;
    opportunities: number;
    corridors: number;
    vesselMeta?: import('../api/oilLiveApi').OilLiveVesselMeta | null;
  }) => void;
  liveDataMacroTradeOn?: boolean;
  onLiveDataMacroTradeChange?: (on: boolean) => void;
  liveDataEiaHistoricOn?: boolean;
  onLiveDataEiaHistoricChange?: (on: boolean) => void;
  oilLiveSidebarActive?: boolean;
  onOpenDataHealth?: () => void;
  onOilLiveEntityClick?: (payload: OilLiveEntityClickPayload) => void;
  onOilLiveDismiss?: () => void;
  /** Fly map when a Live Data search hit has coordinates. */
  onLiveDataMapFlyTo?: (lat: number, lng: number) => void;
  /** Increment when entering Live Data to fly map to Gulf hub bbox. */
  liveDataFlyTrigger?: number;
  /** When set, fly to this point instead of the default hub (search hit). */
  liveDataFlyTarget?: { lat: number; lng: number } | null;
  /** Sidebar Companies tab hover — highlight linked map point. */
  liveDataCompanyHover?: import('../features/live-data/liveDataCompanyMapHover').LiveDataCompanyMapHover | null;
  /** EIA historic file-import corridor arcs (purple dashed). */
  eiaHistoricMapEnabled?: boolean;
  eiaHistoricMapArcs?: EiaHistoricMapArc[];
  eiaHistoricMapOrigins?: EiaHistoricMapOrigin[];
  eiaHistoricMapYear?: number;
  eiaHistoricShowCorridors?: boolean;
  onEiaHistoricSelectImporter?: (importerName: string) => void;
  onEiaHistoricViewArcDetails?: (
    selection: import('../features/live-data/HistoricArcDetailDrawer').HistoricArcSelection,
  ) => void;
  /** Hide mining license clusters so historic EIA points are clickable */
  suppressLicenseClusters?: boolean;
  /** Do not paint license markers (Historic / Live Data tabs). */
  hideLicenseMarkers?: boolean;
  /** Show OSM petroleum infrastructure on mining/global/oil views. */
  showInfrastructureLayers?: boolean;
  infrastructureLayerVisibility?: Record<OsmPetroleumLayerId, boolean>;
  infrastructureForcedLayers?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  infrastructureMapZoom?: number;
  infrastructureMapBbox?: import('../lib/petroleumLayers').PetroleumViewportBounds | null;
  infrastructurePanelHint?: 'zoom' | 'off' | null;
  onInfrastructureLayerChange?: (layerId: OsmPetroleumLayerId, visible: boolean) => void;
  onInfrastructureFeatureClick?: (
    selection: import('../features/infrastructure/InfrastructureFeatureDrawer').InfrastructureFeatureSelection,
  ) => void;
  /** Comtrade/Census macro country-pair arcs (gray). */
  macroTradeFlowsEnabled?: boolean;
  macroTradeFlows?: MacroTradeFlow[];
  brokerWorkspaceMap?: WorkspaceMapSnapshot;
  brokerPackLocationMode?: boolean;
  onBrokerPackLocationPick?: (lat: number, lng: number) => void;
  onBrokerPackSelect?: (packId: string) => void;
  onAddToBrokerWorkspace?: (
    body: { entity_type: string; ref_kind: string; ref_id: string; display_name: string; lat: number; lng: number; deal_signal?: string },
  ) => void;
  cockpitEnabled?: boolean;
  cockpitLegendMode?: IntelligenceMode;
  cockpitLegendSublayer?: IntelligenceSublayer;
  onCountrySelect?: (country: string) => void;
}

/** Max markers before we always zoom instead of spiderfy (spiderfy disabled anyway). */
const LICENSE_CLUSTER_FIT_MAX_ZOOM = 14;
const LICENSE_CANVAS_CLUSTER_MAX_ZOOM = 13;
const LICENSE_CANVAS_CLUSTER_MIN_COUNT = 10;
const LICENSE_CANVAS_CLUSTER_KINDS: readonly LiveDealFeatureKind[] = [
    'license',
    'refinery',
    'oil_field',
];

type PendingLicenseClusterFly = MiningLicense & {
    _clientCluster?: boolean;
    _clientClusterBounds?: MaritimeViewportBounds;
};

/** Capture the Leaflet MarkerClusterGroup instance for popup timing. */
function ClusterGroupRefBridge({
    clusterGroupRef,
    onSingleMarkerClusterClick,
    onLicenseMapZoomChange,
    onLicenseClusterDrillComplete,
}: {
    clusterGroupRef: React.MutableRefObject<LicenseMarkerClusterGroup | null>;
    onSingleMarkerClusterClick?: (marker: L.Marker) => void;
    onLicenseMapZoomChange?: (zoom: number) => void;
    onLicenseClusterDrillComplete?: (expandBounds: MaritimeViewportBounds, zoom?: number) => void;
}) {
    const map = useMap();
    const { layerContainer } = useLeafletContext();
    const onSingleMarkerClusterClickRef = useRef(onSingleMarkerClusterClick);
    const onLicenseMapZoomChangeRef = useRef(onLicenseMapZoomChange);
    const onLicenseClusterDrillCompleteRef = useRef(onLicenseClusterDrillComplete);
    onSingleMarkerClusterClickRef.current = onSingleMarkerClusterClick;
    onLicenseMapZoomChangeRef.current = onLicenseMapZoomChange;
    onLicenseClusterDrillCompleteRef.current = onLicenseClusterDrillComplete;
    useEffect(() => {
        const group = asLicenseMarkerClusterGroup(layerContainer);
        clusterGroupRef.current = group;
        const onClusterClick = (event: L.LeafletEvent) => {
            const layer = event.layer as L.Layer & {
                getAllChildMarkers?: () => L.Marker[];
                getLatLng?: () => L.LatLng;
            };
            const children = layer.getAllChildMarkers?.() ?? [];
            if (children.length === 1 && onSingleMarkerClusterClickRef.current) {
                L.DomEvent.stopPropagation(event);
                onSingleMarkerClusterClickRef.current(children[0]);
                return;
            }
            if (children.length > 1) {
                L.DomEvent.stopPropagation(event);
                const bounds = L.latLngBounds(children.map((m) => m.getLatLng()));
                const padded = bounds.pad(0.15);
                const fitMaxZoom = Math.max(
                    clusterTargetZoom(map.getZoom()),
                    Math.min(
                        LICENSE_CLUSTER_FIT_MAX_ZOOM,
                        map.getBoundsZoom(bounds.pad(0.12)) ?? clusterTargetZoom(map.getZoom()),
                    ),
                );
                map.stop();
                map.flyToBounds(padded, {
                    maxZoom: fitMaxZoom,
                    duration: 0.55,
                    padding: [32, 32],
                });
                const syncZoom = () => {
                    const zoom = map.getZoom();
                    onLicenseMapZoomChangeRef.current?.(zoom);
                    onLicenseClusterDrillCompleteRef.current?.(
                        {
                            south: padded.getSouth(),
                            west: padded.getWest(),
                            north: padded.getNorth(),
                            east: padded.getEast(),
                        },
                        zoom,
                    );
                };
                map.once('moveend', syncZoom);
            }
        };
        if (group) {
            group.on('clusterclick', onClusterClick);
        }
        return () => {
            if (group) {
                group.off('clusterclick', onClusterClick);
            }
            if (clusterGroupRef.current === group) {
                clusterGroupRef.current = null;
            }
        };
    }, [map, layerContainer, clusterGroupRef]);
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

/** Fly into a server-side license cluster; sync zoom/bbox from map on moveend (zoom ≥ 7 → points). */
const LicenseClusterFlyEffect = ({
    cluster,
    onLicenseMapZoomChange,
    onLicenseMapViewportChange,
    onLicenseClusterDrillComplete,
    onComplete,
}: {
    cluster: PendingLicenseClusterFly | null;
    onLicenseMapZoomChange?: (zoom: number) => void;
    onLicenseMapViewportChange?: (bbox: MaritimeViewportBounds) => void;
    onLicenseClusterDrillComplete?: (expandBounds: MaritimeViewportBounds, zoom?: number) => void;
    onComplete: () => void;
}) => {
    const map = useMap();
    const onLicenseMapZoomChangeRef = useRef(onLicenseMapZoomChange);
    const onLicenseMapViewportChangeRef = useRef(onLicenseMapViewportChange);
    const onLicenseClusterDrillCompleteRef = useRef(onLicenseClusterDrillComplete);
    const onCompleteRef = useRef(onComplete);
    const clusterRef = useRef(cluster);
    onLicenseMapZoomChangeRef.current = onLicenseMapZoomChange;
    onLicenseMapViewportChangeRef.current = onLicenseMapViewportChange;
    onLicenseClusterDrillCompleteRef.current = onLicenseClusterDrillComplete;
    onCompleteRef.current = onComplete;
    clusterRef.current = cluster;
    const clusterFlyId = cluster?.id ?? null;
    useEffect(() => {
        const clusterItem = clusterRef.current;
        if (!clusterFlyId || !clusterItem) return;
        const lat = clusterItem._displayLat ?? clusterItem.lat;
        const lng = clusterItem._displayLng ?? clusterItem.lng;
        if (lat == null || lng == null) {
            onCompleteRef.current();
            return;
        }
        const isClientCluster =
            clusterItem._clientCluster === true || clusterItem.id.startsWith('client-cluster:');
        const clusterCount = clusterItem.mapClusterCount ?? 0;
        const flyBox = isClientCluster && clusterItem._clientClusterBounds
            ? clusterItem._clientClusterBounds
            : serverClusterFlyBounds(lat, lng, clusterItem);
        const bounds = L.latLngBounds(
            [flyBox.south, flyBox.west],
            [flyBox.north, flyBox.east],
        );
        const boundsSpanDeg = Math.max(
            Math.abs(flyBox.north - flyBox.south),
            Math.abs(flyBox.east - flyBox.west),
        );
        const boundsFitZoom = map.getBoundsZoom(bounds, false, [36, 36]);
        const flyPlan = planClusterDrillFly(map.getZoom(), boundsSpanDeg, boundsFitZoom);
        const drillMaxZoom = Math.min(
            LICENSE_CLIENT_CLUSTER_EXPAND_ZOOM,
            flyPlan.mode === 'bounds'
                ? flyPlan.maxZoom
                : licenseClusterVisualDrillZoom(clusterCount, { clientCluster: isClientCluster }),
        );
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            let zoom = map.getZoom();
            if (!isClientCluster && zoom < SERVER_CLUSTER_MIN_DRILL_ZOOM) {
                map.setView([lat, lng], SERVER_CLUSTER_MIN_DRILL_ZOOM, { animate: false });
                zoom = map.getZoom();
            }
            const mapBounds = map.getBounds();
            if (mapBounds.isValid()) {
                onLicenseMapViewportChangeRef.current?.({
                    south: Number(mapBounds.getSouth().toFixed(4)),
                    west: Number(mapBounds.getWest().toFixed(4)),
                    north: Number(mapBounds.getNorth().toFixed(4)),
                    east: Number(mapBounds.getEast().toFixed(4)),
                });
            }
            onLicenseMapZoomChangeRef.current?.(zoom);
            onLicenseClusterDrillCompleteRef.current?.(flyBox, zoom);
            onCompleteRef.current();
        };
        map.stop();
        if (isClientCluster) {
            map.flyToBounds(bounds.pad(0.12), {
                maxZoom: drillMaxZoom,
                duration: 0.55,
                padding: [48, 48],
            });
        } else if (flyPlan.mode === 'center') {
            map.flyTo([lat, lng], drillMaxZoom, { duration: 0.75 });
        } else {
            map.flyToBounds(bounds, {
                maxZoom: drillMaxZoom,
                duration: 0.75,
                padding: [36, 36],
            });
        }
        map.once('moveend', finish);
        return () => {
            map.off('moveend', finish);
            map.stop();
            if (!finished) {
                finish();
            }
        };
    }, [clusterFlyId, map]);
    return null;
};

const MapClickHandler = ({
    onMapClick,
    routePlannerPickRole,
    onRoutePlannerMapPick,
    workspaceCustomPinMode,
    onWorkspaceMapPick,
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
    workspaceCustomPinMode?: boolean;
    onWorkspaceMapPick?: (lat: number, lng: number) => void;
}) => {
    useMapEvents({
        click(e) {
            if ((e.originalEvent as MouseEvent & { __liveDealCanvasHandled?: boolean }).__liveDealCanvasHandled) {
                return;
            }
            if (workspaceCustomPinMode && onWorkspaceMapPick) {
                onWorkspaceMapPick(e.latlng.lat, e.latlng.lng);
                return;
            }
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

const MaritimeFleetSelectionFly = ({
    vessel,
}: {
    vessel: MaritimeVessel | null;
}) => {
    const map = useMap();
    const lastFlownIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (!vessel) {
            lastFlownIdRef.current = null;
            return;
        }
        const src = (vessel.source_label ?? '').toLowerCase();
        if (!src.includes('shipvault')) return;
        const lat = vessel.lat;
        const lng = vessel.lng;
        if (lat == null || lng == null || (lat === 0 && lng === 0)) return;
        if (lastFlownIdRef.current === vessel.id) return;
        lastFlownIdRef.current = vessel.id;
        const timer = window.setTimeout(() => {
            map.flyTo([lat, lng], Math.max(map.getZoom(), 8), { duration: 0.85 });
        }, 120);
        return () => window.clearTimeout(timer);
    }, [vessel, map]);
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

const TankerViewFlyEffect = ({
    active,
    view,
}: {
    active: boolean;
    view: MaritimeTankerView;
}) => {
    const map = useMap();
    useEffect(() => {
        if (!active || view === 'worldwide') return;
        const boundsSpec = MARITIME_TANKER_VIEW_BOUNDS[view];
        if (!boundsSpec) return;
        const bounds = L.latLngBounds(boundsSpec);
        if (!bounds.isValid()) return;
        const timer = window.setTimeout(() => {
            map.invalidateSize({ animate: false, pan: false });
            map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 8, duration: 0.9 });
        }, 80);
        return () => window.clearTimeout(timer);
    }, [active, map, view]);
    return null;
};

const ViewportBoundsTracker = ({
    active,
    onBoundsChange,
    debounceMs = MAP_VIEWPORT_DEBOUNCE_MS,
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
        startTransition(() => onBoundsChange(nextBounds));
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
  onLicenseMapZoomChange,
  licenseMapZoom,
  onLicenseClusterDrillComplete,
  storageEntities = [],
  onStorageInViewCountChange,
  onOilGasMapViewportChange,
  oilLiveOverlaysEnabled = false,
  oilLiveProductFilter = 'all',
  oilLiveTerminalSearch = '',
  oilLiveLens = 'deal',
  onOilLiveLensChange,
  oilLiveLayers = LIVE_DATA_DEFAULT_LAYERS,
  onOilLiveLayersChange,
  oilLiveTradeFlowGroup = 'company_pair',
  onOilLiveTradeFlowGroupChange,
  oilLiveCoverageStats = null,
  onOilLiveStatsChange,
  onOilLiveEntityClick,
  onOilLiveDismiss,
  onLiveDataMapFlyTo,
  liveDataFlyTrigger = 0,
  liveDataFlyTarget = null,
  eiaHistoricMapEnabled = false,
  eiaHistoricMapArcs = [],
  eiaHistoricMapOrigins = [],
  eiaHistoricMapYear,
  eiaHistoricShowCorridors = false,
  onEiaHistoricSelectImporter,
  onEiaHistoricViewArcDetails,
  suppressLicenseClusters = false,
  hideLicenseMarkers = false,
  showInfrastructureLayers = false,
  infrastructureLayerVisibility,
  infrastructureForcedLayers,
  infrastructureMapZoom,
  infrastructureMapBbox,
  infrastructurePanelHint,
  onInfrastructureLayerChange,
  onInfrastructureFeatureClick,
  macroTradeFlowsEnabled = false,
  macroTradeFlows = [],
  liveDataMacroTradeOn = true,
  onLiveDataMacroTradeChange,
  liveDataEiaHistoricOn = false,
  onLiveDataEiaHistoricChange,
  oilLiveSidebarActive = false,
  onOpenDataHealth,
  brokerWorkspaceMap,
  brokerPackLocationMode = false,
  onBrokerPackLocationPick,
  onBrokerPackSelect,
  onAddToBrokerWorkspace,
  cockpitEnabled = false,
  cockpitLegendMode = 'global_view',
  cockpitLegendSublayer = 'countries',
  onCountrySelect,
}: MapComponentProps) {
    const { t } = useI18n();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme !== 'light';
    const isOilAndGasView = viewModeKey === 'oil_and_gas';
    const isLicenseMapView =
        viewModeKey === 'mining' ||
        viewModeKey === 'oil_and_gas' ||
        viewModeKey === 'global' ||
        viewModeKey === 'workspace' ||
        viewModeKey === 'supply_chain';
    const isLiveDataView = oilLiveSidebarActive;
    const {
        data: oilLiveSyncStatus,
        isError: oilLiveSyncStatusError,
        isPending: oilLiveSyncStatusPending,
    } = useOilLiveMapSyncStatus(isLiveDataView && oilLiveOverlaysEnabled);
    const isMaritimeMapView = maritimeMapViewActive;
    const isRoutePlannerView = viewModeKey === 'route_planner';
    const mapRef = useRef<L.Map | null>(null);
    const canvasVesselLayerRef = useRef<CanvasVesselLayer | null>(null);
    const markerRefs = useRef<Record<string, L.Marker>>({});
    const clusterGroupRef = useRef<LicenseMarkerClusterGroup | null>(null);
    const markerIconCacheRef = useRef(createLicenseMarkerIconCache());

    const isWorkspaceView = viewModeKey === 'workspace' || viewModeKey === 'supply_chain';
    const {
        currentVisibleViewport,
        oilGasMapViewport,
        liveDataMapViewport,
        maritimeViewport,
        licenseViewport,
        setCurrentVisibleViewport,
        setOilGasMapViewport,
        setLiveDataMapViewport,
        setMaritimeViewport,
        setLicenseViewport,
    } = useMapLayerViewports();
    const [governmentAisCoverageEnabled, setGovernmentAisCoverageEnabled] = useState(false);

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
    const [petroleumMapZoom, setPetroleumMapZoom] = useState(5);
    const [maritimeMapZoom, setMaritimeMapZoom] = useState(5);
    const [petroleumDetailZoom, setPetroleumDetailZoom] = useState(5);
    const [overlayMapZoom, setOverlayMapZoom] = useState(5);
    const [maritimeTankerView, setMaritimeTankerView] = useState<MaritimeTankerView>('worldwide');
    const [maritimeAdvancedOpen, setMaritimeAdvancedOpen] = useState(false);
    const vesselLayerLabel = t('מכליות (AIS)', 'Tankers (AIS)');
    const handleMaritimeLayerActiveChange = useCallback(
        (active: boolean) => {
            setIsMaritimeLayerEnabled(active);
        },
        [setIsMaritimeLayerEnabled],
    );
    const handleLicenseViewportChange = useCallback(
        (bbox: MaritimeViewportBounds | null) => {
            setLicenseViewport(bbox);
            onLicenseMapViewportChange?.(bbox);
        },
        [onLicenseMapViewportChange, setLicenseViewport],
    );
    const handleLicenseZoomChange = useCallback(
        (zoom: number) => {
            onLicenseMapZoomChange?.(zoom);
        },
        [onLicenseMapZoomChange],
    );
    const handleLicenseClusterDrillCompleteLocal = useCallback(
        (expandBounds: MaritimeViewportBounds, zoom?: number) => {
            if (zoom != null && Number.isFinite(zoom)) {
                setPetroleumMapZoom(zoom);
                setOverlayMapZoom(zoom);
                handleLicenseZoomChange(zoom);
            }
            onLicenseClusterDrillComplete?.(expandBounds, zoom);
        },
        [handleLicenseZoomChange, onLicenseClusterDrillComplete],
    );
    const vesselApiScope: MaritimeVesselScope = 'oil_tankers';

    // Jitter rows that share exact coordinates so each marker has a unique
    // anchor for spiderfy + popup. See lib/geo.ts for the rationale.
    /** Re-jitter only when ids/positions change — avoids marker flash on refetch-with-same-rows. */
    const licenseDisplaySignature = useMemo(
        () =>
            processedData
                .map(
                    (r) =>
                        `${r.id}|${r.lat ?? ''}|${r.lng ?? ''}|${r.mapClusterCount ?? ''}|${r._displayLat ?? ''}|${r._displayLng ?? ''}`,
                )
                .join('\n'),
        [processedData],
    );
    const displayData = useMemo(
        () => applyCollocationJitter(processedData),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- signature captures map-relevant row changes
        [licenseDisplaySignature],
    );

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
        view: maritimeTankerView,
        viewport: null,
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
        () =>
            vesselApiScope === 'oil_tankers'
                ? maritimeSnapshotVessels
                : filterVesselsByViewport(maritimeSnapshotVessels, maritimeViewport),
        [maritimeSnapshotVessels, maritimeViewport, vesselApiScope],
    );
    const maritimeVessels = useMemo(() => {
        const filtered = applyVesselFilters(maritimeVesselsInViewport, vesselFiltersApplied);
        return sortVesselsForDisplay(filtered, prioritizePetroleumVessels && isOilAndGasView);
    }, [maritimeVesselsInViewport, vesselFiltersApplied, prioritizePetroleumVessels, isOilAndGasView]);
    const maritimeFocusMode = Boolean(selectedMaritimeVessel);
    const maritimeVesselsForCanvas = useMemo(() => {
        if (!maritimeFocusMode || !selectedMaritimeVessel) return maritimeVessels;
        const byId = maritimeVessels.find((v) => v.id === selectedMaritimeVessel.id);
        if (byId) return [byId];
        const mmsi = String(selectedMaritimeVessel.mmsi ?? '').trim();
        const byMmsi = mmsi ? maritimeVessels.find((v) => String(v.mmsi) === mmsi) : undefined;
        return [byMmsi ?? selectedMaritimeVessel];
    }, [maritimeVessels, maritimeFocusMode, selectedMaritimeVessel]);
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
    const countryFocusActive = Boolean(countryFocusCountry?.trim());
    const onGroundVisible =
      (!isOilAndGasView || oilAndGasDisplayMode !== 'vessels_only') &&
      !isRoutePlannerView &&
      (!isLiveDataView || countryFocusActive);
    const showLicenseMarkers = onGroundVisible && !hideLicenseMarkers;
    const useCanvasLicenseMarkers = isLicenseMapView && !suppressLicenseClusters;

    const { mapDisplayData, licenseMarkersCapped, licenseServerClusterMode } = useLicenseDisplayData({
        displayData,
        selectedItem,
        viewModeKey,
        isMobileDevice,
        currentVisibleViewport,
        licenseViewport,
        showLicenseMarkers,
        useCanvasLicenseMarkers,
    });

    useEffect(() => {
        if (!isOilAndGasView || !onStorageInViewCountChange) return;
        onStorageInViewCountChange(countEntitiesInViewport(storageEntities, oilGasMapViewport));
    }, [isOilAndGasView, storageEntities, oilGasMapViewport, onStorageInViewCountChange]);

    const handleOilGasViewportBoundsChange = useCallback(
        (bbox: MaritimeViewportBounds | null) => {
            setOilGasMapViewport(bbox);
            onOilGasMapViewportChange?.(bbox);
        },
        [setOilGasMapViewport, onOilGasMapViewportChange],
    );
    const vesselsVisible =
      isMaritimeMapView &&
      (!isOilAndGasView || oilAndGasDisplayMode !== 'on_ground_only') &&
      (!isLiveDataView || isMaritimeLayerEnabled);
    const hideCountryBordersForVesselsOnly = isOilAndGasView && oilAndGasDisplayMode === 'vessels_only';
    /** Canvas clustering must track local map zoom — parent licenseMapZoom lags one React frame. */
    const liveCanvasMapZoom = isOilAndGasView ? petroleumMapZoom : overlayMapZoom;
    const effectiveLicenseMapZoom = Math.max(licenseMapZoom ?? 0, liveCanvasMapZoom) || undefined;
    const oilGasLayersEnabled = isOilAndGasView && onGroundVisible;
    const oilGasBbox = useMemo(
        () => resolvePetroleumViewportBounds(oilGasMapViewport),
        [oilGasMapViewport],
    );
    const storageInViewCount = useMemo(
        () =>
            isOilAndGasView
                ? countEntitiesInViewport(storageEntities, oilGasMapViewport)
                : 0,
        [isOilAndGasView, storageEntities, oilGasMapViewport],
    );

    const maritimeDrawRecords = useMemo(
        () =>
            toVesselDrawRecords(
                maritimeVesselsForCanvas,
                maritimeMapZoom,
                selectedMaritimeVessel?.id ?? maritimeVesselsForCanvas[0]?.id ?? null,
            ),
        [maritimeVesselsForCanvas, maritimeMapZoom, selectedMaritimeVessel?.id],
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
        layer.setFocusMode(maritimeFocusMode);
        layer.setVessels(maritimeVesselsForCanvas, maritimeDrawRecords);
    }, [
        vesselsVisible,
        isMaritimeLayerEnabled,
        maritimeFocusMode,
        maritimeVesselsForCanvas,
        maritimeDrawRecords,
    ]);

    useLayoutEffect(() => {
        pushVesselsToCanvas();
    }, [pushVesselsToCanvas]);

    const handleCanvasVesselLayerReady = useCallback(() => {
        pushVesselsToCanvas();
    }, [pushVesselsToCanvas]);

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

        const mmsi = String(selectedMaritimeVessel.mmsi ?? '').trim();
        if (mmsi && mmsi !== '0') {
            const feedByMmsi = maritimeVessels.find((vessel) => String(vessel.mmsi) === mmsi);
            if (feedByMmsi) {
                if (feedByMmsi.id !== selectedMaritimeVessel.id) {
                    onSelectMaritimeVessel(feedByMmsi);
                }
                return;
            }
        }

        const src = (selectedMaritimeVessel.source_label ?? '').toLowerCase();
        if (src.includes('shipvault') || src === 'registry') return;

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
    const liveDataVesselStatus = useMemo(
        () =>
            isLiveDataView && oilLiveLayers.vessels
                ? resolveLiveDataVesselStatus({
                      vesselsInView: oilLiveCoverageStats?.vessels ?? 0,
                      syncStatus: oilLiveSyncStatus,
                      allMaritimeEnabled: isMaritimeLayerEnabled,
                      maritimeMessages: maritimeStatusMessages,
                      inPersianGulfViewport: viewportOverlapsPersianGulfHub(liveDataMapViewport),
                      vesselMeta: oilLiveCoverageStats?.vesselMeta ?? null,
                  })
                : null,
        [
            isLiveDataView,
            oilLiveLayers.vessels,
            oilLiveCoverageStats?.vessels,
            oilLiveCoverageStats?.vesselMeta,
            oilLiveSyncStatus,
            isMaritimeLayerEnabled,
            maritimeStatusMessages,
            liveDataMapViewport,
        ],
    );
    const stsMapViewport = isLiveDataView ? liveDataMapViewport : maritimeViewport;
    const stsLayerEnabled =
        oilLiveLayers.stsEvents &&
        ((isLiveDataView && oilLiveOverlaysEnabled) ||
            (isMaritimeMapView && isMaritimeLayerEnabled));
    const stsSummaryQueryEnabled = Boolean(
        stsMapViewport &&
            ((isLiveDataView && oilLiveOverlaysEnabled) || isMaritimeMapView),
    );
    const {
        data: stsEventsSummary,
        isFetching: stsEventsSummaryFetching,
        isPending: stsEventsSummaryPending,
    } = useStsEventsSummary(stsMapViewport, stsSummaryQueryEnabled);
    const maritimeViewportAisGap =
        isMaritimeLayerEnabled &&
        maritimeVessels.length === 0 &&
        Boolean(maritimeFeed?.viewport_ais_coverage_gap);
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

    useMarkerSelectionVisual({
        markerRefs,
        selectedItemId: selectedItem?.id ?? null,
    });

    const {
        borderCountriesCapped,
        borderGeoJsonMatchesMarkers,
        filteredGeoJson,
        countryBorderLayerStyle,
    } = useCountryBordersLayer({
        displayData,
        countryFocusCountry,
        isRoutePlannerView,
        isDark,
    });

    const {
        licenseCanvasFeatures,
        licenseMarkerIcons,
        licenseClusterIconCreate,
    } = useLicenseMarkerVisuals({
        mapDisplayData,
        showLicenseMarkers,
        useCanvasLicenseMarkers,
        licenseServerClusterMode,
        userAnnotations,
        isDark,
        markerIconCache: markerIconCacheRef.current,
        getMarkerColor,
        createCustomIcon,
    });

    const buildClientClusterFly = useCallback(
        (feature: LiveDealMapFeature): PendingLicenseClusterFly => {
            if (!(feature.shape === 'point' && feature.kind === 'server_cluster' && isLiveDealClientClusterData(feature.data))) {
                throw new Error('Expected server cluster feature payload');
            }
            const { bounds, count } = feature.data;
            const span = Math.max(
                Math.abs(bounds.north - bounds.south),
                Math.abs(bounds.east - bounds.west),
                0.05,
            );
            return {
                id: feature.uid,
                company: `${count} licenses`,
                licenseType: 'Cluster',
                commodity: '',
                status: 'Active',
                date: null,
                country: '',
                region: '',
                sector: isOilAndGasView ? 'oil_and_gas' : 'mining',
                lat: feature.lat,
                lng: feature.lng,
                _displayLat: feature.lat,
                _displayLng: feature.lng,
                mapClusterCount: count,
                mapClusterGridDeg: span,
                entityKind: 'license',
                _clientCluster: true,
                _clientClusterBounds: bounds,
            };
        },
        [isOilAndGasView],
    );
    const {
        pendingLicenseClusterFly,
        setPendingLicenseClusterFly,
        handleLicenseMarkerClick,
        handleLicenseCanvasFeatureClick,
        handleSingleClusterMarkerClick,
    } = useLicenseInteractions<PendingLicenseClusterFly>({
        mapDisplayData,
        markerRefs,
        onSelectMaritimeVessel: () => onSelectMaritimeVessel(null),
        setSelectedItem,
        buildClientClusterFly,
    });
    const { serverClusterMarkers, licensePointMarkers } = useLicenseMarkerNodes({
        mapDisplayData,
        showLicenseMarkers,
        licenseMarkerIcons,
        licenseMapZoom: effectiveLicenseMapZoom,
        licenseServerClusterMode,
        markerRefs,
        onMarkerClick: handleLicenseMarkerClick,
    });

    const handleMaritimeVesselClick = useCallback(
        (vessel: MaritimeVessel) => {
            setSelectedItem(null);
            const resolved =
                maritimeVessels.find((entry) => entry.id === vessel.id) ??
                maritimeVessels.find((entry) => String(entry.mmsi) === String(vessel.mmsi)) ??
                vessel;
            onSelectMaritimeVessel(resolved);
        },
        [maritimeVessels, onSelectMaritimeVessel, setSelectedItem],
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
            <MapOverlayStatusPanel
                t={t}
                licensesFetchPending={licensesFetchPending}
                licensesRefetching={licensesRefetching}
                licensesSecondaryStatus={licensesSecondaryStatus}
                licenseMarkersCapped={licenseMarkersCapped}
                licenseMapDomMarkerCap={LICENSE_MAP_DOM_MARKER_CAP}
                showWorldCountrySummaryNotice={
                    licenseServerClusterMode &&
                    licenseMapZoom != null &&
                    licenseMapZoom < SERVER_CLUSTER_MIN_DRILL_ZOOM &&
                    displayData.some(isCountryLicenseSummary)
                }
                borderCountriesCapped={borderCountriesCapped}
                borderGeoJsonMatchesMarkers={borderGeoJsonMatchesMarkers}
                borderCountryCap={LICENSE_MAP_BORDER_COUNTRY_CAP}
            />

            <MapCoverageBanners
                t={t}
                showLiveDataVesselWatch={false}
                liveDataVesselStatus={liveDataVesselStatus}
                showLimitedAisCoverageBanner={Boolean(
                    !isLiveDataView &&
                        isMaritimeLayerEnabled &&
                        ((isMaritimeMapView &&
                            (maritimeTankerView === 'persian_gulf' || maritimeTankerView === 'strait_of_hormuz')) ||
                            (isOilAndGasView && maritimeFeed?.aisstream_persian_gulf_coverage_gap)),
                )}
            />
            {isOilAndGasView && onGroundVisible && (
                <div className="absolute left-1/2 -translate-x-1/2 top-3 z-[955] pointer-events-none px-2 w-full max-w-[540px] flex justify-center">
                    <InfrastructureCoverageBanner
                        bbox={oilGasBbox}
                        enabled={oilGasLayersEnabled}
                        storageInView={storageInViewCount > 0 ? storageInViewCount : undefined}
                    />
                </div>
            )}
            <MapEmptyStateOverlay
                t={t}
                show={
                    !isRoutePlannerView &&
                    viewModeKey !== 'workspace' &&
                    viewModeKey !== 'supply_chain' &&
                    !licensesFetchPending &&
                    ((onGroundVisible ? processedData.length : 0) === 0) &&
                    (vesselsVisible && isMaritimeLayerEnabled
                        ? maritimeVessels.length === 0 && !(isMaritimeLoading && !maritimeFeed)
                        : true)
                }
            />
            {isLiveDataView && oilLiveOverlaysEnabled && onOilLiveEntityClick && (
                <div className="absolute left-4 top-4 z-[960] pointer-events-auto sm:left-6">
                    <LiveDataMapCompanySearch
                        onEntityClick={onOilLiveEntityClick}
                        onMapFlyTo={onLiveDataMapFlyTo}
                    />
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
                <div className="absolute left-1/2 -translate-x-1/2 top-16 z-[955] pointer-events-auto px-2 w-full max-w-[520px] flex justify-center sm:top-[4.5rem]">
                    <LiveDataHealthMapStatus
                        syncStatus={oilLiveSyncStatus}
                        unreachable={oilLiveSyncStatusError}
                        pending={oilLiveSyncStatusPending}
                        onOpenDataHealth={onOpenDataHealth}
                    />
                </div>
                </>
            )}
            {stsLayerEnabled && (
                <div
                    className={`pointer-events-none absolute left-1/2 z-[954] flex w-full max-w-md -translate-x-1/2 justify-center px-2 ${
                        isLiveDataView && oilLiveOverlaysEnabled ? 'top-24 sm:top-[6.5rem]' : 'top-16 sm:top-[4.5rem]'
                    }`}
                >
                    <StsEventsMapStatus
                        enabled
                        summary={stsEventsSummary}
                        pending={stsEventsSummaryPending || stsEventsSummaryFetching}
                        className="w-full"
                    />
                </div>
            )}
            {isLiveDataView && oilLiveOverlaysEnabled && onOilLiveLayersChange && (
                <div className="absolute left-4 bottom-4 z-[950] pointer-events-auto">
                    <LiveDataMapLayersPanel
                        layers={oilLiveLayers}
                        onLayersChange={onOilLiveLayersChange}
                        lensMode={oilLiveLens}
                        onLensModeChange={onOilLiveLensChange}
                        coverageStats={oilLiveCoverageStats}
                        syncStatus={oilLiveSyncStatus}
                        allMaritimeEnabled={isMaritimeLayerEnabled}
                        onAllMaritimeChange={setIsMaritimeLayerEnabled}
                        globalMaritimeCount={maritimeSnapshotTotal}
                        tradeFlowGroup={oilLiveTradeFlowGroup}
                        onTradeFlowGroupChange={onOilLiveTradeFlowGroupChange}
                        macroTradeEnabled={liveDataMacroTradeOn}
                        onMacroTradeChange={onLiveDataMacroTradeChange}
                        eiaHistoricEnabled={liveDataEiaHistoricOn}
                        onEiaHistoricChange={onLiveDataEiaHistoricChange}
                        eiaHistoricRowCount={oilLiveSyncStatus?.eia_historic_import_count ?? null}
                        governmentAisCoverageEnabled={governmentAisCoverageEnabled}
                        onGovernmentAisCoverageChange={setGovernmentAisCoverageEnabled}
                        mapZoom={overlayMapZoom}
                        stsEventsCount={stsEventsSummary?.count ?? null}
                        stsEventsSummaryPending={stsEventsSummaryPending || stsEventsSummaryFetching}
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
                        mapZoom={infrastructureMapZoom}
                        panelHint={infrastructurePanelHint}
                    />
                </div>
            )}
            {isMaritimeMapView && !isLiveDataView && (
                <LayerDrawer
                    t={t}
                    isMaritimeLayerEnabled={isMaritimeLayerEnabled}
                    isMaritimeLoading={isMaritimeLoading}
                    hasMaritimeFeed={Boolean(maritimeFeed)}
                    maritimeIdleHint={maritimeIdleHint}
                    defaultExpanded={viewModeKey === 'route_planner'}
                    onToggleLayer={() => {
                        startTransition(() => setIsMaritimeLayerEnabled((current) => !current));
                    }}
                >
                <MaritimeControlPanel
                    t={t}
                    embedded
                    hideToggle
                    isMaritimeLayerEnabled={isMaritimeLayerEnabled}
                    isMaritimeLoading={isMaritimeLoading}
                    hasMaritimeFeed={Boolean(maritimeFeed)}
                    maritimeIdleHint={maritimeIdleHint}
                    oilAndGasDisplayMode={oilAndGasDisplayMode}
                    onOilAndGasDisplayModeChange={setOilAndGasDisplayMode}
                    hideCountryBordersForVesselsOnly={hideCountryBordersForVesselsOnly}
                    maritimeTankerView={maritimeTankerView}
                    tankerViewOptions={MARITIME_TANKER_VIEW_OPTIONS}
                    onMaritimeTankerViewChange={(value) => {
                        setMaritimeTankerView(value);
                        setIsMaritimeLayerEnabled(true);
                    }}
                    onToggleLayer={() => {
                        startTransition(() => setIsMaritimeLayerEnabled((current) => !current));
                    }}
                    onFocusOilTerminals={() => setOilAndGasDisplayMode('on_ground_only')}
                >

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

                                {maritimeFeed?.coverage?.warning_text && (
                                    <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[9px] leading-snug text-amber-900 dark:text-amber-100">
                                        {maritimeFeed.coverage.warning_text}
                                    </p>
                                )}

                                {maritimeFeed?.coverage && (
                                    <div className="grid grid-cols-2 gap-1.5 text-[8px] font-black uppercase tracking-widest">
                                        <Badge className="justify-center border-none bg-slate-950/10 text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                            {t('זרם', 'Stream')} {maritimeFeed.coverage.stream_status || 'unknown'}
                                        </Badge>
                                        <Badge className="justify-center border-none bg-slate-950/10 text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                            {t('Heartbeat', 'Heartbeat')} {maritimeFeed.coverage.heartbeat_status || 'unknown'}
                                        </Badge>
                                        <Badge className="justify-center border-none bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                                            {t('מכליות שעה', 'Tankers 1h')} {maritimeFeed.coverage.tankers_observed_last_hour ?? 0}
                                        </Badge>
                                        <Badge className="justify-center border-none bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                                            {t('כלי שיט שעה', 'Vessels 1h')} {maritimeFeed.coverage.vessels_observed_last_hour ?? 0}
                                        </Badge>
                                    </div>
                                )}

                                {maritimeViewportAisGap && (
                                    <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[9px] leading-snug text-amber-900 dark:text-amber-100">
                                        {t(
                                            'אין AIS חי באזור זה — המאגר מכיל כלי שיט באזורים אחרים (למשל אירופה). הרחב את oil-live-intel-worker watches או בדוק סטטוס סנכרון למטה.',
                                            'No live AIS in this region — the feed has vessels elsewhere (e.g. Europe). Expand oil-live-intel-worker watches or check sync status below.',
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

                                <MaritimeAdvancedControls
                                    t={t}
                                    maritimeAdvancedOpen={maritimeAdvancedOpen}
                                    onToggleAdvanced={() => setMaritimeAdvancedOpen((o) => !o)}
                                    maritimeMaxVessels={maritimeMaxVessels}
                                    onMaritimeMaxVesselsChange={setMaritimeMaxVessels}
                                    maritimeCaptureWindow={maritimeCaptureWindow}
                                    onMaritimeCaptureWindowChange={setMaritimeCaptureWindow}
                                    maritimeMaxVesselOptions={MARITIME_MAX_VESSEL_OPTIONS}
                                    maritimeCaptureWindowOptions={MARITIME_CAPTURE_WINDOW_OPTIONS}
                                    vesselFilters={vesselFilters}
                                    onVesselFiltersChange={setVesselFilters}
                                    maritimeVesselsInViewportCount={maritimeVesselsInViewport.length}
                                    maritimeVesselsCount={maritimeVessels.length}
                                    lodFullDetailZoom={LOD_FULL_DETAIL_ZOOM}
                                    maritimeLegendKeys={MARITIME_LEGEND_KEYS}
                                    vesselCategoryColors={VESSEL_CATEGORY_COLORS}
                                    vesselLegendT={VESSEL_LEGEND_T}
                                    maritimeFeed={maritimeFeed ?? null}
                                    maritimeDetailNote={maritimeDetailNote}
                                    maritimeLimitationText={maritimeLimitationText}
                                    maritimeErrorMessage={
                                        maritimeError
                                            ? maritimeError instanceof Error
                                                ? maritimeError.message
                                                : t('שגיאת טעינה לא ידועה', 'Unknown vessel loading error')
                                            : null
                                    }
                                    stsEventsEnabled={oilLiveLayers.stsEvents}
                                    onStsEventsChange={
                                        onOilLiveLayersChange
                                            ? (enabled) =>
                                                  onOilLiveLayersChange({
                                                      ...oilLiveLayers,
                                                      stsEvents: enabled,
                                                  })
                                            : undefined
                                    }
                                />
                            </>
                        )}
                </MaritimeControlPanel>
                </LayerDrawer>
            )}
            {cockpitEnabled && !isLiveDataView && (
                <MapIntelligenceLegend mode={cockpitLegendMode} sublayer={cockpitLegendSublayer} />
            )}
            <MapContainer 
              center={mapCenter} 
              zoom={
                viewModeKey === 'ports' || oilLiveSidebarActive
                  ? 3
                  : viewModeKey === 'route_planner'
                    ? 4
                    : LICENSE_MAP_DEFAULT_ZOOM
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
                    workspaceCustomPinMode={isWorkspaceView ? brokerPackLocationMode : false}
                    onWorkspaceMapPick={(lat, lng) => {
                      if (brokerPackLocationMode && onBrokerPackLocationPick) {
                        onBrokerPackLocationPick(lat, lng);
                      }
                    }}
                    onMapClick={() => {
                      setSelectedItem(null);
                      onSelectMaritimeVessel(null);
                      if (isLiveDataView) onOilLiveDismiss?.();
                    }}
                />
                <ViewportBoundsTracker
                    active={isMaritimeMapView && isMaritimeLayerEnabled}
                    onBoundsChange={setMaritimeViewport}
                />
                <ViewportBoundsTracker active={isMobileDevice} onBoundsChange={setCurrentVisibleViewport} />
                <ViewportBoundsTracker
                    active={
                        Boolean(onLicenseMapViewportChange) &&
                        !hideLicenseMarkers &&
                        isLicenseMapView &&
                        (!isLiveDataView || countryFocusActive)
                    }
                    onBoundsChange={handleLicenseViewportChange}
                />
                <ViewportBoundsTracker
                    active={isOilAndGasView}
                    onBoundsChange={handleOilGasViewportBoundsChange}
                />
                <ViewportBoundsTracker
                    active={isLiveDataView && oilLiveOverlaysEnabled}
                    onBoundsChange={setLiveDataMapViewport}
                />
                {isOilAndGasView && onGroundVisible && (
                    <MapZoomTracker
                        onZoomChange={(z) => {
                            setPetroleumMapZoom(z);
                            setOverlayMapZoom(z);
                            handleLicenseZoomChange(z);
                        }}
                    />
                )}
                {isLiveDataView && oilLiveOverlaysEnabled && !isOilAndGasView && (
                    <MapZoomTracker
                        onZoomChange={(z) => {
                            setOverlayMapZoom(z);
                            handleLicenseZoomChange(z);
                        }}
                    />
                )}
                {onLicenseMapViewportChange &&
                    isLicenseMapView &&
                    (!isLiveDataView || countryFocusActive) &&
                    !isOilAndGasView && (
                        <MapZoomTracker
                            onZoomChange={(z) => {
                                setOverlayMapZoom(z);
                                handleLicenseZoomChange(z);
                            }}
                        />
                    )}
                {isMaritimeMapView && isMaritimeLayerEnabled && (
                    <MapZoomTracker onZoomChange={setMaritimeMapZoom} />
                )}
                <MapEffect selectedItem={selectedItem} mapFlyTrigger={mapFlyTrigger} flyTarget={flyTarget} />
                <LicenseClusterFlyEffect
                    cluster={pendingLicenseClusterFly}
                    onLicenseMapZoomChange={handleLicenseZoomChange}
                    onLicenseMapViewportChange={handleLicenseViewportChange}
                    onLicenseClusterDrillComplete={handleLicenseClusterDrillCompleteLocal}
                    onComplete={() => setPendingLicenseClusterFly(null)}
                />
                <LicenseMapPopupController
                    selectedItem={selectedItem}
                    mapFlyTrigger={mapFlyTrigger}
                    markerRefs={markerRefs}
                    clusterGroupRef={clusterGroupRef}
                    preferCoordinatePopup={Boolean(
                        selectedItem && !isServerLicenseCluster(selectedItem),
                    )}
                    userAnnotations={userAnnotations}
                    updateAnnotation={updateAnnotation}
                    deleteLicense={deleteLicense}
                    handleOpenDossier={handleOpenDossier}
                    isInDdQueue={isInDdQueue}
                    onAddToDueDiligence={onAddToDueDiligence}
                    onRemoveFromDueDiligence={onRemoveFromDueDiligence}
                    getDealRoomForLicense={getDealRoomForLicense}
                    oilAndGasMap={isOilAndGasView}
                    onAddToBrokerWorkspace={onAddToBrokerWorkspace}
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
                {isMaritimeMapView && (
                    <MaritimeFleetSelectionFly vessel={selectedMaritimeVessel} />
                )}
                {isMaritimeMapView && selectedMaritimeVessel && isMaritimeLayerEnabled && (
                    <MaritimeVesselFocusLayers vessel={selectedMaritimeVessel} />
                )}
                <TankerViewFlyEffect
                    active={isMaritimeMapView && isMaritimeLayerEnabled}
                    view={maritimeTankerView}
                />

                {isWorkspaceView && brokerWorkspaceMap && (
                  <WorkspaceMapLayer
                    entities={brokerWorkspaceMap.entities}
                    packs={brokerWorkspaceMap.packs}
                    edges={brokerWorkspaceMap.edges}
                    onPackClick={(pack) => onBrokerPackSelect?.(pack.id)}
                  />
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

                    {borderGeoJsonMatchesMarkers && !hideCountryBordersForVesselsOnly && !isRoutePlannerView && (
                        <LayersControl.Overlay checked={!isOilAndGasView} name={t("גבולות מדינות", "Country borders")}>
                            <GeoJSON
                                key={`country-borders:${isDark ? 'd' : 'l'}:${countryFocusCountry?.trim() ?? 'viewport'}`}
                                data={filteredGeoJson!}
                                interactive={Boolean(onCountrySelect)}
                                style={countryBorderLayerStyle}
                                onEachFeature={(feature, layer) => {
                                    const name =
                                        (feature.properties?.name as string | undefined) ??
                                        (feature.properties?.ADMIN as string | undefined) ??
                                        (feature.properties?.country as string | undefined);
                                    if (!name || !onCountrySelect) return;
                                    layer.on({
                                        mouseover: (e) => {
                                            const target = e.target;
                                            target.setStyle({ opacity: 0.85, fillOpacity: 0.12 });
                                        },
                                        mouseout: (e) => {
                                            const target = e.target;
                                            target.setStyle(countryBorderLayerStyle);
                                        },
                                        click: () => onCountrySelect(name),
                                    });
                                }}
                            />
                        </LayersControl.Overlay>
                    )}
                    {isLiveDataView && oilLiveOverlaysEnabled && (
                        <OilLiveMapOverlays
                            enabled
                            mapZoom={overlayMapZoom}
                            productFilter={oilLiveProductFilter}
                            terminalSearch={oilLiveTerminalSearch}
                            lensMode={oilLiveLens}
                            layers={oilLiveLayers}
                            tradeFlowGroup={oilLiveTradeFlowGroup}
                            viewport={liveDataMapViewport}
                            focusVesselMmsi={
                                maritimeFocusMode && selectedMaritimeVessel?.mmsi != null
                                    ? Number(selectedMaritimeVessel.mmsi)
                                    : null
                            }
                            coverageSources={
                                governmentAisCoverageEnabled ? GOVERNMENT_AIS_COVERAGE_SOURCES : undefined
                            }
                            onStatsChange={onOilLiveStatsChange}
                            onEntityClick={onOilLiveEntityClick}
                            sidebarCompanyHover={liveDataCompanyHover}
                        />
                    )}
                    {stsLayerEnabled && (
                        <StsEventsMapLayer
                            enabled
                            viewport={stsMapViewport}
                            onOpenVessel={onOilLiveEntityClick}
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
                            onViewArcDetails={onEiaHistoricViewArcDetails}
                        />
                    )}
                    {macroTradeFlowsEnabled && macroTradeFlows.length > 0 && (
                        <MacroTradeFlowsMapLayer
                            enabled={macroTradeFlowsEnabled}
                            flows={macroTradeFlows}
                        />
                    )}
                    {showInfrastructureLayers &&
                        onGroundVisible &&
                        !isLiveDataView &&
                        !isOilAndGasView && (
                        <OsmPetroleumMapLayers
                            bbox={infrastructureMapBbox ?? null}
                            enabled
                            layerVisibility={infrastructureLayerVisibility}
                            forcedLayers={infrastructureForcedLayers}
                            mapZoom={infrastructureMapZoom}
                            onFeatureClick={onInfrastructureFeatureClick}
                        />
                    )}
                    {isOilAndGasView && onGroundVisible && (
                        <>
                            <OsmPetroleumMapLayers
                                bbox={oilGasBbox}
                                enabled={oilGasLayersEnabled}
                                mapZoom={petroleumMapZoom}
                                layerIds={['pipelines', 'refineries']}
                                splitOilGasPipelineLayers
                                isDark={isDark}
                            />
                            <GemGoitPipelineMapLayer
                                bbox={oilGasBbox}
                                enabled={oilGasLayersEnabled}
                                mapZoom={petroleumMapZoom}
                                isDark={isDark}
                            />
                            <GemGogptPlantMapLayer
                                bbox={oilGasBbox}
                                enabled={oilGasLayersEnabled}
                                mapZoom={petroleumMapZoom}
                                isDark={isDark}
                            />
                            <GemGgitLngMapLayer
                                bbox={oilGasBbox}
                                enabled={oilGasLayersEnabled}
                                mapZoom={petroleumMapZoom}
                                isDark={isDark}
                            />
                            <StorageTankFarmsMapLayer
                                entities={storageEntities}
                                enabled={oilGasLayersEnabled}
                                mapZoom={petroleumMapZoom}
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
                                    focusMode={maritimeFocusMode}
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
                {showLicenseMarkers && serverClusterMarkers && (
                    <LayerGroup>{serverClusterMarkers}</LayerGroup>
                )}
                {licenseCanvasFeatures.length > 0 && (
                    <CanvasLiveDealLayer
                        features={licenseCanvasFeatures}
                        mapZoom={liveCanvasMapZoom}
                        selectedUid={selectedItem ? `license:${selectedItem.id}` : null}
                        onFeatureClick={handleLicenseCanvasFeatureClick}
                        clusterPoints
                        clusterKinds={LICENSE_CANVAS_CLUSTER_KINDS}
                        clusterMaxZoom={LICENSE_CANVAS_CLUSTER_MAX_ZOOM}
                        clusterMinCount={LICENSE_CANVAS_CLUSTER_MIN_COUNT}
                        isDark={isDark}
                    />
                )}
                {showLicenseMarkers &&
                    !useCanvasLicenseMarkers &&
                    licensePointMarkers &&
                    (suppressLicenseClusters ? (
                        <LayerGroup>{licensePointMarkers}</LayerGroup>
                    ) : (
                        <MarkerClusterGroup
                            showCoverageOnHover={false}
                            spiderfyOnMaxZoom={false}
                            spiderfyOnEveryZoom={false}
                            maxClusterRadius={52}
                            disableClusteringAtZoom={14}
                            zoomToBoundsOnClick={false}
                            iconCreateFunction={licenseClusterIconCreate}
                            spiderLegPolylineOptions={{
                                weight: 1.5,
                                color: isDark ? '#64748b' : '#334155',
                                opacity: isDark ? 0.5 : 0.65,
                                interactive: false,
                            }}
                        >
                            <ClusterGroupRefBridge
                                clusterGroupRef={clusterGroupRef}
                                onSingleMarkerClusterClick={handleSingleClusterMarkerClick}
                                onLicenseMapZoomChange={onLicenseMapZoomChange}
                                onLicenseClusterDrillComplete={handleLicenseClusterDrillCompleteLocal}
                            />
                            {licensePointMarkers}
                        </MarkerClusterGroup>
                    ))}
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
            {isMaritimeMapView && selectedMaritimeVessel && isMaritimeLayerEnabled && (
              <div className="absolute bottom-6 right-4 z-[900] max-w-[min(100vw-2rem,280px)] pointer-events-none">
                <MaritimeFocusLegend vessel={selectedMaritimeVessel} />
              </div>
            )}
        </div>
    );
}
