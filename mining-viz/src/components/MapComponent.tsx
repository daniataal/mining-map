import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ChevronDown, ChevronUp, Loader2, Radar, RefreshCw, Ship } from 'lucide-react';
import { MiningLicense, UserAnnotation, MaritimeVessel, MaritimeViewportBounds, MaritimeVesselScope, OilAndGasDisplayMode } from '../types';
import { getCountryBorders, useMaritimeVessels } from '../lib/api';
import {
  applyVesselFilters,
  filterVesselsByViewport,
  sortVesselsForDisplay,
  VESSEL_SHIP_TYPE_OPTIONS,
  type VesselFilters,
} from '../lib/vessels';
import MaritimeLayerSync from './vessels/MaritimeLayerSync';
import PetroleumMapLayers from './petroleum/PetroleumMapLayers';
import { createOilFieldMapIcon, createRefineryMapIcon } from './petroleum/refineryMapIcon';
import { WORLD_PETROLEUM_PRELOAD_BBOX } from '../lib/petroleumLayers';
import { isOilFieldEntity, isRefineryEntity } from '../lib/oilEntityKinds';
import MapZoomTracker from './petroleum/MapZoomTracker';
import MapBasemapLayers from './map/MapBasemapLayers';
import { useI18n } from '../lib/i18n';
import type { RouteMapOverlay } from '../features/route-planner/types';
import { applyCollocationJitter } from '../lib/geo';
import { getLicenseRenderKey } from '../lib/licenseRenderKey';
import PopupForm from './PopupForm';
import EsgProtectedZonePopup from './esg/EsgProtectedZonePopup';
import {
  ESG_CONSERVATION_ZONES,
  getEsgZoneIntersection,
} from '../lib/esgConservationZones';

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

/** AIS ship/cargo type buckets (ITU-R M.1371-style 0–99); label fallback refines API-specific codes. */
type VesselCategoryKey =
    | 'tanker'
    | 'cargo'
    | 'passenger'
    | 'fishing'
    | 'tug'
    | 'service'
    | 'pleasure'
    | 'fast'
    | 'other';

const VESSEL_CATEGORY_COLORS: Record<VesselCategoryKey, string> = {
    tanker: '#fbbf24',
    cargo: '#38bdf8',
    passenger: '#34d399',
    fishing: '#2dd4bf',
    tug: '#a78bfa',
    service: '#94a3b8',
    pleasure: '#f472b6',
    fast: '#fb923c',
    other: '#64748b',
};

function vesselCategoryFromTypeCode(code: number | null | undefined): VesselCategoryKey | null {
    if (code == null || !Number.isFinite(code)) return null;
    const c = Math.floor(code);
    if (c === 0) return 'other';
    if (c >= 80 && c <= 89) return 'tanker';
    if (c >= 70 && c <= 79) return 'cargo';
    if (c >= 60 && c <= 69) return 'passenger';
    if (c === 30) return 'fishing';
    if (c === 31 || c === 32 || c === 52) return 'tug';
    if ([33, 34, 35, 50, 51, 53, 54, 55, 58, 59].includes(c)) return 'service';
    if (c === 36 || c === 37) return 'pleasure';
    if ((c >= 40 && c <= 49) || (c >= 20 && c <= 29)) return 'fast';
    if (c >= 90 && c <= 99) return 'other';
    return null;
}

function vesselCategoryFromLabel(label: string | null | undefined): VesselCategoryKey | null {
    if (!label) return null;
    const s = label.toLowerCase();
    if (s.includes('tank')) return 'tanker';
    if (s.includes('cargo') || s.includes('container') || s.includes('bulk') || s.includes('carrier')) return 'cargo';
    if (s.includes('passenger') || s.includes('cruise')) return 'passenger';
    if (s.includes('fish')) return 'fishing';
    if (s.includes('tug') || s.includes('tow')) return 'tug';
    if (
        s.includes('pilot') ||
        s.includes('search') ||
        s.includes('sar') ||
        s.includes('rescue') ||
        s.includes('military') ||
        s.includes('law') ||
        s.includes('dredg') ||
        s.includes('port tender') ||
        s.includes('anti-pollution')
    )
        return 'service';
    if (s.includes('pleasure') || s.includes('sailing') || s.includes('yacht')) return 'pleasure';
    if (s.includes('high speed') || s.includes('hsc') || s.includes('wig')) return 'fast';
    return null;
}

