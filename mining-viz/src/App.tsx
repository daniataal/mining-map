import { useState, useMemo, useEffect, useCallback, useRef, useDeferredValue, startTransition, lazy, Suspense } from 'react';
import {
  useLicensesForMap,
  useUpdateLicense,
  useDeleteLicense,
  useLogActivity,
  login,
  getStoredMiningToken,
  API_BASE,
  describeLicenseFetchFailureContext,
  useWorldCoverage,
  useStorageTerminals,
  usePortLogisticsEntities,
  createDealRoom,
  type LicenseViewportBounds,
  normalizeLicenseViewportBounds,
} from './lib/api';
import { getMacroTradeFlows, type MacroTradeFlow } from './api/oilLiveApi';
import type { OsmPetroleumLayerId } from './lib/osmPetroleumLayers';
import { DEFAULT_OSM_LAYER_VISIBILITY } from './lib/osmPetroleumLayers';
import { infrastructureLayersPanelHint } from './lib/infrastructureLayer';
import type { InfrastructureFeatureSelection } from './features/infrastructure/InfrastructureFeatureDrawer';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getEiaHistoricMap } from './api/eiaHistoricApi';
import { useMiningData } from './hooks/use-mining-data';
import { useLicenseAnnotations } from './hooks/use-license-annotations';
import { useDebouncedValue } from './hooks/use-debounced-value';
import {
  EIA_HISTORIC_STALE_MS,
  eiaHistoricMapQueryKey,
  prefetchEiaHistoricData,
  usePetroleumSidebarPrefetch,
} from './hooks/use-petroleum-sidebar-prefetch';
import { useI18n } from './lib/i18n';
import { MiningLicense, UserAnnotation, MaritimeVessel, MarketTickerRow } from './types';
import { toast } from "sonner";

import WorkspaceSidebarLayout, { type MapSidebarTab } from './components/WorkspaceSidebarLayout';
import AddLicenseModal from './components/AddLicenseModal';
import BulkImportLicensesModal from './components/BulkImportLicensesModal';
import { useDueDiligenceQueue } from './hooks/use-due-diligence-queue';
import { useDealRooms } from './hooks/use-deal-rooms';
import type { InvestigationsSubTab } from './components/InvestigationsPanel';
import AuthOverlay from './components/AuthOverlay';
import FilterPanel from './components/FilterPanel';
import { excludeHiddenFallbackPlaceholders } from './lib/licenseVisibility';
import { storageViewportCoverageGapMessage } from './lib/storageCoverageBanner';
import { LICENSE_MAP_DEFAULT_ZOOM } from './lib/licenseMapCluster';
import OilMaritimePanel from './components/OilMaritimePanel';
import { resolveFleetVesselSelection } from './lib/vessels/resolveFleetVessel';
import {
  DEFAULT_VESSEL_FILTERS,
  prefetchMaritimeVesselSnapshot,
  type VesselFilters,
} from './lib/vessels';
import IntelligenceSearchBox from './components/IntelligenceSearchBox';
import { useRoutePlanner } from './features/route-planner';
import {
  applyLiveDataRouteHints,
  routeProductFromCommodityFamily,
  type LiveDataRouteHints,
} from './features/live-data/liveDataRoutePrefill';
import {
  fetchOilCompanyForDossier,
  findDossierLicenseForOilCompany,
} from './features/live-data/liveDataDossier';
import {
  buildRoutePlannerAirportMarkers,
  buildRoutePlannerPortMarkers,
  canonicalRouteHubCountry,
  MAX_ROUTE_MODE_TOTAL_HUB_MARKERS,
  resolveRouteHubCountries,
} from './features/route-planner/locationPresets';
import {
  Filter as LucideFilter,
  HelpCircle as LucideHelpCircle,
  MapPin as LucideMapPin,
  LayoutGrid as LucideLayoutGrid,
  PieChart as LucidePieChart,
  LogOut as LucideLogOut,
  Droplets as LucideDroplets,
  Navigation2 as LucideNavigation,
  X as LucideX,
} from 'lucide-react';
import ThemeToggle from './components/ThemeToggle';
import PlatformHealthChip from './components/PlatformHealthChip';
import OilGasOnboardingTip from './components/OilGasOnboardingTip';
import { mapViewHelpBody, mapViewHelpTitle, WORLD_COVERAGE_BANNER_NOTE } from './lib/mapViewHelp';
import {
  formatCoverageSummaryCounts,
  sectorCoverageSummary as getSectorCoverageSummary,
  type LicenseCoverageSector,
} from './lib/licenseCoverage';
import type { OilLiveEntityClickPayload } from './components/petroleum/OilLiveMapOverlays';
import type { HistoricArcSelection } from './features/live-data/HistoricArcDetailDrawer';
import {
  CRISIS_HORMUZ_BBOX,
  LIVE_DATA_HUB_CENTER,
  LIVE_DATA_EIA_HISTORIC_DEFAULT_YEAR,
  LIVE_DATA_VESSEL_FILTERS,
  layersForLiveDataLens,
  type LiveDataLensMode,
} from './features/live-data/liveDataMapDefaults';
import { countSuppliersPipeline } from './lib/suppliersPipeline';

import 'leaflet/dist/leaflet.css';
import './App.css';

const MapComponent = lazy(() => import('./components/MapComponent'));
const DossierView = lazy(() => import('./components/DossierView'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const InvestigationsPanel = lazy(() => import('./components/InvestigationsPanel'));
const RoutePlannerPanel = lazy(() => import('./features/route-planner/RoutePlannerPanel'));
const LiveDataIntelPanel = lazy(() => import('./features/live-data/LiveDataIntelPanel'));
const EiaHistoricImportsPanel = lazy(() => import('./features/live-data/EiaHistoricImportsPanel'));
const OilLiveEntityDrawer = lazy(() => import('./features/live-data/OilLiveEntityDrawer'));
const InfrastructureFeatureDrawer = lazy(
  () => import('./features/infrastructure/InfrastructureFeatureDrawer'),
);
const HistoricArcDetailDrawer = lazy(
  () => import('./features/live-data/HistoricArcDetailDrawer'),
);

const MARITIME_MAP_VIEWS = new Set(['global', 'mining', 'oil_and_gas']);

function extractErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value instanceof Error) return value.message;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractErrorMessage(entry);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of ['detail', 'message', 'error']) {
      const nested = extractErrorMessage(record[key]);
      if (nested) return nested;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (value == null) return null;
  return String(value);
}

function formatLicenseFetchError(e: unknown): string {
  return extractErrorMessage(e) ?? 'Unknown error';
}

function formatAuthError(e: unknown): string {
  const responseData =
    typeof e === 'object' && e !== null && 'response' in e
      ? (e as { response?: { data?: unknown } }).response?.data
      : undefined;
  return extractErrorMessage(responseData ?? e) ?? 'Invalid credentials';
}

function TickerItem({ symbol, price, change, up }: { symbol: string, price: string, change?: string, up?: boolean | null }) {
  const ch = change ?? '—';
  const tone = up === true ? 'text-emerald-500' : up === false ? 'text-red-500' : 'text-slate-500 dark:text-slate-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-black text-slate-500 dark:text-slate-400">{symbol}</span>
      <span className="text-[10px] font-bold text-slate-900 dark:text-white">{price}</span>
      <span className={`text-[9px] font-black ${tone}`}>{ch}</span>
    </div>
  );
}

function LazySurfaceFallback({ label = 'Loading intelligence surface...' }: { label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-stone-100/80 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:bg-slate-950/70 dark:text-slate-400">
      {label}
    </div>
  );
}