function getVesselMarkerColor(vessel: MaritimeVessel): string {
    const fromCode = vesselCategoryFromTypeCode(vessel.ship_type_code ?? null);
    if (fromCode) return VESSEL_CATEGORY_COLORS[fromCode];
    const fromLabel = vesselCategoryFromLabel(vessel.ship_type_label);
    if (fromLabel) return VESSEL_CATEGORY_COLORS[fromLabel];
    return VESSEL_CATEGORY_COLORS.other;
}

/** Prefer true heading; else course over ground; invalid AIS (511) ignored. */
function getVesselHeadingDegrees(vessel: MaritimeVessel): number {
    const th = vessel.true_heading;
    if (th != null && Number.isFinite(th) && th !== 511 && th >= 0 && th < 360) return th;
    const cog = vessel.course_over_ground;
    if (cog != null && Number.isFinite(cog)) {
        let c = cog % 360;
        if (c < 0) c += 360;
        if (Math.abs(c - 360) < 1e-6 || c === 360) return 0;
        return c;
    }
    return 0;
}

const MARITIME_LEGEND_KEYS: VesselCategoryKey[] = [
    'tanker',
    'cargo',
    'passenger',
    'fishing',
    'tug',
    'service',
    'pleasure',
    'fast',
    'other',
];

const VESSEL_LEGEND_T: Record<VesselCategoryKey, [string, string]> = {
    tanker: ['מכלית', 'Tanker'],
    cargo: ['מטען', 'Cargo'],
    passenger: ['נוסעים', 'Passenger'],
    fishing: ['דיג', 'Fishing'],
    tug: ['גוררת', 'Tug'],
    service: ['שירות', 'Service'],
    pleasure: ['שייט', 'Pleasure'],
    fast: ['מהיר', 'Fast'],
    other: ['אחר/לא ידוע', 'Other'],
};

const createCustomIcon = (color: string, isHovered: boolean, isEsgRisk?: boolean) => {
    const isGold = color === '#FFD700';
    const size = isHovered ? 24 : (isGold ? 14 : 10);
    let border = isHovered ? '2px solid white' : (isGold ? '1px solid rgba(255, 255, 255, 0.9)' : '1px solid rgba(255, 255, 255, 0.7)');

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

const createVesselIcon = (vessel: MaritimeVessel, isSelected: boolean, mapZoom = 6) => {
    const heading = getVesselHeadingDegrees(vessel);
    const color = getVesselMarkerColor(vessel);
    const baseDim = mapZoom <= 4 ? 20 : mapZoom <= 6 ? 17 : 14;
    const dim = isSelected ? baseDim + 6 : baseDim;
    const half = dim / 2;
    const border = isSelected ? '1.5px solid rgba(255,255,255,0.95)' : '1px solid rgba(255,255,255,0.75)';
    const shadow = isSelected
        ? '0 0 10px rgba(34,211,238,0.45)'
        : '0 0 4px rgba(0,0,0,0.65)';
    const inner = `<div class="vessel-marker-inner" style="width:${dim}px;height:${dim}px;background:${color};border:${border};box-shadow:${shadow};clip-path:polygon(50% 0%,100% 100%,50% 82%,0% 100%);transform:rotate(${heading}deg);"></div>`;
    return new L.DivIcon({
        className: `vessel-marker${isSelected ? ' is-selected' : ''}`,
        html: inner,
        iconSize: [dim, dim],
        iconAnchor: [half, half],
        popupAnchor: [0, -half],
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

/** Matches marker rendering: borders only for countries with at least one plottable license. */
function licenseHasMapCoordinates(item: MiningLicense): boolean {
    const lat = item.lat;
    const lng = item.lng;
    return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
}
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
      if (s === 'oil_and_gas' || s === 'oil') return '#000000';
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
    if (c.includes('oil') || c.includes('petroleum')) return '#000000';
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
  /** When set, reports map bounds for GET /licenses viewport filtering (mining / oil_and_gas). */
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
  onRoutePlannerMapPick?: (lat: number, lng: number, role: 'supplier' | 'buyer') => void;
  isInDdQueue?: (id: string) => boolean;
  onAddToDueDiligence?: (id: string) => void;
  onRemoveFromDueDiligence?: (id: string) => void;
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
    onRoutePlannerMapPick?: (lat: number, lng: number, role: 'supplier' | 'buyer') => void;
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

const RoutePlannerBoundsEffect = ({
    overlay,
}: {
    overlay?: RouteMapOverlay | null;
}) => {
    const map = useMap();
    useEffect(() => {
        const wps = overlay?.waypoints;
        if (!wps?.length) return;
        const bounds = L.latLngBounds(wps.map((w) => [w.lat, w.lng]));
        if (!bounds.isValid()) return;
        map.fitBounds(bounds.pad(0.18), { animate: true, maxZoom: 8 });
    }, [map, overlay]);
    return null;
};

const ViewportBoundsTracker = ({
    active,
    onBoundsChange,
}: {
    active: boolean;
    onBoundsChange: (bbox: MaritimeViewportBounds | null) => void;
}) => {
    const map = useMap();
    const lastSignatureRef = useRef<string>('');

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

    useEffect(() => {
        if (!active) {
            lastSignatureRef.current = '';
            onBoundsChange(null);
            return;
        }
        emitBounds();
    }, [active, emitBounds, onBoundsChange]);

    useMapEvents({
        moveend: emitBounds,
        zoomend: emitBounds,
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
  isInDdQueue,
  onAddToDueDiligence,
  onRemoveFromDueDiligence,
}: MapComponentProps) {
    const { t } = useI18n();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme !== 'light';
    const isOilAndGasView = viewModeKey === 'oil_and_gas';
    const isMaritimeMapView = maritimeMapViewActive;
    const isRoutePlannerView = viewModeKey === 'route_planner';
    const mapRef = useRef<L.Map | null>(null);
    const markerRefs = useRef<Record<string, L.Marker>>({});
    const prevSelectedIdRef = useRef<string | null>(null);
    const [currentVisibleViewport, setCurrentVisibleViewport] = useState<MaritimeViewportBounds | null>(null);

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
    const setVesselFilters = onVesselFiltersChange ?? (() => {});
    const [oilAndGasDisplayMode, setOilAndGasDisplayMode] = useState<OilAndGasDisplayMode>('combined');
    const [maritimeViewport, setMaritimeViewport] = useState<MaritimeViewportBounds | null>(null);
    const [petroleumMapZoom, setPetroleumMapZoom] = useState(5);
    const [maritimeMapZoom, setMaritimeMapZoom] = useState(5);
    const [petroleumDetailZoom, setPetroleumDetailZoom] = useState(5);
    const [maritimeAdvancedOpen, setMaritimeAdvancedOpen] = useState(false);
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
        enabled: isMaritimeMapView,
        maxVessels: Number(maritimeMaxVessels),
        captureWindowSeconds: Number(maritimeCaptureWindow),
        scope: vesselApiScope,
    });
    const maritimeSnapshotVessels = maritimeFeed?.vessels ?? [];
    const maritimeSnapshotTotal =
        maritimeFeed?.snapshot_vessel_count ?? maritimeFeed?.total_available ?? maritimeSnapshotVessels.length;
    const maritimeSparseSnapshot = isMaritimeLayerEnabled && maritimeSnapshotTotal < 100;
    const maritimeVesselsInViewport = useMemo(
        () => filterVesselsByViewport(maritimeSnapshotVessels, maritimeViewport),
        [maritimeSnapshotVessels, maritimeViewport],
    );
    const maritimeVessels = useMemo(() => {
        const filtered = applyVesselFilters(maritimeVesselsInViewport, vesselFiltersApplied);
        return sortVesselsForDisplay(filtered, prioritizePetroleumVessels && isOilAndGasView);
    }, [maritimeVesselsInViewport, vesselFiltersApplied, prioritizePetroleumVessels, isOilAndGasView]);
    const maritimeServedFromCache = Boolean(
        maritimeFeed && (maritimeFeed.cached || maritimeFeed.memory_cached || !isMaritimeLoading),
    );
    const onGroundVisible =
      (!isOilAndGasView || oilAndGasDisplayMode !== 'vessels_only') && !isRoutePlannerView;
    const vesselsVisible = isMaritimeMapView && (!isOilAndGasView || oilAndGasDisplayMode !== 'on_ground_only');
    const hideCountryBordersForVesselsOnly = isOilAndGasView && oilAndGasDisplayMode === 'vessels_only';

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
    const maritimeHeadlineStatus = !isMaritimeLayerEnabled
        ? ''
        : isMaritimeLoading && !maritimeFeed
            ? t('טוען מעקב כלי שיט…', 'Loading vessel watch…')
            : maritimeError
                ? t('טעינה נכשלה', 'Load failed')
                : !maritimeFeed?.live_positions_enabled
                    ? t(
                          `${maritimeSnapshotTotal.toLocaleString()} כלי שיט (AIS לא חי)`,
                          `${maritimeSnapshotTotal.toLocaleString()} vessels (live AIS unavailable)`
                      )
                    : maritimeVessels.length === 0
                        ? t(
                              `0 בתצוגה · ${maritimeSnapshotTotal.toLocaleString()} במאגר`,
                              `0 in view · ${maritimeSnapshotTotal.toLocaleString()} in feed`
                          )
                        : t(
                              `${maritimeVessels.length.toLocaleString()} בתצוגה · ${maritimeSnapshotTotal.toLocaleString()} במאגר`,
                              `${maritimeVessels.length.toLocaleString()} in view · ${maritimeSnapshotTotal.toLocaleString()} in feed`
                          );
    const maritimeDetailNote = !isMaritimeLayerEnabled
        ? t(
              'כלי השיט כבויים כברירת מחדל. הפעל כדי להציג מיקומי AIS — הנתונים נטענים ברקע מראש.',
              'Vessels stay off until you enable the layer. AIS data is prefetched in the background for instant display.'
          )
        : isMaritimeLoading && !maritimeFeed
            ? t('טוען מעקב כלי שיט עבור התצוגה הנוכחית...', 'Loading vessel watch for the current view...')
            : maritimeError
                ? t('טעינת כלי השיט נכשלה. נסה רענון או שנה היקף/תצוגה.', 'Vessel loading failed. Try refresh or adjust the view/scope.')
                : !maritimeFeed?.live_positions_enabled
                    ? t(
                          'AIS חי אינו זמין כרגע. ההקשר הימי בתיק עדיין פעיל גם בלי שכבת כלי שיט.',
                          'Live AIS is not available right now. Maritime dossier context still works without the vessel layer.'
                      )
                    : maritimeVessels.length === 0
                        ? t(
                              'לא נמצאו כלי שיט בתצוגה ובחלון הלכידה הנוכחיים. נסה להזיז מפה, להגדיל חלון או לעבור לכל כלי השיט.',
                              'No vessels were observed in the current view and capture window. Pan/zoom, widen the window, or switch to all vessels.'
                          )
                        : t(
                              `נצפו ${maritimeFeed?.returned_count ?? maritimeVessels.length} כלי שיט בתצוגה הנוכחית.`,
                              `${maritimeFeed?.returned_count ?? maritimeVessels.length} vessels observed in the current watch.`
                          );
    const maritimeLimitationText =
        maritimeFeed?.limitations?.find((item) => item && item !== maritimeFeed?.geography_note) ?? null;
    const maritimeSparseWarning = maritimeSparseSnapshot
        ? t(
              'מעט כלי שיט במאגר. הפעל docker compose up -d maritime-worker והגדר AISSTREAM_API_KEY בקובץ .env.',
              'Sparse vessel feed. Run docker compose up -d maritime-worker and set AISSTREAM_API_KEY in .env.'
          )
        : null;

    const flyTarget = useMemo(() => {
        if (!selectedItem) return null;
        const j = mapDisplayData.find(d => d.id === selectedItem.id) || displayData.find(d => d.id === selectedItem.id);
        if (!j || j._displayLat == null || j._displayLng == null) return null;
        return { lat: j._displayLat, lng: j._displayLng };
    }, [selectedItem, displayData, mapDisplayData]);

    // Selection-driven side effects:
    //   - toggle a CSS class on the previous & next markers (no setIcon swap
    //     because that would replace the marker DOM node and collapse any
    //     active spiderfy);
    //   - open the popup. For sidebar-driven selection we wait one tick so
    //     the camera flyTo can start; for marker clicks the popup is already
    //     opened synchronously inside the click handler below, so the
    //     openPopup call here is a harmless no-op.
    useEffect(() => {
        const prevId = prevSelectedIdRef.current;
        if (prevId && prevId !== selectedItem?.id) {
            const prevMarker = markerRefs.current[prevId];
            const el = prevMarker?.getElement();
            if (el) el.classList.remove(SELECTED_CLASS);
        }

        if (!selectedItem) {
            prevSelectedIdRef.current = null;
            return;
        }

        const marker = markerRefs.current[selectedItem.id];
        const el = marker?.getElement();
        if (el) el.classList.add(SELECTED_CLASS);
        if (marker && !marker.isPopupOpen?.()) {
            // Defer openPopup so flyTo (from the sidebar path) and any
            // pending cluster animation can settle. If the popup is already
            // open from a synchronous marker-click handler this is a no-op.
            const handle = setTimeout(() => {
                if (markerRefs.current[selectedItem.id] === marker) marker.openPopup();
            }, 60);
            prevSelectedIdRef.current = selectedItem.id;
            return () => clearTimeout(handle);
        }
        prevSelectedIdRef.current = selectedItem.id;
    }, [selectedItem?.id]);

    const borderCountries = useMemo(() => {
    // Use allLicenses (full unfiltered set for current sector) so borders reflect
    // every country with data in this tab — regardless of active search/filters.
    // Only countries with at least one mappable coordinate get an outline (rows with
    // country set but no lat/lng would otherwise show borders with zero markers).
    const ordered: string[] = [];
    const seenKey = new Set<string>();
    for (const d of allLicenses) {
        if (!licenseHasMapCoordinates(d)) continue;
        const raw = d.country?.trim();
        if (!raw) continue;
        const dedupeKey = raw.toLowerCase();
        if (seenKey.has(dedupeKey)) continue;
        seenKey.add(dedupeKey);
        ordered.push(raw);
    }
        return ordered.sort((a, b) => a.localeCompare(b));
    }, [allLicenses]);

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
                      fillColor: '#06b6d4',
                      color: '#06b6d4',
                      weight: 1,
                      opacity: 0.5,
                      fillOpacity: 0.02,
                      lineCap: 'round' as const,
                      lineJoin: 'round' as const,
                  },
        [isDark]
    );

    const renderedMarkers = useMemo(() => {
        if (!onGroundVisible) return null;
        return mapDisplayData.map((item, index) => {
            if (item._displayLat == null || item._displayLng == null) return null;
            const annotation = userAnnotations[item.id] || {};
            const color = getMarkerColor(annotation.commodity || item.commodity, annotation.status, item.sector, item.entitySubtype);
            const esgZone = getEsgZoneIntersection(item._displayLat, item._displayLng);
            const isEsgRisk = esgZone !== null;
            const esgZoneName = esgZone?.name;
            const selected = selectedItem?.id === item.id;
            const refineryPin = isRefineryEntity(item);
            const oilFieldPin = !refineryPin && isOilFieldEntity(item);
            const markerIcon = refineryPin
              ? createRefineryMapIcon(selected)
              : oilFieldPin
                ? createOilFieldMapIcon(selected)
                : createCustomIcon(color, false, isEsgRisk);

            return (
                <Marker
                    key={getLicenseRenderKey(item, index)}
                    position={[item._displayLat, item._displayLng]}
                    icon={markerIcon}
                    ref={(el) => {
                        if (!el) return;
                        markerRefs.current[item.id] = el;
                        if (selectedItem?.id === item.id) {
                            const root = el.getElement();
                            if (root) root.classList.add(SELECTED_CLASS);
                        }
                    }}
                    eventHandlers={{
                        click: (e) => {
                            L.DomEvent.stopPropagation(e);
                            e.target.openPopup();
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
                    <Popup className="custom-popup" minWidth={360} maxWidth={380}>
                        <PopupForm 
                          item={item}
                          annotation={annotation}
                          updateAnnotation={updateAnnotation}
                          onDelete={() => deleteLicense(item.id)}
                          onOpenDossier={() => handleOpenDossier(item)}
                          isOpen={selectedItem?.id === item.id}
                          isInDdQueue={isInDdQueue?.(item.id) ?? false}
                          onAddToDueDiligence={
                            onAddToDueDiligence
                              ? () => onAddToDueDiligence(item.id)
                              : undefined
                          }
                          onRemoveFromDueDiligence={
                            onRemoveFromDueDiligence
                              ? () => onRemoveFromDueDiligence(item.id)
                              : undefined
                          }
                          isEsgRisk={isEsgRisk}
                          esgZoneName={esgZoneName}
                        />
                    </Popup>
                </Marker>
            );
        });
    }, [
        mapDisplayData,
        userAnnotations,
        selectedItem,
        onSelectMaritimeVessel,
        setSelectedItem,
        updateAnnotation,
        deleteLicense,
        handleOpenDossier,
        isInDdQueue,
        onAddToDueDiligence,
        onRemoveFromDueDiligence,
        onGroundVisible
    ]);

    const renderedVesselMarkers = useMemo(
        () =>
            maritimeVessels.map((vessel) => (
                <Marker
                    key={vessel.id}
                    position={[vessel.lat, vessel.lng]}
                    icon={createVesselIcon(vessel, selectedMaritimeVessel?.id === vessel.id, maritimeMapZoom)}
                    eventHandlers={{
                        click: (e) => {
                            L.DomEvent.stopPropagation(e);
                            setSelectedItem(null);
                            onSelectMaritimeVessel(vessel);
                        },
                    }}
                >
                    <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                        <div className="bg-slate-950 border border-cyan-500/20 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md">
                            <span className="text-[10px] font-black uppercase text-cyan-300 tracking-widest">
                                {vessel.vessel_name}
                            </span>
                            <p className="text-[9px] text-slate-400">
                                {[vessel.ship_type_label, vessel.speed_knots != null ? `${vessel.speed_knots} kn` : null, vessel.nearest_port?.name]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </p>
                        </div>
                    </Tooltip>
                </Marker>
            )),
        [maritimeVessels, maritimeMapZoom, onSelectMaritimeVessel, selectedMaritimeVessel?.id, setSelectedItem],
    );

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
            {!isRoutePlannerView &&
              ((onGroundVisible ? processedData.length : 0) === 0) &&
              ((vesselsVisible ? maritimeVessels.length : 0) === 0) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-100/60 dark:bg-slate-900/60 backdrop-blur-sm">
                    <div className="text-4xl mb-2">🔍</div>
                    <h3 className="text-lg font-bold">{t("לא נמצאו נכסים", "No assets found")}</h3>
                    <p className="text-sm text-slate-400">{t("נסה לשנות את המסננים או להפעיל מחדש את שכבת האחסון", "Try adjusting filters or reloading the storage layer")}</p>
                </div>
            )}
            {isMaritimeMapView && (
                <div className="absolute left-4 bottom-4 z-[950] w-[min(100vw-2rem,480px)] rounded-2xl border border-black/10 dark:border-white/10 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl shadow-2xl">
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
                            onClick={() => setIsMaritimeLayerEnabled((current) => !current)}
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
                                                    'הסימון מצביע לכיוון השייט (צפון מעלה). צבע המילוי לפי קטגוריית סוג AIS. כל כלי שיט בתצוגה הוא סמן נפרד — ללא קיבוץ.',
                                                    'Chevron points along heading (north up). Fill color follows AIS ship-type category. Every vessel in view is its own marker—no clustering.'
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
              zoom={viewModeKey === 'ports' ? 3 : viewModeKey === 'route_planner' ? 4 : 7} 
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
                    }}
                />
                <ViewportBoundsTracker active={isMaritimeMapView} onBoundsChange={setMaritimeViewport} />
                <ViewportBoundsTracker active={isMobileDevice} onBoundsChange={setCurrentVisibleViewport} />
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
                <RoutePlannerBoundsEffect overlay={isRoutePlannerView ? routePlannerOverlay : null} />
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

                    {filteredGeoJson && !hideCountryBordersForVesselsOnly && (
                        <LayersControl.Overlay checked name={t("גבולות מדינות", "Country borders")}>
                            <GeoJSON
                                key={`${borderCountries.join(',')}:${isDark ? 'd' : 'l'}`}
                                data={filteredGeoJson}
                                interactive={false}
                                style={countryBorderPathStyle}
                            />
                        </LayersControl.Overlay>
                    )}
                    {isOilAndGasView && onGroundVisible && (
                        <PetroleumMapLayers
                            bbox={WORLD_PETROLEUM_PRELOAD_BBOX}
                            mapZoom={petroleumDetailZoom}
                            enabled={isOilAndGasView && onGroundVisible}
                        />
                    )}
                    {vesselsVisible && isMaritimeLayerEnabled && (
                        <LayersControl.Overlay checked={isMaritimeLayerEnabled} name={vesselLayerLabel}>
                            <LayerGroup>{renderedVesselMarkers}</LayerGroup>
                        </LayersControl.Overlay>
                    )}
                </MapBasemapLayers>
                {isMaritimeMapView && (
                    <MaritimeLayerSync layerName={vesselLayerLabel} onLayerActiveChange={handleMaritimeLayerActiveChange} />
                )}

                {/* spiderLegPolylineOptions interactive:false prevents spider-leg polylines from
                    eating clicks meant for the spiderfied markers beneath them.
                    showCoverageOnHover:false removes the coverage polygon overlay that can
                    also intercept pointer events in dense areas. */}
                {onGroundVisible && (
                <MarkerClusterGroup
                    showCoverageOnHover={false}
                    spiderLegPolylineOptions={{ weight: 1.5, color: '#64748b', opacity: 0.5, interactive: false }}
                >
                    {renderedMarkers}
                </MarkerClusterGroup>
                )}
                {isRoutePlannerView && routePlannerOverlay && (
                  <>
                    {routePlannerOverlay.legs.map((leg, idx) => {
                      const method = (leg.method || '').toLowerCase();
                      const color =
                        method === 'sea' ? '#38bdf8' :
                        method === 'air' ? '#a78bfa' :
                        method === 'rail' ? '#22c55e' :
                        method === 'pipeline' ? '#f97316' :
                        '#f59e0b';
                      const dashArray =
                        method === 'sea' ? '14 12' :
                        method === 'air' ? '4 12' :
                        method === 'rail' ? '10 8' :
                        undefined;
                      return Array.isArray(leg.path) && leg.path.length > 1 ? (
                        <Polyline
                          key={`rp-leg-${idx}`}
                          positions={leg.path}
                          pathOptions={{
                            weight: method === 'sea' ? 4 : 5,
                            color,
                            opacity: 0.9,
                            lineCap: 'round',
                            lineJoin: 'round',
                            ...(dashArray ? ({ dashArray } as const) : {}),
                          }}
                        >
                          {leg.label && (
                            <Tooltip direction="top" opacity={1}>
                              <span className="text-[11px] font-bold text-slate-900">{leg.label}</span>
                            </Tooltip>
                          )}
                        </Polyline>
                      ) : null;
                    })}
                    {routePlannerOverlay.waypoints.map((wp, i) => {
                      let fill = '#22c55e';
                      if (wp.role === 'transit') fill = '#38bdf8';
                      if (wp.role === 'destination') fill = '#f43f5e';
                      const r =
                        wp.role === 'destination' ? 14 : wp.role === 'origin' ? 13 : 10;
                      return (
                        <CircleMarker
                          key={`rp-wp-${i}-${wp.role}`}
                          center={[wp.lat, wp.lng]}
                          radius={r}
                          pathOptions={{
                            fillColor: fill,
                            color: 'rgba(255,255,255,0.9)',
                            weight: 2,
                            fillOpacity: 0.9,
                          }}
                        >
                          <Tooltip direction="top" offset={[0, -12]} opacity={1}>
                            <span className="text-[11px] font-bold text-slate-900">{t(wp.label[0], wp.label[1])}</span>
                          </Tooltip>
                        </CircleMarker>
                      );
                    })}
                  </>
                )}
            </MapContainer>
        </div>
    );
}