export default function App() {
  const { t, isRtl } = useI18n();
  const routePlanner = useRoutePlanner();
  const ddQueue = useDueDiligenceQueue();
  const [viewMode, setViewMode] = useState<
    'global' | 'mining' | 'oil_and_gas' | 'suppliers' | 'ports' | 'investigations' | 'route_planner' | 'admin'
  >('global');
  const [mapSidebarTab, setMapSidebarTab] = useState<MapSidebarTab>('licenses');
  const [investigationsSubTab, setInvestigationsSubTab] = useState<InvestigationsSubTab>('due_diligence');
  const [euProcurementCpvBucket, setEuProcurementCpvBucket] = useState<string | null>(null);
  const [highlightedDealRoomId, setHighlightedDealRoomId] = useState<string | null>(null);
  const licenseSector =
    viewMode === 'mining'
      ? 'mining'
      : viewMode === 'oil_and_gas'
        ? 'oil_and_gas'
        : undefined;
  const licenseFetchTroubleshooting = useMemo(() => {
    const h = describeLicenseFetchFailureContext();
    return t(h.he, h.en);
  }, [t]);
  const queryClient = useQueryClient();

  // Data Fetching
  const [licenseMapViewport, setLicenseMapViewport] = useState<LicenseViewportBounds | null>(null);
  const [licenseMapZoom, setLicenseMapZoom] = useState(
    () => LICENSE_MAP_DEFAULT_ZOOM,
  );
  /** Grid-cell bbox for the cluster being drilled — keeps fetch/display spanning the full cell. */
  const [licenseDrillExpandBounds, setLicenseDrillExpandBounds] =
    useState<LicenseViewportBounds | null>(null);
  const [countryFocusCountry, setCountryFocusCountry] = useState<string | null>(null);
  const [countryFocusBoundsTrigger, setCountryFocusBoundsTrigger] = useState(0);
  const [licenseFetchCountries, setLicenseFetchCountries] = useState<string[]>([]);
  const isLiveDataSidebar = mapSidebarTab === 'live_data';
  const isHistoricSidebar = mapSidebarTab === 'historic';
  const hideLicenseMarkersOnMap = isHistoricSidebar || isLiveDataSidebar;
  const licenseMapFetchEnabled =
    viewMode !== 'route_planner' &&
    viewMode !== 'ports' &&
    !hideLicenseMarkersOnMap;
  const { data: worldCoverage } = useWorldCoverage(
    viewMode === 'mining' || viewMode === 'oil_and_gas' || viewMode === 'global',
  );
  const {
    data: rawData = [],
    isLoading,
    error: fetchError,
  } = useLicensesForMap({
    sector: licenseSector,
    bounds: licenseMapViewport,
    filterCountries: licenseFetchCountries,
    mapZoom: licenseMapZoom,
    drillExpandBounds: licenseDrillExpandBounds,
    enabled: licenseMapFetchEnabled,
  });
  const licenseServerClustered = useMemo(
    () => rawData.some((row) => (row.mapClusterCount ?? 0) > 0),
    [rawData],
  );
  useEffect(() => {
    if (!licenseDrillExpandBounds) return;
    if (
      licenseMapZoom >= 8 &&
      rawData.length > 0 &&
      !rawData.some((row) => (row.mapClusterCount ?? 0) > 0)
    ) {
      setLicenseDrillExpandBounds(null);
    }
  }, [licenseDrillExpandBounds, licenseMapZoom, rawData]);
  const licensesMapSecondaryStatus = null;
  const [oilGasMapViewport, setOilGasMapViewport] = useState<LicenseViewportBounds | null>(null);
  const debouncedOilGasMapViewport = useDebouncedValue(oilGasMapViewport, 450);
  // Viewport loads use keepPreviousData — no full sidebar spinner on pan/cluster drill.
  const {
    data: storageTerminalResponse,
    isLoading: isStorageLoading,
    error: storageError,
  } = useStorageTerminals(viewMode === 'oil_and_gas', {
    viewport: debouncedOilGasMapViewport,
    limit: 2000,
  });
  const {
    data: portLogisticsResponse,
    isLoading: isPortsLoading,
    error: portsError,
  } = usePortLogisticsEntities(viewMode === 'ports' || viewMode === 'route_planner');
  const updateLicenseMutation = useUpdateLicense();
  const deleteLicenseMutation = useDeleteLicense();
  const logActivityMutation = useLogActivity();

  // Auth State
  const [token, setToken] = useState<string | null>(() => getStoredMiningToken());
  usePetroleumSidebarPrefetch(Boolean(token));
  const [username, setUsername] = useState<string | null>(localStorage.getItem('mining_username'));
  const dealRooms = useDealRooms(Boolean(username));
  const [userId, setUserId] = useState<string | null>(localStorage.getItem('mining_userid'));
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);

  // UI State
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isSidebarPinned, setIsSidebarPinned] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [selectedItem, setSelectedItem] = useState<MiningLicense | null>(null);
  const [selectedMaritimeVessel, setSelectedMaritimeVessel] = useState<MaritimeVessel | null>(null);

  useEffect(() => {
    if (!selectedMaritimeVessel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedMaritimeVessel(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedMaritimeVessel]);
  const [isMaritimeLayerEnabled, setIsMaritimeLayerEnabled] = useState(false);
  const [vesselFilters, setVesselFilters] = useState<VesselFilters>(DEFAULT_VESSEL_FILTERS);
  const [maritimeMaxVessels, setMaritimeMaxVessels] = useState('15000');
  const [maritimeCaptureWindow, setMaritimeCaptureWindow] = useState('25');
  const [prioritizePetroleumVessels, setPrioritizePetroleumVessels] = useState(false);
  const [oilLiveProductFilter, setOilLiveProductFilter] = useState('all');
  const [oilLiveTerminalSearch, setOilLiveTerminalSearch] = useState('');
  const [oilLiveLens, setOilLiveLens] = useState<LiveDataLensMode>('deal');
  const [oilLiveLayers, setOilLiveLayers] = useState(() => layersForLiveDataLens('deal'));
  const [oilLiveTradeFlowGroup, setOilLiveTradeFlowGroup] = useState<
    'company_pair' | 'country_pair'
  >('company_pair');
  const [oilLiveCoverageStats, setOilLiveCoverageStats] = useState<{
    terminals: number;
    vessels: number;
    opportunities: number;
    corridors: number;
    vesselMeta?: import('./api/oilLiveApi').OilLiveVesselMeta | null;
  } | null>(null);
  const [liveDataMacroTradeOn, setLiveDataMacroTradeOn] = useState(true);
  const [oilLiveEntity, setOilLiveEntity] = useState<OilLiveEntityClickPayload | null>(null);
  const [historicSidebarMap, setHistoricSidebarMap] = useState<{
    enabled: boolean;
    arcs: import('./api/eiaHistoricApi').EiaHistoricMapArc[];
    origins?: import('./api/eiaHistoricApi').EiaHistoricMapOrigin[];
    year: number;
    showCorridors: boolean;
  }>({ enabled: false, arcs: [], year: 2020, showCorridors: false });
  const [historicImporterFromMap, setHistoricImporterFromMap] = useState<string | null>(null);
  const [liveDataEiaHistoricOn, setLiveDataEiaHistoricOn] = useState(false);
  const [selectedHistoricArc, setSelectedHistoricArc] = useState<HistoricArcSelection | null>(null);
  const [liveDataFlyTrigger, setLiveDataFlyTrigger] = useState(0);
  const [liveDataFlyTarget, setLiveDataFlyTarget] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [macroTradeFlows, setMacroTradeFlows] = useState<MacroTradeFlow[]>([]);
  const [infrastructureLayerVisibility, setInfrastructureLayerVisibility] = useState<
    Record<OsmPetroleumLayerId, boolean>
  >(() => ({ ...DEFAULT_OSM_LAYER_VISIBILITY }));
  const [infrastructureForcedLayers, setInfrastructureForcedLayers] = useState<
    Partial<Record<OsmPetroleumLayerId, boolean>>
  >({});
  const [selectedInfrastructureFeature, setSelectedInfrastructureFeature] =
    useState<InfrastructureFeatureSelection | null>(null);
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [dossierItem, setDossierItem] = useState<MiningLicense | null>(null);
  const [mapFlyTrigger, setMapFlyTrigger] = useState(0);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);

  const handleAuthInvalid = useCallback(() => {
    setToken(null);
    setUsername(null);
    setUserId(null);
  }, []);

  const { userAnnotations, updateAnnotation: persistAnnotation } = useLicenseAnnotations(token, {
    onAuthInvalid: handleAuthInvalid,
  });

  // Locally-added licenses (persisted to localStorage)
  const [localLicenses, setLocalLicenses] = useState<MiningLicense[]>(() => {
    try {
      const saved = localStorage.getItem('mining_local_licenses');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  // Persist local licenses to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('mining_local_licenses', JSON.stringify(localLicenses));
  }, [localLicenses]);

  const visibleLocalLicenses = useMemo(
    () =>
      licenseSector
        ? localLicenses.filter((item) => (item.sector || 'mining') === licenseSector)
        : localLicenses,
    [licenseSector, localLicenses]
  );
  const storageEntities = storageTerminalResponse?.entities || [];
  useEffect(() => {
    if (viewMode !== 'oil_and_gas' || !storageTerminalResponse?.entities) return;
    const ents = storageTerminalResponse.entities;
    const uae = ents.filter((e) => (e.country || '').includes('United Arab Emirates'));
    const fuj = ents.filter(
      (e) =>
        e.lat != null &&
        e.lng != null &&
        e.lat >= 25.0 &&
        e.lat <= 25.25 &&
        e.lng >= 56.2 &&
        e.lng <= 56.5,
    );
    const isr = ents.filter((e) => (e.country || '').includes('Israel'));
    const curated = ents.filter(
      (e) => e.sourceKind === 'curated_reference' || String(e.id || '').startsWith('curated_storage_'),
    );
    // #region agent log
    fetch('http://127.0.0.1:7847/ingest/4a545e2b-07f1-4d20-ade6-14997117a3cb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7419a2' },
      body: JSON.stringify({
        sessionId: '7419a2',
        hypothesisId: 'C',
        location: 'App.tsx:storageEntities',
        message: 'storage_entities_region_counts',
        data: {
          total: ents.length,
          curated: curated.length,
          uae: uae.length,
          fujairah: fuj.length,
          israel: isr.length,
          statsBySource: storageTerminalResponse.stats?.by_source,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [viewMode, storageTerminalResponse]);
  const portEntities = portLogisticsResponse?.entities || [];
  const allLicenses = useMemo(
    () => {
      if (viewMode === 'ports') {
        return excludeHiddenFallbackPlaceholders(portEntities);
      }
      return excludeHiddenFallbackPlaceholders([...rawData, ...visibleLocalLicenses]);
    },
    [rawData, visibleLocalLicenses, viewMode, portEntities]
  );
  const debouncedRouteSupplierCountry = useDebouncedValue(routePlanner.supplier.country);
  const debouncedRouteBuyerCountry = useDebouncedValue(routePlanner.buyer.country);
  const routeHubCountries = useMemo(
    () => resolveRouteHubCountries(debouncedRouteSupplierCountry, debouncedRouteBuyerCountry),
    [debouncedRouteSupplierCountry, debouncedRouteBuyerCountry],
  );

  const routeMarkerCountries = useMemo(() => {
    if (routePlanner.pickRole === 'supplier') {
      const supplierCanon = canonicalRouteHubCountry(debouncedRouteSupplierCountry);
      return supplierCanon ? [supplierCanon] : [];
    }
    if (routePlanner.pickRole === 'buyer') {
      const buyerCanon = canonicalRouteHubCountry(debouncedRouteBuyerCountry);
      return buyerCanon ? [buyerCanon] : [];
    }
    return routeHubCountries;
  }, [
    routePlanner.pickRole,
    debouncedRouteSupplierCountry,
    debouncedRouteBuyerCountry,
    routeHubCountries,
  ]);
  const routeMarkerCountriesKey = routeMarkerCountries.join('\0');

  // Catalog + maritime entities only — no global license scan when toggling hub markers.
  const routePlannerPortMarkers = useMemo(() => {
    if (!routePlanner.showPortsOnMap || !routeMarkerCountries.length) return [];
    return buildRoutePlannerPortMarkers(portEntities, {
      countries: routeMarkerCountries,
      maxTotal: MAX_ROUTE_MODE_TOTAL_HUB_MARKERS,
    });
  }, [routePlanner.showPortsOnMap, portEntities, routeMarkerCountriesKey]);

  const routePlannerAirportMarkers = useMemo(() => {
    if (!routePlanner.showAirportsOnMap || !routeMarkerCountries.length) return [];
    return buildRoutePlannerAirportMarkers({
      countries: routeMarkerCountries,
      maxTotal: MAX_ROUTE_MODE_TOTAL_HUB_MARKERS,
    });
  }, [routePlanner.showAirportsOnMap, routeMarkerCountriesKey]);

  const handleRoutePlannerMapPick = routePlanner.handleMapPick;
  const handleRoutePlannerHubPick = useCallback(
    (hub: { lat: number; lng: number; name: string; country?: string }, role: 'supplier' | 'buyer') => {
      startTransition(() => {
        handleRoutePlannerMapPick(hub.lat, hub.lng, role, hub.name, hub.country);
      });
    },
    [handleRoutePlannerMapPick],
  );

  const entityIndex = useMemo(() => {
    const searchable =
      viewMode === 'oil_and_gas' ? [...allLicenses, ...storageEntities] : allLicenses;
    return Object.fromEntries(searchable.map((item) => [item.id, item]));
  }, [allLicenses, storageEntities, viewMode]);

  const [storageInViewCount, setStorageInViewCount] = useState<number | null>(null);

  // Filtering Hook
  const miningData = useMiningData(allLicenses, userAnnotations, {
    suppliersPipelineMode: viewMode === 'suppliers',
    skipCountryFilterForMap: Boolean(countryFocusCountry?.trim()),
  });
  const suppliersCounts = useMemo(
    () => countSuppliersPipeline(allLicenses.map((l) => l.id), userAnnotations),
    [allLicenses, userAnnotations],
  );
  const mapProcessedData = useDeferredValue(
    countryFocusCountry?.trim() ? miningData.mapProcessedData : miningData.processedData,
  );

  useEffect(() => {
    const focus = countryFocusCountry?.trim();
    if (focus) {
      setLicenseFetchCountries([focus]);
      return;
    }
    if (miningData.selectedCountry.length === 1) {
      setLicenseFetchCountries([...miningData.selectedCountry]);
      return;
    }
    setLicenseFetchCountries([]);
  }, [countryFocusCountry, miningData.selectedCountry]);

  const selectedCountryBeforeFocusRef = useRef<string[]>([]);
  const selectedCountryLiveRef = useRef<string[]>([]);
  useEffect(() => {
    selectedCountryLiveRef.current = miningData.selectedCountry;
  }, [miningData.selectedCountry]);

  const applyCountryFocus = useCallback(
    (name: string) => {
      setCountryFocusCountry((cur) => {
        if (cur == null) {
          selectedCountryBeforeFocusRef.current = selectedCountryLiveRef.current.slice();
        }
        return name;
      });
      miningData.setSelectedCountryImmediate([name]);
      miningData.setFilter('');
      setCountryFocusBoundsTrigger((n) => n + 1);
    },
    [miningData],
  );

  const clearCountryFocus = useCallback(() => {
    setCountryFocusCountry(null);
    miningData.setSelectedCountry(selectedCountryBeforeFocusRef.current.slice());
  }, [miningData]);

  const handleBannerClearFilters = useCallback(() => {
    setCountryFocusCountry(null);
    selectedCountryBeforeFocusRef.current = [];
    miningData.resetFilters();
  }, [miningData]);

  const handleCommitLicenseSearch = useCallback(
    (query: string) => {
      miningData.commitSearchFilter(query);
    },
    [miningData.commitSearchFilter],
  );

  useEffect(() => {
    if (!countryFocusCountry) return;
    const sel = miningData.selectedCountry;
    if (sel.length !== 1 || sel[0] !== countryFocusCountry) {
      setCountryFocusCountry(null);
    }
  }, [miningData.selectedCountry, countryFocusCountry]);

  useEffect(() => {
    if (viewMode !== 'oil_and_gas') {
      setStorageInViewCount(null);
    }
  }, [viewMode]);

  const handleMapSidebarTabChange = useCallback(
    (tab: MapSidebarTab) => {
      setMapSidebarTab(tab);
      if (tab === 'live_data' || tab === 'historic') {
        // Live + Historic layers use petroleum APIs/overlays — always open Oil & Gas map context.
        setViewMode('oil_and_gas');
        setIsSidebarCollapsed(false);
        setIsSidebarPinned(true);
        if (tab === 'live_data') {
          setLiveDataFlyTrigger((n) => n + 1);
          setLiveDataFlyTarget(null);
        }
        if (tab === 'historic') {
          void prefetchEiaHistoricData(queryClient).then(({ year }) => {
            const mapData = queryClient.getQueryData<{
              arcs: import('./api/eiaHistoricApi').EiaHistoricMapArc[];
              origins?: import('./api/eiaHistoricApi').EiaHistoricMapOrigin[];
            }>(eiaHistoricMapQueryKey(year, ''));
            if (!mapData?.arcs?.length) return;
            setHistoricSidebarMap((prev) =>
              prev.enabled
                ? prev
                : {
                    enabled: true,
                    arcs: mapData.arcs,
                    origins: mapData.origins,
                    year,
                    showCorridors: prev.showCorridors,
                  },
            );
          });
        }
      }
      if (tab !== 'live_data') {
        setOilLiveEntity(null);
      }
    },
    [queryClient],
  );

  useEffect(() => {
    if (!isHistoricSidebar) return;
    void prefetchEiaHistoricData(queryClient).then(({ year }) => {
      const mapData = queryClient.getQueryData<{
        arcs: import('./api/eiaHistoricApi').EiaHistoricMapArc[];
        origins?: import('./api/eiaHistoricApi').EiaHistoricMapOrigin[];
      }>(eiaHistoricMapQueryKey(year, ''));
      if (!mapData?.arcs?.length) return;
      setHistoricSidebarMap((prev) =>
        prev.enabled
          ? prev
          : {
              enabled: true,
              arcs: mapData.arcs,
              origins: mapData.origins,
              year,
              showCorridors: prev.showCorridors,
            },
      );
    });
  }, [isHistoricSidebar, queryClient]);

  useEffect(() => {
    if (!isLiveDataSidebar) {
      setLiveDataEiaHistoricOn(false);
      setSelectedHistoricArc(null);
    }
    if (!isLiveDataSidebar) {
      setOilLiveEntity(null);
      return;
    }
    setOilLiveLayers((prev) => (prev.vessels ? prev : { ...prev, vessels: true }));
  }, [isLiveDataSidebar]);

  const liveDataEiaHistoricMapQuery = useQuery({
    queryKey: eiaHistoricMapQueryKey(LIVE_DATA_EIA_HISTORIC_DEFAULT_YEAR, ''),
    queryFn: () =>
      getEiaHistoricMap({ year: LIVE_DATA_EIA_HISTORIC_DEFAULT_YEAR, limit: 80 }),
    enabled: isLiveDataSidebar && liveDataEiaHistoricOn,
    staleTime: EIA_HISTORIC_STALE_MS,
  });

  const eiaHistoricFromHistoricTab = isHistoricSidebar && historicSidebarMap.enabled;
  const eiaHistoricFromLiveData = isLiveDataSidebar && liveDataEiaHistoricOn;
  const eiaHistoricMapEnabled = eiaHistoricFromHistoricTab || eiaHistoricFromLiveData;
  const eiaHistoricMapArcs = eiaHistoricFromHistoricTab
    ? historicSidebarMap.arcs
    : eiaHistoricFromLiveData
      ? (liveDataEiaHistoricMapQuery.data?.arcs ?? [])
      : [];
  const eiaHistoricMapOrigins = eiaHistoricFromHistoricTab
    ? historicSidebarMap.origins
    : eiaHistoricFromLiveData
      ? liveDataEiaHistoricMapQuery.data?.origins
      : undefined;
  const eiaHistoricMapYear = eiaHistoricFromHistoricTab
    ? historicSidebarMap.year
    : LIVE_DATA_EIA_HISTORIC_DEFAULT_YEAR;
  const eiaHistoricShowCorridors = eiaHistoricFromHistoricTab
    ? historicSidebarMap.showCorridors
    : eiaHistoricFromLiveData;

  useEffect(() => {
    if (!eiaHistoricMapEnabled) setSelectedHistoricArc(null);
  }, [eiaHistoricMapEnabled]);

  useEffect(() => {
    if (!isLiveDataSidebar) return;
    let cancelled = false;
    getMacroTradeFlows({ limit: 150 })
      .then((res) => {
        if (!cancelled) setMacroTradeFlows(res.flows ?? []);
      })
      .catch(() => {
        if (!cancelled) setMacroTradeFlows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isLiveDataSidebar]);

  const handleInfrastructureLayerChange = useCallback(
    (layerId: OsmPetroleumLayerId, visible: boolean) => {
      setInfrastructureLayerVisibility((prev) => ({ ...prev, [layerId]: visible }));
      if (visible) {
        setInfrastructureForcedLayers((prev) => ({ ...prev, [layerId]: true }));
      }
    },
    [],
  );

  const handleLicenseClusterDrillComplete = useCallback(
    (expandBounds: LicenseViewportBounds, zoom?: number) => {
      setLicenseDrillExpandBounds(normalizeLicenseViewportBounds(expandBounds));
      if (zoom != null && Number.isFinite(zoom)) {
        setLicenseMapZoom(zoom);
      }
      queryClient.invalidateQueries({ queryKey: ['licenses', 'viewport'] });
    },
    [queryClient],
  );

  const infrastructurePanelHint = useMemo(
    () =>
      infrastructureLayersPanelHint(
        licenseMapZoom,
        infrastructureLayerVisibility,
        infrastructureForcedLayers,
      ),
    [licenseMapZoom, infrastructureLayerVisibility, infrastructureForcedLayers],
  );

  useEffect(() => {
    if (viewMode === 'mining' || viewMode === 'oil_and_gas') {
      miningData.setSelectedSector(viewMode);
    } else {
      miningData.setSelectedSector(null);
    }
    if (viewMode === 'suppliers') {
      miningData.setSuppliersShowAll(false);
    }
  }, [viewMode, miningData.setSelectedSector, miningData.setSuppliersShowAll]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleLogin = async (user: string, pass: string) => {
    try {
      const data = await login(user, pass);
      localStorage.setItem('mining_token', data.access_token);
      localStorage.setItem('mining_role', data.role);
      localStorage.setItem('mining_username', data.username);
      localStorage.setItem('mining_userid', data.id);

      setToken(data.access_token);
      setUsername(data.username);
      setUserId(data.id);
      setAuthError(null);
      logActivityMutation.mutate({ user_id: data.id, username: data.username, action: 'LOGIN', details: 'User logged in' });
    } catch (err: unknown) {
      setAuthError(formatAuthError(err));
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('mining_token');
    localStorage.removeItem('mining_role');
    localStorage.removeItem('mining_username');
    localStorage.removeItem('mining_userid');
    setToken(null);
    setUsername(null);
    setUserId(null);
  };

  const handleOpenDossier = useCallback((item: MiningLicense) => {
    setSelectedMaritimeVessel(null);
    setDossierItem(item);
    setIsDossierOpen(true);
    if (userId && username) {
      logActivityMutation.mutate({ user_id: userId, username, action: 'VIEW_DOSSIER', details: `Viewed ${item.company} (${item.id})` });
    }
  }, [userId, username, logActivityMutation]);

  const handleNavigateToDealRoom = useCallback((dealRoomId: string) => {
    setInvestigationsSubTab('deal_rooms');
    setHighlightedDealRoomId(dealRoomId);
    setViewMode('investigations');
    setIsDossierOpen(false);
  }, []);

  const handleNavigateToEuProcurement = useCallback((cpvBucket: string) => {
    setEuProcurementCpvBucket(cpvBucket);
    setInvestigationsSubTab('due_diligence');
    setViewMode('investigations');
    setIsDossierOpen(false);
  }, []);

  const handleOpenInvestigations = useCallback(() => {
    setInvestigationsSubTab('due_diligence');
    setViewMode('investigations');
    setIsDossierOpen(false);
  }, []);

  const getDealRoomForLicense = useCallback(
    (licenseId: string, entityKind = 'license') => dealRooms.getRoomForEntity(licenseId, entityKind),
    [dealRooms],
  );

  const handleSelectItem = useCallback((item: MiningLicense | null) => {
    setSelectedMaritimeVessel(null);
    setOilLiveEntity(null);
    setSelectedItem(item);
  }, []);

  const handleOilLiveEntityClick = useCallback((payload: OilLiveEntityClickPayload) => {
    setSelectedItem(null);
    setSelectedMaritimeVessel(null);
    setOilLiveEntity(payload);
  }, []);

  const handleLiveDataMapFlyTo = useCallback((lat: number, lng: number) => {
    setLiveDataFlyTarget({ lat, lng });
    setLiveDataFlyTrigger((n) => n + 1);
  }, []);

  const handleCreateDealRoomFromOpportunity = useCallback(async () => {
    if (!oilLiveEntity || oilLiveEntity.entityKind !== 'opportunity') return;
    try {
      const room = await createDealRoom({
        entityId: oilLiveEntity.entityId,
        entityKind: 'opportunity',
        title: oilLiveEntity.title ?? 'Live Data opportunity',
        rfq_product: oilLiveProductFilter !== 'all' ? oilLiveProductFilter : undefined,
      });
      toast.success(t('חדר עסקה נוצר', 'Deal room created'));
      handleNavigateToDealRoom(room.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Deal room failed');
    }
  }, [oilLiveEntity, oilLiveProductFilter, handleNavigateToDealRoom, t]);

  const handleOilLiveDismiss = useCallback(() => {
    setOilLiveEntity(null);
  }, []);

  const handleOpenOilLiveOpportunity = useCallback((opportunityId: string, title?: string) => {
    setSelectedItem(null);
    setSelectedMaritimeVessel(null);
    setOilLiveEntity({
      entityKind: 'opportunity',
      entityId: opportunityId,
      opportunityId,
      title,
    });
  }, []);

  const handleOpenOilLiveCargo = useCallback((record: {
    id: string;
    opportunity_id?: string;
    vessel_name?: string;
    synthetic_bol_id?: string;
    commodity_family?: string;
    load_port_name?: string;
    discharge_hint?: string;
  }) => {
    setSelectedItem(null);
    setSelectedMaritimeVessel(null);
    setOilLiveEntity({
      entityKind: 'cargo',
      entityId: record.id,
      opportunityId: record.opportunity_id,
      title: record.vessel_name ?? record.synthetic_bol_id ?? record.commodity_family ?? record.id.slice(0, 8),
      subtitle: [record.load_port_name, record.discharge_hint].filter(Boolean).join(' → '),
    });
  }, []);

  const handleOpenRoutePlannerFromLiveData = useCallback(
    (hints: LiveDataRouteHints) => {
      const filled = applyLiveDataRouteHints(
        hints,
        routePlanner.prefillSupplier,
        routePlanner.prefillBuyer,
      );
      const product = routeProductFromCommodityFamily(hints.commodity_family);
      if (product) routePlanner.setProductType(product);
      setOilLiveEntity(null);
      setViewMode('route_planner');
      if (!filled.supplier && !filled.buyer) {
        toast.info(
          t(
            'לא נמצאו נמלי MCR — בחרו ידנית בתכנון מסלול',
            'Could not match MCR port names — pick load/discharge manually in Route Planner',
          ),
        );
      } else if (!filled.buyer) {
        toast.info(
          t('נמל פריקה לא זוהה — השלימו ידנית', 'Discharge port not matched — complete buyer side manually'),
        );
      }
    },
    [routePlanner, t],
  );

  const handleOpenOilLiveCompanyDossier = useCallback(
    async (companyId: string) => {
      try {
        let company = { id: companyId, name: '', supplier_id: null as string | null };
        const cached = queryClient.getQueryData<{ companies: Array<{ id: string; name: string; supplier_id?: string | null }> }>(
          ['oil-live-companies'],
        );
        const fromList = cached?.companies?.find((c) => c.id === companyId);
        if (fromList) {
          company = { id: fromList.id, name: fromList.name, supplier_id: fromList.supplier_id ?? null };
        } else {
          const fetched = await fetchOilCompanyForDossier(companyId);
          company = {
            id: fetched.id,
            name: fetched.name,
            supplier_id: fetched.supplier_id ?? null,
          };
        }
        const lic = findDossierLicenseForOilCompany(company, entityIndex, allLicenses);
        if (lic) {
          setOilLiveEntity(null);
          handleOpenDossier(lic);
          return;
        }
        toast.info(
          t(
            'אין דוסייה — שמרו לספקים תחילה',
            'No dossier yet — Save to Suppliers first to create a license record',
          ),
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to open dossier');
      }
    },
    [queryClient, entityIndex, allLicenses, handleOpenDossier, t],
  );

  const updateAnnotation = useCallback((id: string, updates: Partial<UserAnnotation>) => {
    persistAnnotation(id, updates);

    const targetEntity = entityIndex[id];
    if (targetEntity?.entityKind === 'storage_terminal') {
      return;
    }

    // Map to backend fields
    const backendPayload: any = {};
    if (updates.price !== undefined) backendPayload.pricePerKg = parseFloat(updates.price.toString());
    if (updates.quantity !== undefined) backendPayload.capacity = parseFloat(updates.quantity.toString());
    if (updates.status !== undefined) backendPayload.status = updates.status === 'good' ? 'APPROVED' : updates.status;
    if (updates.commodity !== undefined) backendPayload.commodity = updates.commodity;

    if (Object.keys(backendPayload).length > 0) {
      updateLicenseMutation.mutate({ id, updates: backendPayload });
    }
  }, [persistAnnotation, updateLicenseMutation, entityIndex]);

  const deleteLicense = useCallback((id: string) => {
    const targetEntity = entityIndex[id];
    if (targetEntity?.entityKind === 'storage_terminal') {
      toast.info(t('רשומת תשתית פתוחה', 'Open infrastructure record'), {
        description: t(
          'רשומות OSM/Overpass הן לקריאה בלבד ואינן נמחקות מהמפה מתוך הלקוח.',
          'OSM/Overpass infrastructure records are read-only and cannot be deleted from the client.'
        ),
      });
      return;
    }
    if (!confirm(t("האם אתה בטוח שברצונך למחוק רישיון זה?", "Are you sure you want to delete this license?"))) return;
    const closeDossierIfDeleted = () => {
      setDossierItem((prev) => {
        if (prev?.id === id) {
          setIsDossierOpen(false);
          return null;
        }
        return prev;
      });
    };
    const isLocalOnly = localLicenses.some((l) => l.id === id);
    if (isLocalOnly) {
      setLocalLicenses((prev) => prev.filter((l) => l.id !== id));
      setSelectedItem(null);
      closeDossierIfDeleted();
      toast.info(t("הרישיון נמחק", "License deleted"));
      if (userId && username) {
        logActivityMutation.mutate({
          user_id: userId,
          username,
          action: 'DELETE_LICENSE',
          details: `Deleted local license ${id}`,
        });
      }
      return;
    }
    deleteLicenseMutation.mutate(id, {
      onSuccess: () => {
        setSelectedItem(null);
        closeDossierIfDeleted();
        toast.info(t("הרישיון נמחק", "License deleted"));
        if (userId && username) {
          logActivityMutation.mutate({
            user_id: userId,
            username,
            action: 'DELETE_LICENSE',
            details: `Deleted license ${id}`,
          });
        }
      },
    });
  }, [t, deleteLicenseMutation, localLicenses, userId, username, logActivityMutation, entityIndex]);

  const mapCenter: [number, number] =
    viewMode === 'ports'
      ? [20, 0]
      : isLiveDataSidebar
        ? LIVE_DATA_HUB_CENTER
        : [7.9465, -1.0232];
  
  // Market Prices State
  const [marketPrices, setMarketPrices] = useState<MarketTickerRow[]>([]);
  const bannerCoverageSector: LicenseCoverageSector | null =
    viewMode === 'mining'
      ? 'mining'
      : viewMode === 'oil_and_gas'
        ? 'oil_and_gas'
        : viewMode === 'global'
          ? 'mining'
          : null;
  const sectorCoverageBanner = bannerCoverageSector
    ? getSectorCoverageSummary(worldCoverage, bannerCoverageSector)
    : null;
  const oilCoverageBannerLine =
    viewMode === 'global'
      ? formatCoverageSummaryCounts(getSectorCoverageSummary(worldCoverage, 'oil_and_gas'))
      : null;
  const licenseCoveragePanelSector: LicenseCoverageSector | null =
    viewMode === 'mining'
      ? 'mining'
      : viewMode === 'oil_and_gas'
        ? 'oil_and_gas'
        : viewMode === 'global'
          ? 'mining'
          : null;
  const showLicenseCoveragePanel =
    mapSidebarTab === 'licenses' &&
    (viewMode === 'global' || viewMode === 'mining' || viewMode === 'oil_and_gas');
  const sidebarViewMode =
    viewMode === 'admin'
      ? 'admin'
      : viewMode === 'investigations'
        ? 'dashboard'
        : 'map';
  const handleSidebarViewModeChange = (mode: 'map' | 'admin' | 'dashboard') => {
    if (mode === 'admin') {
      setViewMode('admin');
      return;
    }
    if (mode === 'dashboard') {
      setViewMode('investigations');
      return;
    }
    setViewMode('global');
  };

  const switchSectorView = useCallback((mode: 'global' | 'mining' | 'oil_and_gas') => {
    startTransition(() => {
      setViewMode(mode);
      // Oil & Gas top-nav view = license/storage map; Live/Historic are sidebar tabs only.
      setMapSidebarTab('licenses');
      setOilLiveEntity(null);
    });
  }, []);

  const handleOilLiveLensChange = useCallback((lens: LiveDataLensMode) => {
    setOilLiveLens(lens);
    setOilLiveLayers(layersForLiveDataLens(lens));
    setOilLiveTradeFlowGroup(
      lens === 'raw' || lens === 'crisis' ? 'country_pair' : 'company_pair',
    );
    setLiveDataMacroTradeOn(lens !== 'infrastructure');
    setLiveDataEiaHistoricOn(false);
    setIsMaritimeLayerEnabled(lens === 'raw' || lens === 'crisis');
    if (lens === 'infrastructure') {
      setInfrastructureLayerVisibility({
        pipelines: true,
        refineries: true,
        storage_terminals: true,
      });
    }
    if (lens === 'crisis') {
      const b = CRISIS_HORMUZ_BBOX;
      setLiveDataFlyTarget({
        lat: (b.south + b.north) / 2,
        lng: (b.west + b.east) / 2,
      });
      setLiveDataFlyTrigger((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    const apiBase = API_BASE;

    const fetchPrices = async () => {
      // Backend: gold/silver as COMEX GC=F / SI=F (USD/troy oz) + energy/crypto via Yahoo/CoinGecko
      try {
        const tickerRes = await fetch(`${apiBase}/api/market-ticker`);
        if (tickerRes.ok) {
          const rows = await tickerRes.json();
          if (Array.isArray(rows) && rows.length > 0) {
            setMarketPrices(rows);
            return;
          }
        }
      } catch (_) {
        /* offline or CORS — minimal client fallbacks (no demo spot numbers) */
      }

      const results: any[] = [];

      if (!results.some((r) => r.symbol === 'GOLD/oz')) {
        results.push({
          symbol: 'GOLD/oz',
          price: '$—',
          category: 'Metal',
          change: '—',
          up: null,
        });
      }
      if (!results.some((r) => r.symbol === 'SILVER/oz')) {
        results.push({
          symbol: 'SILVER/oz',
          price: '$—',
          category: 'Metal',
          change: '—',
          up: null,
        });
      }

      try {
        const btcRes = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true'
        );
        if (btcRes.ok) {
          const data = await btcRes.json();
          const ch = data.bitcoin?.usd_24h_change ?? 0;
          results.push({
            symbol: 'BTC/USD',
            price: `$${data.bitcoin.usd.toLocaleString()}`,
            category: 'Crypto',
            up: ch >= 0,
            change: `${ch >= 0 ? '+' : ''}${Number(ch).toFixed(2)}%`,
          });
        }
      } catch (_) {}

      // Last resort when backend unreachable — no fake “live” oil numbers
      results.push(
        {
          symbol: 'BRENT',
          price: '—',
          category: 'Energy',
          change: 'API',
          up: null,
        },
        {
          symbol: 'WTI CRUDE',
          price: '—',
          category: 'Energy',
          change: 'API',
          up: null,
        }
      );

      setMarketPrices(results);
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Triple-Panel States
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const maritimeMapViewActive = MARITIME_MAP_VIEWS.has(viewMode);

  useEffect(() => {
    if (viewMode === 'oil_and_gas' || isLiveDataSidebar) {
      setPrioritizePetroleumVessels(true);
    }
  }, [viewMode, isLiveDataSidebar]);

  useEffect(() => {
    if (!isLiveDataSidebar) return;
    setIsMaritimeLayerEnabled(false);
    setVesselFilters(LIVE_DATA_VESSEL_FILTERS);
  }, [isLiveDataSidebar]);

  useEffect(() => {
    if (!maritimeMapViewActive) {
      setIsMaritimeLayerEnabled(false);
      setSelectedMaritimeVessel(null);
    }
  }, [maritimeMapViewActive]);

  useEffect(() => {
    if (!username || !maritimeMapViewActive || isLiveDataSidebar) return;
    const scope = viewMode === 'oil_and_gas' ? ('oil_tankers' as const) : ('all_vessels' as const);
    void prefetchMaritimeVesselSnapshot(queryClient, {
      maxVessels: Number(maritimeMaxVessels) || 15000,
      captureWindowSeconds: Number(maritimeCaptureWindow) || 25,
      scope,
    });
  }, [username, maritimeMapViewActive, isLiveDataSidebar, viewMode, queryClient, maritimeMaxVessels, maritimeCaptureWindow]);

  return (
    <div className={`h-screen w-screen flex flex-col bg-stone-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans ${isRtl ? 'rtl' : 'ltr'}`}>
      {/* 1. Global Market Ticker (Entrepreneur Desk) */}
      <div className="h-8 w-full bg-slate-50 dark:bg-slate-950 border-b border-black/5 dark:border-white/5 flex items-center overflow-hidden">
         <div className="flex items-center gap-2 px-4 border-r border-black/5 dark:border-white/5 bg-amber-500/10 h-full shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[9px] font-black uppercase text-amber-500 tracking-widest">{t("שווקים חיים", "LIVE MARKETS")}</span>
         </div>
         <div className="flex-1 overflow-hidden relative">
            <div className="flex items-center gap-12 whitespace-nowrap animate-marquee py-1">
               {marketPrices.length > 0 ? (
                 <>
                   {marketPrices.map((item, idx) => (
                     <TickerItem key={`${item.symbol}-${idx}`} symbol={item.symbol} price={item.price} change={item.change} up={item.up} />
                   ))}
                   {/* Repeat for seamless marquee */}
                   {marketPrices.map((item, idx) => (
                     <TickerItem key={`${item.symbol}-repeat-${idx}`} symbol={item.symbol} price={item.price} change={item.change} up={item.up} />
                   ))}
                 </>
               ) : (
                 <>
                   <TickerItem symbol="XAU/USD" price="---" change="0.00%" up />
                   <TickerItem symbol="XAG/USD" price="---" change="0.00%" />
                   <TickerItem symbol="XPT/USD" price="---" change="0.00%" up />
                   <TickerItem symbol="BRENT" price="---" change="0.00%" up />
                 </>
               )}
            </div>
         </div>
      </div>

      <PlatformHealthChip />

      {viewMode !== 'ports' && viewMode !== 'route_planner' && fetchError && (
        <div
          className="shrink-0 px-4 py-2 bg-red-950/95 border-b border-red-500/30 text-red-100 text-[11px] font-bold text-center"
          role="alert"
        >
          {t(
            'טעינת רישיונות נכשלה',
            'Could not load licenses'
          )}
          : {formatLicenseFetchError(fetchError)}
          {'. '}
          {licenseFetchTroubleshooting}
        </div>
      )}
      {viewMode === 'ports' && portsError && (
        <div
          className="shrink-0 px-4 py-2 bg-red-950/95 border-b border-red-500/30 text-red-100 text-[11px] font-bold text-center"
          role="alert"
        >
          {t('טעינת נמלים נכשלה', 'Could not load ports and logistics nodes')}
          : {formatLicenseFetchError(portsError)}
        </div>
      )}
      {viewMode === 'oil_and_gas' && storageError && (
        <div
          className="shrink-0 px-4 py-2 bg-amber-950/95 border-b border-amber-500/30 text-amber-100 text-[11px] font-bold text-center"
          role="alert"
        >
          {t(
            'שכבת האחסון הפתוחה לא נטענה כרגע',
            'Open storage infrastructure layer is unavailable right now'
          )}
          : {formatLicenseFetchError(storageError)}
        </div>
      )}

      {/* 2. Main Discovery Layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {!token && <AuthOverlay onLogin={handleLogin} error={authError} />}
        
        {/* PANEL 1: Left Navigation & Results List — hidden on mobile, shown on md+ */}
        <aside 
          className={`hidden min-h-0 md:flex md:flex-col md:h-full transition-all duration-500 ease-[0.23,1,0.32,1] z-40 border-r border-stone-200/80 dark:border-white/5 bg-stone-100/85 dark:bg-slate-950/40 backdrop-blur-3xl shadow-2xl relative
          ${
            isSidebarCollapsed && !isSidebarPinned
              ? 'w-16'
              : mapSidebarTab !== 'licenses'
                ? 'w-[min(28rem,42vw)]'
                : 'w-96'
          }`}
          onMouseEnter={() => !isSidebarPinned && setIsSidebarCollapsed(false)}
          onMouseLeave={() => !isSidebarPinned && setIsSidebarCollapsed(true)}
        >
          {(viewMode === 'global' ||
            viewMode === 'mining' ||
            viewMode === 'oil_and_gas' ||
            viewMode === 'suppliers') && (
            <WorkspaceSidebarLayout
              tab={mapSidebarTab}
              onTabChange={handleMapSidebarTabChange}
              isCollapsed={isSidebarCollapsed && !isSidebarPinned}
              isPinned={isSidebarPinned}
              setIsPinned={setIsSidebarPinned}
              sidebarViewMode={sidebarViewMode}
              onSidebarViewModeChange={handleSidebarViewModeChange}
              onToggleFilter={() => setIsFilterOpen(!isFilterOpen)}
              onToggleAdmin={() => setViewMode('admin')}
              isFilterOpen={isFilterOpen}
              onLogout={handleLogout}
              processedData={miningData.processedData}
              setIsAddModalOpen={setIsAddModalOpen}
              onOpenBulkImport={() => setIsBulkImportOpen(true)}
              loading={
                viewMode === 'ports'
                  ? isPortsLoading
                  : Boolean(isLoading && rawData.length === 0)
              }
              userAnnotations={userAnnotations}
              selectedItem={selectedItem}
              setSelectedItem={(item: MiningLicense) => {
                handleSelectItem(item);
                setMapFlyTrigger((prev) => prev + 1);
              }}
              infrastructureStats={
                viewMode === 'oil_and_gas' || viewMode === 'ports'
                  ? miningData.infrastructureStats
                  : undefined
              }
              isInDdQueue={ddQueue.isInQueue}
              onAddToDueDiligence={ddQueue.addToQueue}
              onRemoveFromDueDiligence={ddQueue.removeFromQueue}
              getDealRoomForLicense={getDealRoomForLicense}
              worldCoverage={worldCoverage}
              licenseCoverageSector={licenseCoveragePanelSector}
              licenseCoverageAlsoShowSector={viewMode === 'global' ? 'oil_and_gas' : null}
              showLicenseCoveragePanel={showLicenseCoveragePanel}
              liveDataPanel={
                <Suspense fallback={<LazySurfaceFallback label={t('טוען נתונים חיים...', 'Loading live data...')} />}>
                  <LiveDataIntelPanel
                    productFilter={oilLiveProductFilter}
                    onProductFilterChange={setOilLiveProductFilter}
                    terminalSearch={oilLiveTerminalSearch}
                    onTerminalSearchChange={setOilLiveTerminalSearch}
                    coverageStats={oilLiveCoverageStats}
                    onOpenOpportunity={handleOpenOilLiveOpportunity}
                    onOpenCargoRecord={handleOpenOilLiveCargo}
                    onOpenCompanyDossier={handleOpenOilLiveCompanyDossier}
                    onOpenRoutePlanner={handleOpenRoutePlannerFromLiveData}
                    liveDataLens={oilLiveLens}
                    onLiveDataLensChange={handleOilLiveLensChange}
                    onOpenLiveEntity={handleOilLiveEntityClick}
                    onMapFlyTo={handleLiveDataMapFlyTo}
                  />
                </Suspense>
              }
              historicPanel={
                <Suspense fallback={<LazySurfaceFallback label={t('טוען היסטורי…', 'Loading historic…')} />}>
                  <EiaHistoricImportsPanel
                    onMapArcsChange={setHistoricSidebarMap}
                    importerFromMap={historicImporterFromMap}
                    onImporterFromMapConsumed={() => setHistoricImporterFromMap(null)}
                  />
                </Suspense>
              }
            />
          )}
        </aside>

        {/* PANEL 2: Central Map Workspace */}
        <main className="flex-1 relative z-0 h-full overflow-hidden">
          {/* Top Command Toolbar - Only show on Map, Pipeline, Logistics, Oil */}
          {/* Oil mode uses its own full-screen chrome — avoid stacking two toolbars */}
          {(viewMode === 'global' ||
            viewMode === 'mining' ||
            viewMode === 'oil_and_gas' ||
            viewMode === 'suppliers' ||
            viewMode === 'ports' ||
            viewMode === 'investigations' ||
            viewMode === 'route_planner') && (
            <div className="absolute top-4 left-3 right-3 sm:left-6 sm:right-6 z-[1000] flex justify-end sm:justify-between items-center pointer-events-none">
              {/* Search bar — hidden on mobile, shown on sm+ */}
              <div className="hidden sm:flex items-start gap-3 pointer-events-auto flex-wrap">
                  <IntelligenceSearchBox
                    countries={miningData.countries}
                    externalFilter={miningData.filter}
                    countryFocusCountry={countryFocusCountry}
                    onApplyCountryFocus={applyCountryFocus}
                    onCommitLicenseSearch={handleCommitLicenseSearch}
                  />
                  {countryFocusCountry && (
                    <button
                      type="button"
                      onClick={clearCountryFocus}
                      className="flex h-10 max-w-[min(100%,16rem)] items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/15 px-3 text-[10px] font-black uppercase tracking-widest text-amber-800 shadow-xl backdrop-blur-xl hover:bg-amber-500/25 dark:text-amber-200"
                    >
                      <span className="truncate">
                        {t('מיקוד מדינה', 'Country focus')}: {countryFocusCountry}
                      </span>
                      <LucideX className="h-4 w-4 shrink-0" aria-hidden />
                    </button>
                  )}
                  {sectorCoverageBanner && viewMode !== 'route_planner' && (
                    <div
                      className="hidden lg:flex flex-col justify-center px-3 min-h-10 rounded-2xl bg-stone-100/90 dark:bg-slate-950/60 backdrop-blur-2xl border border-stone-200/90 dark:border-white/10 shadow-2xl text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 max-w-md"
                      title={WORLD_COVERAGE_BANNER_NOTE}
                    >
                      <span>
                        {t('כיסוי רישיונות', 'License coverage')}
                        {viewMode === 'global'
                          ? ` (${t('כרייה', 'Mining')})`
                          : ''}
                        :{' '}
                        {formatCoverageSummaryCounts(sectorCoverageBanner) ??
                          t('אין נתוני כיסוי', 'No coverage data')}
                      </span>
                      {oilCoverageBannerLine && (
                        <span className="text-[8px] font-bold normal-case tracking-normal text-slate-500 mt-0.5">
                          {t('נפט וגז', 'Oil & gas')}: {oilCoverageBannerLine}
                        </span>
                      )}
                    </div>
                  )}
                  <div
                    className="hidden lg:flex items-center gap-1.5 px-2 h-10 rounded-2xl bg-stone-100/90 dark:bg-slate-950/60 backdrop-blur-2xl border border-stone-200/90 dark:border-white/10 shadow-2xl text-slate-500 dark:text-slate-400"
                    title={mapViewHelpBody(viewMode)}
                  >
                    <LucideHelpCircle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 max-w-[10rem] truncate">
                      {t(mapViewHelpTitle(viewMode), mapViewHelpTitle(viewMode))}
                    </span>
                  </div>
                  {viewMode === 'suppliers' && (
                    <div className="hidden sm:flex items-center gap-2">
                      <div className="flex items-center px-3 h-10 rounded-2xl bg-emerald-500/10 backdrop-blur-2xl border border-emerald-500/30 shadow-2xl text-[9px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                        {t('ספקים פעילים', 'Active suppliers')}: {suppliersCounts.active}
                        <span className="mx-1 opacity-50">/</span>
                        {suppliersCounts.total}
                      </div>
                      <button
                        type="button"
                        onClick={() => miningData.setSuppliersShowAll((v) => !v)}
                        className={`h-10 rounded-2xl border px-3 text-[9px] font-black uppercase tracking-widest shadow-2xl backdrop-blur-2xl ${
                          miningData.suppliersShowAll
                            ? 'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200'
                            : 'border-stone-200/90 bg-stone-100/90 text-slate-600 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-300'
                        }`}
                      >
                        {miningData.suppliersShowAll
                          ? t('הצג pipeline בלבד', 'Pipeline only')
                          : t('הצג את כל הרישיונות', 'Show all licenses')}
                      </button>
                    </div>
                  )}
                  {miningData.activeFilterCount > 0 && (
                    <div className="hidden lg:flex items-center gap-2 px-3 h-10 rounded-2xl bg-amber-500/10 backdrop-blur-2xl border border-amber-500/30 shadow-2xl text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                      {t("מסננים פעילים", "Active filters")}: {miningData.activeFilterCount}
                      <button
                        type="button"
                        onClick={handleBannerClearFilters}
                        className="rounded-lg border border-amber-500/50 px-2 py-1 text-[8px] font-black uppercase tracking-widest hover:bg-amber-500/20"
                      >
                        {t("נקה", "Clear")}
                      </button>
                    </div>
                  )}
              </div>

              <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto">
                  <div className="flex gap-0.5 sm:gap-1.5 bg-stone-100/90 sm:bg-stone-100/80 dark:bg-slate-950/60 dark:sm:bg-slate-950/40 backdrop-blur-2xl p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border border-stone-200/90 sm:border-stone-200/70 dark:border-white/10 dark:sm:border-white/5 shadow-2xl">
                    <button
                      onClick={() => switchSectorView('global')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'global' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-white/5'}`}
                    >
                      {t("עולמי", "Global")}
                    </button>
                    <button
                      onClick={() => switchSectorView('mining')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'mining' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-white/5'}`}
                    >
                      {t("כרייה", "Mining")}
                    </button>
                    <button
                      onClick={() => switchSectorView('oil_and_gas')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${viewMode === 'oil_and_gas' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-white/5'}`}
                    >
                      <LucideDroplets className="w-3.5 h-3.5" />
                      {t("נפט וגז", "Oil & Gas")}
                    </button>
                    <button
                      onClick={() => setViewMode('suppliers')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${viewMode === 'suppliers' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-white/5'}`}
                    >
                      {t("ספקים", "Suppliers")}
                      {suppliersCounts.active > 0 && (
                        <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-emerald-500/30 text-[9px] font-black px-1">
                          {suppliersCounts.active}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setViewMode('ports')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'ports' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-white/5'}`}
                    >
                      {t("נמלים", "Ports")}
                    </button>
                    <button
                      onClick={() => setViewMode('route_planner')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${viewMode === 'route_planner' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-white/5'}`}
                    >
                      <LucideNavigation className="w-3.5 h-3.5" aria-hidden />
                      {t('מסלול', 'Route')}
                    </button>
                    <button
                      onClick={() => setViewMode('investigations')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${viewMode === 'investigations' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-white/5'}`}
                    >
                      {t('חקירות', 'Investigations')}
                      {(ddQueue.queue.length > 0 || dealRooms.count > 0) && (
                        <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-slate-950/20 dark:bg-white/20 text-[9px] font-black px-1">
                          {ddQueue.queue.length + dealRooms.count}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Filter button — hidden on mobile (available in bottom nav) */}
                  <ThemeToggle className="hidden sm:flex" />
                  <button
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    className={`hidden sm:flex p-3 rounded-2xl border transition-all active:scale-95 shadow-2xl backdrop-blur-2xl ${isFilterOpen ? 'bg-amber-500 border-amber-500 text-slate-950' : 'bg-stone-100/90 dark:bg-slate-950/60 border-stone-200/90 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    <LucideFilter className="w-5 h-5" />
                  </button>
              </div>
            </div>
          )}

          {viewMode === 'oil_and_gas' && (
            <>
              <div className="absolute top-[4.5rem] left-3 right-3 z-[999] pointer-events-auto max-w-lg">
                <OilGasOnboardingTip active />
              </div>
              {storageViewportCoverageGapMessage(storageTerminalResponse) && (
                <div className="absolute top-[7.5rem] left-3 right-3 z-[999] pointer-events-none max-w-xl">
                  <div className="rounded-2xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-[10px] font-semibold text-amber-950 shadow-xl backdrop-blur-xl dark:text-amber-100">
                    {storageViewportCoverageGapMessage(storageTerminalResponse)}
                  </div>
                </div>
              )}
              {(isStorageLoading || storageTerminalResponse?.stats) && (
                <div className="absolute top-[4.5rem] right-3 z-[999] pointer-events-none hidden sm:block">
                  <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-cyan-900 shadow-xl backdrop-blur-xl dark:text-cyan-100">
                    {isStorageLoading ? (
                      t('טוען מסופי אחסון / טנקים…', 'Loading storage / tank farms…')
                    ) : (
                      <>
                        {t('מסופי אחסון / טנקים', 'Storage / tank farms')}:{' '}
                        {storageTerminalResponse?.stats?.total ?? 0} {t('ברחבי העולם', 'worldwide')}
                        {storageInViewCount != null && (
                          <>
                            {' '}
                            · {storageInViewCount} {t('בתצוגה', 'in view')}
                          </>
                        )}{' '}
                        · {storageTerminalResponse?.stats?.with_operator ?? 0}{' '}
                        {t('עם מפעיל', 'with operator')}
                        {typeof storageTerminalResponse?.stats?.with_owner === 'number' && (
                          <>
                            {' '}
                            · {storageTerminalResponse.stats.with_owner} {t('עם בעלים', 'with owner')}
                          </>
                        )}
                        {typeof storageTerminalResponse?.stats?.by_source?.curated_reference === 'number' && (
                          <>
                            {' '}
                            · {storageTerminalResponse.stats.by_source.curated_reference}{' '}
                            {t('מקור מעובד', 'curated ref')}
                          </>
                        )}
                        <span className="mt-1 block font-semibold normal-case tracking-normal text-cyan-800/80 dark:text-cyan-200/80">
                          {t(
                            'OSM (Overpass) + מקור מעובד לעוגנים עולמיים — לא רשומות רישיון רשמיות. «בתצוגה» לפי גבולות המפה.',
                            'OSM (Overpass) + curated global hubs — not official licence registries. «In view» follows map bounds.',
                          )}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {viewMode === 'suppliers' &&
            !miningData.suppliersShowAll &&
            mapProcessedData.length === 0 &&
            !isLoading && (
              <div className="absolute inset-x-0 top-28 z-[998] mx-auto max-w-md pointer-events-none px-4">
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-[11px] font-semibold text-emerald-900 shadow-xl backdrop-blur-xl dark:text-emerald-100">
                  {t(
                    'סמן אות עסקה (ירוק) בדוסייה → סקירה כדי להוסיף ספקים. או הצג את כל הרישיונות לגילוי.',
                    'Mark Deal signal (green) on dossier Overview to add suppliers here. Or use Show all licenses for discovery.',
                  )}
                </div>
              </div>
            )}

          <div className="w-full h-full z-0">
            {(viewMode === 'global' ||
              viewMode === 'mining' ||
              viewMode === 'suppliers' ||
              viewMode === 'ports' ||
              viewMode === 'oil_and_gas' ||
              viewMode === 'route_planner') && (
              <Suspense fallback={<LazySurfaceFallback label={t('טוען מפה...', 'Loading map...')} />}>
                <MapComponent
                  processedData={viewMode === 'route_planner' ? [] : mapProcessedData}
                  allLicenses={viewMode === 'route_planner' ? [] : allLicenses}
                  userAnnotations={userAnnotations}
                  selectedItem={selectedItem}
                  mapFlyTrigger={mapFlyTrigger}
                  viewModeKey={viewMode}
                  worldCoverage={worldCoverage}
                  licensesFetchPending={
                    viewMode !== 'route_planner' &&
                    (viewMode === 'global' || viewMode === 'mining' || viewMode === 'oil_and_gas') &&
                    isLoading &&
                    rawData.length === 0 &&
                    !fetchError
                  }
                  licensesRefetching={false}
                  licensesSecondaryStatus={
                    viewMode === 'route_planner' ? null : licensesMapSecondaryStatus
                  }
                  setSelectedItem={handleSelectItem}
                  handleOpenDossier={handleOpenDossier}
                  mapCenter={mapCenter}
                  updateAnnotation={updateAnnotation}
                  deleteLicense={deleteLicense}
                  selectedMaritimeVessel={selectedMaritimeVessel}
                  onSelectMaritimeVessel={setSelectedMaritimeVessel}
                  maritimeMapViewActive={maritimeMapViewActive}
                  isMaritimeLayerEnabled={isMaritimeLayerEnabled}
                  onMaritimeLayerEnabledChange={setIsMaritimeLayerEnabled}
                  vesselFilters={vesselFilters}
                  onVesselFiltersChange={setVesselFilters}
                  maritimeMaxVessels={maritimeMaxVessels}
                  onMaritimeMaxVesselsChange={setMaritimeMaxVessels}
                  maritimeCaptureWindow={maritimeCaptureWindow}
                  onMaritimeCaptureWindowChange={setMaritimeCaptureWindow}
                  prioritizePetroleumVessels={prioritizePetroleumVessels}
                  onPrioritizePetroleumVesselsChange={setPrioritizePetroleumVessels}
                  routePlannerOverlay={routePlanner.overlay}
                  routePlannerPickRole={routePlanner.pickRole}
                  onRoutePlannerMapPick={routePlanner.handleMapPick}
                  routePlannerPorts={routePlannerPortMarkers}
                  routePlannerShowPorts={routePlanner.showPortsOnMap}
                  onRoutePlannerPortPick={handleRoutePlannerHubPick}
                  routePlannerAirports={routePlannerAirportMarkers}
                  routePlannerShowAirports={routePlanner.showAirportsOnMap}
                  onRoutePlannerAirportPick={handleRoutePlannerHubPick}
                  routePlannerFlyTrigger={routePlanner.mapFlyTrigger}
                  routePlannerFlyTarget={routePlanner.mapFlyTarget}
                  isInDdQueue={ddQueue.isInQueue}
                  onAddToDueDiligence={ddQueue.addToQueue}
                  onRemoveFromDueDiligence={ddQueue.removeFromQueue}
                  getDealRoomForLicense={getDealRoomForLicense}
                  countryFocusCountry={countryFocusCountry}
                  countryFocusBoundsTrigger={countryFocusBoundsTrigger}
                  onLicenseMapViewportChange={
                    licenseMapFetchEnabled
                      ? (bbox) =>
                          setLicenseMapViewport(
                            bbox ? normalizeLicenseViewportBounds(bbox) : null,
                          )
                      : undefined
                  }
                  onLicenseMapZoomChange={licenseMapFetchEnabled ? setLicenseMapZoom : undefined}
                  licenseMapZoom={licenseMapFetchEnabled ? licenseMapZoom : undefined}
                  onLicenseClusterDrillComplete={
                    licenseMapFetchEnabled ? handleLicenseClusterDrillComplete : undefined
                  }
                  storageEntities={viewMode === 'oil_and_gas' ? storageEntities : []}
                  onStorageInViewCountChange={
                    viewMode === 'oil_and_gas' ? setStorageInViewCount : undefined
                  }
                  onOilGasMapViewportChange={
                    viewMode === 'oil_and_gas'
                      ? (bbox) =>
                          setOilGasMapViewport(
                            bbox
                              ? {
                                  south: bbox.south,
                                  west: bbox.west,
                                  north: bbox.north,
                                  east: bbox.east,
                                }
                              : null,
                          )
                      : undefined
                  }
                  oilLiveOverlaysEnabled={isLiveDataSidebar}
                  oilLiveProductFilter={oilLiveProductFilter}
                  oilLiveTerminalSearch={oilLiveTerminalSearch}
                  oilLiveLens={oilLiveLens}
                  onOilLiveLensChange={isLiveDataSidebar ? handleOilLiveLensChange : undefined}
                  oilLiveLayers={oilLiveLayers}
                  onOilLiveLayersChange={isLiveDataSidebar ? setOilLiveLayers : undefined}
                  oilLiveTradeFlowGroup={oilLiveTradeFlowGroup}
                  onOilLiveTradeFlowGroupChange={
                    isLiveDataSidebar ? setOilLiveTradeFlowGroup : undefined
                  }
                  oilLiveCoverageStats={isLiveDataSidebar ? oilLiveCoverageStats : undefined}
                  onOilLiveStatsChange={isLiveDataSidebar ? setOilLiveCoverageStats : undefined}
                  onOilLiveEntityClick={isLiveDataSidebar ? handleOilLiveEntityClick : undefined}
                  onOilLiveDismiss={isLiveDataSidebar ? handleOilLiveDismiss : undefined}
                  onLiveDataMapFlyTo={isLiveDataSidebar ? handleLiveDataMapFlyTo : undefined}
                  liveDataFlyTrigger={isLiveDataSidebar ? liveDataFlyTrigger : 0}
                  liveDataFlyTarget={isLiveDataSidebar ? liveDataFlyTarget : null}
                  eiaHistoricMapEnabled={eiaHistoricMapEnabled}
                  eiaHistoricMapArcs={eiaHistoricMapArcs}
                  eiaHistoricMapOrigins={eiaHistoricMapOrigins}
                  eiaHistoricMapYear={eiaHistoricMapYear}
                  eiaHistoricShowCorridors={eiaHistoricShowCorridors}
                  onEiaHistoricSelectImporter={
                    isHistoricSidebar ? setHistoricImporterFromMap : undefined
                  }
                  onEiaHistoricViewArcDetails={(selection) => setSelectedHistoricArc(selection)}
                  liveDataEiaHistoricOn={isLiveDataSidebar ? liveDataEiaHistoricOn : false}
                  onLiveDataEiaHistoricChange={
                    isLiveDataSidebar ? setLiveDataEiaHistoricOn : undefined
                  }
                  hideLicenseMarkers={hideLicenseMarkersOnMap}
                  suppressLicenseClusters={licenseServerClustered}
                  macroTradeFlowsEnabled={isLiveDataSidebar && liveDataMacroTradeOn}
                  showInfrastructureLayers={
                    viewMode === 'mining' || viewMode === 'global' || viewMode === 'oil_and_gas'
                  }
                  infrastructureLayerVisibility={
                    viewMode === 'mining' || viewMode === 'global'
                      ? infrastructureLayerVisibility
                      : undefined
                  }
                  onInfrastructureLayerChange={
                    viewMode === 'mining' || viewMode === 'global'
                      ? handleInfrastructureLayerChange
                      : undefined
                  }
                  infrastructureForcedLayers={
                    viewMode === 'mining' || viewMode === 'global'
                      ? infrastructureForcedLayers
                      : undefined
                  }
                  infrastructureMapZoom={
                    viewMode === 'mining' || viewMode === 'global' ? licenseMapZoom : undefined
                  }
                  infrastructureMapBbox={
                    viewMode === 'mining' || viewMode === 'global' ? licenseMapViewport : undefined
                  }
                  infrastructurePanelHint={
                    viewMode === 'mining' || viewMode === 'global' ? infrastructurePanelHint : undefined
                  }
                  onInfrastructureFeatureClick={
                    viewMode === 'mining' || viewMode === 'global'
                      ? setSelectedInfrastructureFeature
                      : undefined
                  }
                  macroTradeFlows={macroTradeFlows}
                  liveDataMacroTradeOn={isLiveDataSidebar ? liveDataMacroTradeOn : undefined}
                  onLiveDataMacroTradeChange={
                    isLiveDataSidebar ? setLiveDataMacroTradeOn : undefined
                  }
                  oilLiveSidebarActive={isLiveDataSidebar}
                />
              </Suspense>
            )}
            {viewMode === 'route_planner' && (
              <div className="pointer-events-none absolute inset-x-2 bottom-3 top-24 z-[1100] flex justify-end sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-24">
                <div className="pointer-events-auto flex max-h-full min-h-0 w-full flex-col sm:w-[min(560px,calc(100vw-6rem))]">
                  <Suspense fallback={<LazySurfaceFallback label={t('טוען חדר עסקאות...', 'Loading deal cockpit...')} />}>
                    <RoutePlannerPanel
                      rp={routePlanner}
                      portEntities={portEntities}
                    />
                  </Suspense>
                </div>
              </div>
            )}
            {maritimeMapViewActive && selectedMaritimeVessel && !isDossierOpen && (
              <div className="absolute top-20 left-4 z-[1100] pointer-events-auto">
                <OilMaritimePanel
                  key={selectedMaritimeVessel.id || String(selectedMaritimeVessel.mmsi)}
                  vessel={selectedMaritimeVessel}
                  onClose={() => setSelectedMaritimeVessel(null)}
                  onSelectVessel={async (pick) => {
                    const resolved = await resolveFleetVesselSelection(pick);
                    if (!resolved) {
                      throw new Error('Vessel not found in live feed or registry lookup.');
                    }
                    setSelectedMaritimeVessel(resolved);
                    return resolved;
                  }}
                />
              </div>
            )}
            {(viewMode === 'mining' || viewMode === 'global') &&
              selectedInfrastructureFeature &&
              !isDossierOpen && (
              <div className="pointer-events-none absolute inset-x-2 bottom-3 top-24 z-[1150] flex justify-start sm:inset-x-auto sm:left-4 sm:bottom-4 sm:top-24 sm:right-auto">
                <div className="pointer-events-auto flex max-h-full min-h-0 w-full flex-col">
                  <Suspense
                    fallback={
                      <LazySurfaceFallback label={t('טוען תשתית…', 'Loading infrastructure…')} />
                    }
                  >
                    <InfrastructureFeatureDrawer
                      selection={selectedInfrastructureFeature}
                      onClose={() => setSelectedInfrastructureFeature(null)}
                    />
                  </Suspense>
                </div>
              </div>
            )}
            {eiaHistoricMapEnabled && selectedHistoricArc && !isDossierOpen && (
              <div className="pointer-events-none absolute inset-x-2 bottom-3 top-24 z-[1150] flex justify-end sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-24">
                <div className="pointer-events-auto flex max-h-full min-h-0 w-full flex-col sm:w-[min(400px,calc(100vw-2rem))]">
                  <Suspense fallback={<LazySurfaceFallback label={t('טוען קשת…', 'Loading arc…')} />}>
                    <HistoricArcDetailDrawer
                      selection={selectedHistoricArc}
                      onClose={() => setSelectedHistoricArc(null)}
                    />
                  </Suspense>
                </div>
              </div>
            )}
            {isLiveDataSidebar && oilLiveEntity && !isDossierOpen && !selectedHistoricArc && (
              <div className="pointer-events-none absolute inset-x-2 bottom-3 top-24 z-[1150] flex justify-start sm:inset-x-auto sm:left-4 sm:bottom-4 sm:top-24 sm:right-auto">
                <div className="pointer-events-auto flex max-h-full min-h-0 w-full flex-col sm:w-[min(400px,calc(100vw-2rem))]">
                  <Suspense fallback={<LazySurfaceFallback label={t('טוען ישות…', 'Loading entity…')} />}>
                    <OilLiveEntityDrawer
                      entityKind={oilLiveEntity.entityKind}
                      entityId={oilLiveEntity.entityId}
                      opportunityId={oilLiveEntity.opportunityId}
                      title={oilLiveEntity.title}
                      subtitle={oilLiveEntity.subtitle}
                      initialDrawerTab={oilLiveEntity.initialDrawerTab}
                      onClose={handleOilLiveDismiss}
                      onOpenRoutePlanner={handleOpenRoutePlannerFromLiveData}
                      onOpenCompanyDossier={handleOpenOilLiveCompanyDossier}
                      onCreateDealRoom={
                        oilLiveEntity.entityKind === 'opportunity'
                          ? handleCreateDealRoomFromOpportunity
                          : undefined
                      }
                      onHighlightOnMap={(_selection) => {
                        // Keep the drawer open so the user can cross-reference
                        // the newly visible trade-flow arcs with the I/E table
                        // they were just inspecting; closing would feel like
                        // losing context.
                        setOilLiveLayers((prev) => ({ ...prev, tradeFlows: true }));
                        setOilLiveTradeFlowGroup('company_pair');
                        // TODO: no corridor-specific fly-to helper exists yet —
                        // once liveDataMapDefaults exposes one, use
                        // _selection.corridor (load/discharge) to zoom.
                      }}
                      onOpenCargo={(cargoId) => {
                        setOilLiveEntity({
                          entityKind: 'cargo',
                          entityId: cargoId,
                        });
                      }}
                    />
                  </Suspense>
                </div>
              </div>
            )}
            {viewMode === 'investigations' && (
              <Suspense fallback={<LazySurfaceFallback label={t('טוען חקירות...', 'Loading investigations...')} />}>
                <InvestigationsPanel
                  subTab={investigationsSubTab}
                  onSubTabChange={setInvestigationsSubTab}
                  allLicenses={allLicenses}
                  queue={ddQueue.queue}
                  queueIds={ddQueue.queueIds}
                  notesById={ddQueue.notesById}
                  userAnnotations={userAnnotations}
                  updateAnnotation={updateAnnotation}
                  updateNote={ddQueue.updateNote}
                  onRemoveFromQueue={ddQueue.removeFromQueue}
                  onCardClick={handleOpenDossier}
                  onOpenMap={() => setViewMode('global')}
                  isMobile={isMobile}
                  dealRooms={dealRooms.rooms}
                  dealRoomsLoading={dealRooms.isLoading}
                  highlightedDealRoomId={highlightedDealRoomId}
                  onHighlightedDealRoomConsumed={() => setHighlightedDealRoomId(null)}
                  onDealRoomChange={dealRooms.upsertDealRoom}
                  onRefreshDealRooms={() => void dealRooms.refreshDealRooms()}
                  euProcurementCpvBucket={euProcurementCpvBucket}
                  adminToken={
                    (import.meta.env.VITE_ADMIN_API_TOKEN as string | undefined) ||
                    sessionStorage.getItem('meridian_admin_api_token') ||
                    undefined
                  }
                />
              </Suspense>
            )}
            {viewMode === 'admin' && (
              <div className="h-full bg-white dark:bg-slate-950">
                <Suspense fallback={<LazySurfaceFallback label={t('טוען ניהול...', 'Loading admin...')} />}>
                  <AdminPanel
                    isOpen={true}
                    onClose={() => setViewMode('global')}
                    token={token || undefined}
                    isFullPage={true}
                    currentUserId={userId}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </main>

        {/* PANEL 3: Right Tactical Filter Hub */}
        {isAdminPanelOpen && (
          <Suspense fallback={null}>
            <AdminPanel
              isOpen={isAdminPanelOpen}
              onClose={() => setIsAdminPanelOpen(false)}
              token={token || undefined}
              currentUserId={userId}
            />
          </Suspense>
        )}
        <FilterPanel 
          isOpen={isFilterOpen}
          onClose={() => setIsFilterOpen(false)}
          selectedCommodity={miningData.selectedCommodity}
          setSelectedCommodity={miningData.setSelectedCommodity}
          selectedCountry={miningData.selectedCountry}
          setSelectedCountry={miningData.setSelectedCountry}
          userStatusFilter={miningData.userStatusFilter}
          setUserStatusFilter={miningData.setUserStatusFilter}
          selectedLicenseType={miningData.selectedLicenseType}
          setSelectedLicenseType={miningData.setSelectedLicenseType}
          selectedEntitySubtype={miningData.selectedEntitySubtype}
          setSelectedEntitySubtype={miningData.setSelectedEntitySubtype}
          selectedSourceLabel={miningData.selectedSourceLabel}
          setSelectedSourceLabel={miningData.setSelectedSourceLabel}
          selectedConfidenceBucket={miningData.selectedConfidenceBucket}
          setSelectedConfidenceBucket={miningData.setSelectedConfidenceBucket}
          portLinkedOnly={miningData.portLinkedOnly}
          setPortLinkedOnly={miningData.setPortLinkedOnly}
          commodities={miningData.commodities}
          countries={miningData.countries}
          licenseTypes={miningData.licenseTypes}
          entitySubtypes={miningData.entitySubtypes}
          sourceLabels={miningData.sourceLabels}
          maritimeSection={
            maritimeMapViewActive
              ? {
                  layerEnabled: isMaritimeLayerEnabled,
                  onLayerEnabledChange: setIsMaritimeLayerEnabled,
                  vesselFilters,
                  onVesselFiltersChange: setVesselFilters,
                  prioritizePetroleum: prioritizePetroleumVessels,
                  onPrioritizePetroleumChange: setPrioritizePetroleumVessels,
                  showPetroleumPriority: viewMode === 'oil_and_gas',
                }
              : undefined
          }
        />

        {/* FULL-SCREEN OVERLAY: Intelligence Dossier */}
        {isDossierOpen && (
          <Suspense fallback={null}>
            <DossierView
              isOpen={isDossierOpen}
              onClose={() => setIsDossierOpen(false)}
              item={dossierItem}
              marketPrices={marketPrices}
              annotation={dossierItem ? userAnnotations[dossierItem.id] || {} : {}}
              updateAnnotation={updateAnnotation}
              onDeleteLicense={
                dossierItem && dossierItem.entityKind !== 'storage_terminal'
                  ? () => deleteLicense(dossierItem.id)
                  : undefined
              }
              isInDdQueue={dossierItem ? ddQueue.isInQueue(dossierItem.id) : false}
              onAddToDueDiligence={
                dossierItem ? () => ddQueue.addToQueue(dossierItem.id) : undefined
              }
              onRemoveFromDueDiligence={
                dossierItem ? () => ddQueue.removeFromQueue(dossierItem.id) : undefined
              }
              onPlanRoute={(licenseItem) => {
                routePlanner.prefillSupplier(
                  licenseItem.lat ?? 0,
                  licenseItem.lng ?? 0,
                  `${licenseItem.company}${licenseItem.region ? ` — ${licenseItem.region}` : ''}`,
                  {
                    country: licenseItem.country,
                    licenseId: licenseItem.id,
                    commodity: licenseItem.commodity,
                    sector: licenseItem.sector,
                  },
                );
                setIsDossierOpen(false);
                setViewMode('route_planner');
              }}
              linkedDealRoom={
                dossierItem
                  ? getDealRoomForLicense(dossierItem.id, dossierItem.entityKind || 'license')
                  : undefined
              }
              onNavigateToDealRoom={handleNavigateToDealRoom}
              onNavigateToEuProcurement={handleNavigateToEuProcurement}
              onOpenInvestigations={handleOpenInvestigations}
              onDealRoomLinked={dealRooms.upsertDealRoom}
            />
          </Suspense>
        )}

        <BulkImportLicensesModal
          isOpen={isBulkImportOpen}
          onClose={() => setIsBulkImportOpen(false)}
          onSuccess={(n) => {
            queryClient.invalidateQueries({ queryKey: ['licenses'] });
            toast.success(t('ייבוא הצליח', 'Import successful'), {
              description: `${n} ${t('רישיונות יובאו', 'licenses imported')}`,
            });
            if (userId && username) {
              logActivityMutation.mutate({
                user_id: userId,
                username,
                action: 'IMPORT',
                details: `Bulk CSV import: ${n} licenses`,
              });
            }
          }}
        />
        <AddLicenseModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSubmit={(formData) => {
            const newLicense = {
              ...formData,
              id: `local-${Date.now()}`,
              date: new Date().toISOString().split('T')[0],
              status: formData.status || 'Operating',
            };
            setLocalLicenses(prev => [...prev, newLicense]);
            setIsAddModalOpen(false);
          }}
        />
      </div>

      {/* Mobile Bottom Nav — part of the flex-col layout so it shrinks the content above it */}
      <nav className="md:hidden h-16 bg-stone-50/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-stone-200/90 dark:border-white/10 flex items-center justify-start gap-1 overflow-x-auto z-50 shrink-0 px-1">
        <button
          onClick={() => switchSectorView('global')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'global' ? 'text-amber-500' : 'text-slate-600 dark:text-slate-500'}`}
        >
          <LucideMapPin className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("עולמי", "Global")}</span>
        </button>
        <button
          onClick={() => switchSectorView('mining')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'mining' ? 'text-amber-500' : 'text-slate-600 dark:text-slate-500'}`}
        >
          <LucideLayoutGrid className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("כרייה", "Mining")}</span>
        </button>
        <button
          onClick={() => switchSectorView('oil_and_gas')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'oil_and_gas' ? 'text-amber-500' : 'text-slate-600 dark:text-slate-500'}`}
        >
          <LucideDroplets className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("נפט וגז", "Oil & Gas")}</span>
        </button>
        <button
          onClick={() => setViewMode('route_planner')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors shrink-0 ${viewMode === 'route_planner' ? 'text-amber-500' : 'text-slate-600 dark:text-slate-500'}`}
        >
          <LucideNavigation className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("מסלול", "Route")}</span>
        </button>
        <button
          onClick={() => setViewMode('investigations')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'investigations' ? 'text-amber-500' : 'text-slate-600 dark:text-slate-500'}`}
        >
          <LucidePieChart className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t('חקירות', 'Investigate')}</span>
        </button>
        <button
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${isFilterOpen ? 'text-amber-500' : 'text-slate-600 dark:text-slate-500'}`}
        >
          <LucideFilter className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("סינון", "Filter")}</span>
        </button>
        <button
          onClick={handleLogout}
          className="flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 text-slate-400 dark:text-slate-500 hover:text-red-400 transition-colors"
        >
          <LucideLogOut className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("יציאה", "Logout")}</span>
        </button>
      </nav>
    </div>
  );
}
