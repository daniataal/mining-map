import { useState, useMemo, useEffect, useCallback, useRef, startTransition, lazy, Suspense, type KeyboardEvent } from 'react';
import { useLicenses, useUpdateLicense, useDeleteLicense, useLogActivity, login, API_BASE, describeLicenseFetchFailureContext, useWorldCoverage, useStorageTerminals, usePortLogisticsEntities } from './lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useMiningData } from './hooks/use-mining-data';
import { useI18n } from './lib/i18n';
import { MiningLicense, UserAnnotation, MaritimeVessel, MarketTickerRow } from './types';
import { toast } from "sonner";

import Sidebar from './components/Sidebar';
import AddLicenseModal from './components/AddLicenseModal';
import BulkImportLicensesModal from './components/BulkImportLicensesModal';
import { useDueDiligenceQueue } from './hooks/use-due-diligence-queue';
import AuthOverlay from './components/AuthOverlay';
import FilterPanel from './components/FilterPanel';
import OilMaritimePanel from './components/OilMaritimePanel';
import {
  DEFAULT_VESSEL_FILTERS,
  prefetchMaritimeVesselSnapshot,
  readMaritimeIncludeCoastalDemoPreference,
  type VesselFilters,
} from './lib/vessels';
import {
  matchExactCountryFocusQuery,
  resolveCountryFocusToken,
  suggestCountriesForFocus,
  tryParseCountryColonQuery,
} from './lib/countryFocusMatch';
import { useRoutePlanner } from './features/route-planner';
import {
  buildRoutePlannerAirportMarkers,
  buildRoutePlannerPortMarkers,
  resolveRouteHubCountries,
} from './features/route-planner/locationPresets';
import {
  Search as LucideSearch,
  Filter as LucideFilter,
  MapPin as LucideMapPin,
  LayoutGrid as LucideLayoutGrid,
  PieChart as LucidePieChart,
  LogOut as LucideLogOut,
  Anchor as LucideAnchor,
  Droplets as LucideDroplets,
  Navigation2 as LucideNavigation,
  X as LucideX,
} from 'lucide-react';
import ThemeToggle from './components/ThemeToggle';

import 'leaflet/dist/leaflet.css';
import './App.css';

const MapComponent = lazy(() => import('./components/MapComponent'));
const DossierView = lazy(() => import('./components/DossierView'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const DueDiligencePanel = lazy(() => import('./components/DueDiligencePanel'));
const RoutePlannerPanel = lazy(() => import('./features/route-planner/RoutePlannerPanel'));

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
    <div className="flex h-full w-full items-center justify-center bg-white/70 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">
      {label}
    </div>
  );
}

export default function App() {
  const { t, isRtl } = useI18n();
  const routePlanner = useRoutePlanner();
  const ddQueue = useDueDiligenceQueue();
  const [viewMode, setViewMode] = useState<
    'global' | 'mining' | 'oil_and_gas' | 'suppliers' | 'ports' | 'due_diligence' | 'raw_evidence' | 'route_planner' | 'admin'
  >('global');
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
  const { data: worldCoverage } = useWorldCoverage(true);
  const {
    data: rawData = [],
    isLoading,
    isFetching,
    error: fetchError,
  } = useLicenses(licenseSector);
  const licensesMapSecondaryStatus = useMemo(() => {
    if (!isFetching || isLoading || rawData.length === 0) return null;
    return t('מרענן מאגר רישיונות…', 'Refreshing license bundle…');
  }, [isFetching, isLoading, rawData.length, t]);
  const {
    data: storageTerminalResponse,
    isLoading: isStorageLoading,
    error: storageError,
  } = useStorageTerminals(viewMode === 'oil_and_gas');
  const {
    data: portLogisticsResponse,
    isLoading: isPortsLoading,
    error: portsError,
  } = usePortLogisticsEntities(viewMode === 'ports' || viewMode === 'route_planner');
  const updateLicenseMutation = useUpdateLicense();
  const deleteLicenseMutation = useDeleteLicense();
  const logActivityMutation = useLogActivity();

  // Auth State
  const [token, setToken] = useState<string | null>(localStorage.getItem('mining_token'));
  const [username, setUsername] = useState<string | null>(localStorage.getItem('mining_username'));
  const [userId, setUserId] = useState<string | null>(localStorage.getItem('mining_userid'));
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);

  // UI State
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isSidebarPinned, setIsSidebarPinned] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [selectedItem, setSelectedItem] = useState<MiningLicense | null>(null);
  const [selectedMaritimeVessel, setSelectedMaritimeVessel] = useState<MaritimeVessel | null>(null);
  const [isMaritimeLayerEnabled, setIsMaritimeLayerEnabled] = useState(false);
  const [vesselFilters, setVesselFilters] = useState<VesselFilters>(DEFAULT_VESSEL_FILTERS);
  const [maritimeMaxVessels, setMaritimeMaxVessels] = useState('15000');
  const [maritimeCaptureWindow, setMaritimeCaptureWindow] = useState('25');
  const [prioritizePetroleumVessels, setPrioritizePetroleumVessels] = useState(false);
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [dossierItem, setDossierItem] = useState<MiningLicense | null>(null);
  const [mapFlyTrigger, setMapFlyTrigger] = useState(0);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);

  // User Annotations (Local storage for now, ideally backend)
  const [userAnnotations, setUserAnnotations] = useState<Record<string, UserAnnotation>>(() => {
    try {
      const saved = localStorage.getItem('mining_user_data');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
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
  const portEntities = portLogisticsResponse?.entities || [];
  const allLicenses = useMemo(
    () => {
      if (viewMode === 'ports') {
        return portEntities;
      }
      return [
        ...rawData,
        ...visibleLocalLicenses,
        ...(viewMode === 'oil_and_gas' ? storageEntities : []),
      ];
    },
    [rawData, visibleLocalLicenses, viewMode, storageEntities, portEntities]
  );
  const routePlannerLicensePool = useMemo(() => {
    const merged = [...rawData, ...localLicenses, ...portEntities, ...storageEntities];
    const seen = new Set<string>();
    return merged.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [rawData, localLicenses, portEntities, storageEntities]);

  const routeHubCountries = useMemo(
    () => resolveRouteHubCountries(routePlanner.supplier.country, routePlanner.buyer.country),
    [routePlanner.supplier.country, routePlanner.buyer.country],
  );

  const routePlannerPortMarkers = useMemo(
    () =>
      buildRoutePlannerPortMarkers(routePlannerLicensePool, portEntities, {
        countries: routeHubCountries,
      }),
    [routePlannerLicensePool, portEntities, routeHubCountries],
  );

  const routePlannerAirportMarkers = useMemo(
    () => buildRoutePlannerAirportMarkers({ countries: routeHubCountries }),
    [routeHubCountries],
  );

  const handleRoutePlannerHubPick = useCallback(
    (hub: { lat: number; lng: number; name: string; country?: string }, role: 'supplier' | 'buyer') => {
      routePlanner.handleMapPick(hub.lat, hub.lng, role, hub.name, hub.country);
    },
    [routePlanner],
  );

  const entityIndex = useMemo(
    () => Object.fromEntries(allLicenses.map((item) => [item.id, item])),
    [allLicenses]
  );

  // Filtering Hook
  const miningData = useMiningData(allLicenses, userAnnotations);

  const selectedCountryBeforeFocusRef = useRef<string[]>([]);
  const selectedCountryLiveRef = useRef<string[]>([]);
  useEffect(() => {
    selectedCountryLiveRef.current = miningData.selectedCountry;
  }, [miningData.selectedCountry]);

  const [countryFocusCountry, setCountryFocusCountry] = useState<string | null>(null);
  const [countryFocusBoundsTrigger, setCountryFocusBoundsTrigger] = useState(0);
  const [autoFocusCountryOnEnter, setAutoFocusCountryOnEnter] = useState(false);

  const applyCountryFocus = useCallback(
    (name: string) => {
      setCountryFocusCountry((cur) => {
        if (cur == null) {
          selectedCountryBeforeFocusRef.current = selectedCountryLiveRef.current.slice();
        }
        return name;
      });
      miningData.setSelectedCountry([name]);
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

  const countryFocusSuggestions = useMemo(
    () =>
      countryFocusCountry || miningData.filter.trim().length < 2
        ? []
        : suggestCountriesForFocus(miningData.filter, miningData.countries, 8),
    [miningData.filter, miningData.countries, countryFocusCountry],
  );

  const handleIntelligenceSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return;
      const raw = miningData.filter;
      const colon = tryParseCountryColonQuery(raw);
      if (colon) {
        const name = resolveCountryFocusToken(colon, miningData.countries);
        if (name) {
          e.preventDefault();
          applyCountryFocus(name);
        }
        return;
      }
      if (autoFocusCountryOnEnter) {
        const exact = matchExactCountryFocusQuery(raw, miningData.countries);
        if (exact) {
          e.preventDefault();
          applyCountryFocus(exact);
        }
      }
    },
    [miningData.filter, miningData.countries, autoFocusCountryOnEnter, applyCountryFocus],
  );

  useEffect(() => {
    if (!countryFocusCountry) return;
    const sel = miningData.selectedCountry;
    if (sel.length !== 1 || sel[0] !== countryFocusCountry) {
      setCountryFocusCountry(null);
    }
  }, [miningData.selectedCountry, countryFocusCountry]);

  useEffect(() => {
    if (viewMode === 'mining' || viewMode === 'oil_and_gas') {
      miningData.setSelectedSector(viewMode);
    } else {
      miningData.setSelectedSector(null);
    }
  }, [viewMode, miningData.setSelectedSector]);

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

  const handleSelectItem = useCallback((item: MiningLicense | null) => {
    setSelectedMaritimeVessel(null);
    setSelectedItem(item);
  }, []);

  const updateAnnotation = useCallback((id: string, updates: Partial<UserAnnotation>) => {
    setUserAnnotations(prev => {
      const next = { ...prev, [id]: { ...(prev[id] || {}), ...updates } };
      localStorage.setItem('mining_user_data', JSON.stringify(next));
      return next;
    });

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
  }, [updateLicenseMutation, entityIndex]);

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

  const mapCenter: [number, number] = viewMode === 'ports' ? [20, 0] : [7.9465, -1.0232];
  
  // Market Prices State
  const [marketPrices, setMarketPrices] = useState<MarketTickerRow[]>([]);
  const sectorCoverageSummary =
    licenseSector ? (worldCoverage?.summary?.[licenseSector] ?? null) : null;
  const sidebarViewMode =
    viewMode === 'admin'
      ? 'admin'
      : viewMode === 'due_diligence'
        ? 'dashboard'
        : viewMode === 'raw_evidence'
          ? 'pipeline'
          : 'map';
  const handleSidebarViewModeChange = (mode: 'map' | 'pipeline' | 'admin' | 'dashboard') => {
    if (mode === 'admin') {
      setViewMode('admin');
      return;
    }
    if (mode === 'dashboard') {
      setViewMode('due_diligence');
      return;
    }
    if (mode === 'pipeline') {
      setViewMode('raw_evidence');
      return;
    }
    setViewMode('global');
  };

  const switchSectorView = useCallback((mode: 'global' | 'mining' | 'oil_and_gas') => {
    startTransition(() => setViewMode(mode));
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
    if (viewMode === 'oil_and_gas') {
      setPrioritizePetroleumVessels(true);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!maritimeMapViewActive) {
      setIsMaritimeLayerEnabled(false);
      setSelectedMaritimeVessel(null);
    }
  }, [maritimeMapViewActive]);

  useEffect(() => {
    if (!username || !maritimeMapViewActive) return;
    const scope = viewMode === 'oil_and_gas' ? ('oil_tankers' as const) : ('all_vessels' as const);
    void prefetchMaritimeVesselSnapshot(queryClient, {
      maxVessels: Number(maritimeMaxVessels) || 15000,
      captureWindowSeconds: Number(maritimeCaptureWindow) || 25,
      scope,
      includeCoastalDemo: readMaritimeIncludeCoastalDemoPreference(),
    });
  }, [username, maritimeMapViewActive, viewMode, queryClient, maritimeMaxVessels, maritimeCaptureWindow]);

  return (
    <div className={`h-screen w-screen flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans ${isRtl ? 'rtl' : 'ltr'}`}>
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
          className={`hidden min-h-0 md:flex md:flex-col md:h-full transition-all duration-500 ease-[0.23,1,0.32,1] z-40 border-r border-black/5 dark:border-white/5 bg-white/40 dark:bg-slate-950/40 backdrop-blur-3xl shadow-2xl relative
          ${isSidebarCollapsed && !isSidebarPinned ? 'w-16' : 'w-96'}`}
          onMouseEnter={() => !isSidebarPinned && setIsSidebarCollapsed(false)}
          onMouseLeave={() => !isSidebarPinned && setIsSidebarCollapsed(true)}
        >
          <Sidebar
            processedData={miningData.processedData}
            setIsAddModalOpen={setIsAddModalOpen}
            onOpenBulkImport={() => setIsBulkImportOpen(true)}
            loading={
              viewMode === 'ports'
                ? isPortsLoading
                : Boolean(
                    isLoading ||
                      (isFetching &&
                        !isLoading &&
                        (viewMode === 'mining' || viewMode === 'oil_and_gas')) ||
                      (viewMode === 'oil_and_gas' && isStorageLoading),
                  )
            }
            onLogout={handleLogout}
            userAnnotations={userAnnotations}
            selectedItem={selectedItem}
            setSelectedItem={(item: MiningLicense) => {
              handleSelectItem(item);
              setMapFlyTrigger(prev => prev + 1);
            }}
            viewMode={sidebarViewMode}
            setViewMode={handleSidebarViewModeChange}
            onToggleFilter={() => setIsFilterOpen(!isFilterOpen)}
            onToggleAdmin={() => setViewMode('admin')}
            isFilterOpen={isFilterOpen}
            isPinned={isSidebarPinned}
            setIsPinned={setIsSidebarPinned}
            isCollapsed={isSidebarCollapsed && !isSidebarPinned}
            infrastructureStats={
              viewMode === 'oil_and_gas' || viewMode === 'ports'
                ? miningData.infrastructureStats
                : undefined
            }
            isInDdQueue={ddQueue.isInQueue}
            onAddToDueDiligence={ddQueue.addToQueue}
            onRemoveFromDueDiligence={ddQueue.removeFromQueue}
          />
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
            viewMode === 'due_diligence' ||
            viewMode === 'raw_evidence' ||
            viewMode === 'route_planner') && (
            <div className="absolute top-4 left-3 right-3 sm:left-6 sm:right-6 z-[1000] flex justify-end sm:justify-between items-center pointer-events-none">
              {/* Search bar — hidden on mobile, shown on sm+ */}
              <div className="hidden sm:flex items-start gap-3 pointer-events-auto flex-wrap">
                  <div className="relative w-80 shrink-0">
                    <div className="flex items-center bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl border border-black/10 dark:border-white/10 rounded-2xl px-4 h-12 shadow-2xl">
                      <LucideSearch className="w-5 h-5 shrink-0 text-slate-400 dark:text-slate-500 mr-3" />
                      <input
                        type="text"
                        placeholder={t(
                          'חפש מודיעין… נסה גם country:UAE',
                          'Search intelligence hub… try country:UAE',
                        )}
                        className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 dark:text-slate-200 w-full min-w-0 placeholder:text-slate-400 dark:placeholder:text-slate-600 tracking-tight"
                        value={miningData.filter}
                        onChange={(e) => miningData.setFilter(e.target.value)}
                        onKeyDown={handleIntelligenceSearchKeyDown}
                        aria-autocomplete="list"
                        aria-expanded={countryFocusSuggestions.length > 0 && !countryFocusCountry}
                      />
                    </div>
                    {countryFocusSuggestions.length > 0 && !countryFocusCountry && (
                      <ul
                        className="absolute left-0 right-0 top-[calc(100%+4px)] z-[1200] max-h-56 overflow-y-auto rounded-xl border border-black/10 bg-white/95 py-1 text-left shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95"
                        role="listbox"
                      >
                        {countryFocusSuggestions.map((name) => (
                          <li key={name}>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-slate-800 hover:bg-amber-500/15 dark:text-slate-100 dark:hover:bg-amber-500/20"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => applyCountryFocus(name)}
                            >
                              <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                                {t('מיקוד', 'Focus')}
                              </span>
                              <span>{name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <label className="mt-1.5 flex cursor-pointer items-center gap-2 px-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                        checked={autoFocusCountryOnEnter}
                        onChange={(e) => setAutoFocusCountryOnEnter(e.target.checked)}
                      />
                      {t(
                        'מיקוד מפה במדינה בלחיצת Enter כשהשם תואם',
                        'Focus map on country with Enter when the name matches exactly',
                      )}
                    </label>
                  </div>
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
                  {sectorCoverageSummary && viewMode !== 'route_planner' && (
                    <div className="hidden lg:flex items-center px-3 h-10 rounded-2xl bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl border border-black/10 dark:border-white/10 shadow-2xl text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">
                      {t("כיסוי עולמי", "World coverage")}: {sectorCoverageSummary.official_syncable || 0} {t("רשמי פתוח", "official live")} · {sectorCoverageSummary.global_fallback_only || 0} {t("גיבוי גלובלי", "global fallback")} · {((sectorCoverageSummary.official_api_restricted || 0) + (sectorCoverageSummary.official_portal_only || 0) + (sectorCoverageSummary.decommissioned || 0))} {t("רשמי חלקי", "official partial")} · {sectorCoverageSummary.fallback_imported || 0} {t("גיבוי CSV", "CSV fallback")} · {(sectorCoverageSummary.countries_with_global_fallback || 0)} {t("עם שכבת גיבוי", "with fallback layer")}
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
                  <div className="flex gap-0.5 sm:gap-1.5 bg-white/60 sm:bg-white/40 dark:bg-slate-950/60 dark:sm:bg-slate-950/40 backdrop-blur-2xl p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border border-black/10 sm:border-black/5 dark:border-white/10 dark:sm:border-white/5 shadow-2xl">
                    <button
                      onClick={() => switchSectorView('global')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'global' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      {t("עולמי", "Global")}
                    </button>
                    <button
                      onClick={() => switchSectorView('mining')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'mining' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      {t("כרייה", "Mining")}
                    </button>
                    <button
                      onClick={() => switchSectorView('oil_and_gas')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${viewMode === 'oil_and_gas' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      <LucideDroplets className="w-3.5 h-3.5" />
                      {t("נפט וגז", "Oil & Gas")}
                    </button>
                    <button
                      onClick={() => setViewMode('suppliers')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'suppliers' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      {t("ספקים", "Suppliers")}
                    </button>
                    <button
                      onClick={() => setViewMode('ports')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'ports' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      {t("נמלים", "Ports")}
                    </button>
                    <button
                      onClick={() => setViewMode('route_planner')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${viewMode === 'route_planner' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      <LucideNavigation className="w-3.5 h-3.5" aria-hidden />
                      {t('מסלול', 'Route')}
                    </button>
                    <button
                      onClick={() => setViewMode('due_diligence')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'due_diligence' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      {t("בדיקת נאותות", "Due Diligence")}
                      {ddQueue.queue.length > 0 && (
                        <span className="ml-1.5 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-slate-950/20 dark:bg-white/20 text-[9px] font-black px-1">
                          {ddQueue.queue.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setViewMode('raw_evidence')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'raw_evidence' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      {t("ראיות גולמיות", "Raw Evidence")}
                    </button>
                  </div>

                  {/* Filter button — hidden on mobile (available in bottom nav) */}
                  <ThemeToggle className="hidden sm:flex" />
                  <button
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    className={`hidden sm:flex p-3 rounded-2xl border transition-all active:scale-95 shadow-2xl backdrop-blur-2xl ${isFilterOpen ? 'bg-amber-500 border-amber-500 text-slate-950' : 'bg-white/60 dark:bg-slate-950/60 border-black/10 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    <LucideFilter className="w-5 h-5" />
                  </button>
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
                  processedData={viewMode === 'route_planner' ? [] : miningData.processedData}
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
                    !fetchError
                  }
                  licensesRefetching={
                    viewMode !== 'route_planner' &&
                    (viewMode === 'mining' || viewMode === 'oil_and_gas') &&
                    isFetching &&
                    !isLoading &&
                    !fetchError
                  }
                  licensesSecondaryStatus={viewMode === 'route_planner' ? null : licensesMapSecondaryStatus}
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
                  countryFocusCountry={countryFocusCountry}
                  countryFocusBoundsTrigger={countryFocusBoundsTrigger}
                />
              </Suspense>
            )}
            {viewMode === 'route_planner' && (
              <div className="pointer-events-none absolute inset-x-2 bottom-3 top-24 z-[1100] flex justify-end sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-24">
                <div className="pointer-events-auto w-full sm:w-[min(560px,calc(100vw-6rem))]">
                  <Suspense fallback={<LazySurfaceFallback label={t('טוען חדר עסקאות...', 'Loading deal cockpit...')} />}>
                    <RoutePlannerPanel
                      rp={routePlanner}
                      allLicenses={routePlannerLicensePool}
                      portEntities={portEntities}
                    />
                  </Suspense>
                </div>
              </div>
            )}
            {maritimeMapViewActive && selectedMaritimeVessel && !isDossierOpen && (
              <div className="absolute top-20 left-4 z-[1100] pointer-events-auto">
                <OilMaritimePanel vessel={selectedMaritimeVessel} onClose={() => setSelectedMaritimeVessel(null)} />
              </div>
            )}
            {viewMode === 'due_diligence' && (
              <Suspense fallback={<LazySurfaceFallback label={t('טוען בדיקת נאותות...', 'Loading due diligence...')} />}>
                <DueDiligencePanel
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
                />
              </Suspense>
            )}
            {viewMode === 'raw_evidence' && (
              <div className="pt-20 sm:pt-24 h-full bg-white dark:bg-slate-950 overflow-hidden">
                <div className="p-4 overflow-y-auto h-full text-sm font-mono text-slate-800 dark:text-slate-200">
                  <h2 className="text-xl mb-4 font-sans font-bold">Raw Evidence Viewer</h2>
                  <p className="text-slate-500 mb-4 font-sans">Select an entity on the map to see its raw evidence JSON payloads.</p>
                </div>
              </div>
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
      <nav className="md:hidden h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-black/10 dark:border-white/10 flex items-center justify-start gap-1 overflow-x-auto z-50 shrink-0 px-1">
        <button
          onClick={() => switchSectorView('global')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'global' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucideMapPin className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("עולמי", "Global")}</span>
        </button>
        <button
          onClick={() => switchSectorView('mining')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'mining' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucideLayoutGrid className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("כרייה", "Mining")}</span>
        </button>
        <button
          onClick={() => switchSectorView('oil_and_gas')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'oil_and_gas' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucideDroplets className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("נפט וגז", "Oil & Gas")}</span>
        </button>
        <button
          onClick={() => setViewMode('route_planner')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors shrink-0 ${viewMode === 'route_planner' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucideNavigation className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("מסלול", "Route")}</span>
        </button>
        <button
          onClick={() => setViewMode('due_diligence')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'due_diligence' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucidePieChart className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("בדיקת נאותות", "DD")}</span>
        </button>
        <button
          onClick={() => setViewMode('raw_evidence')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'raw_evidence' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucideAnchor className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("ראיות", "Evidence")}</span>
        </button>
        <button
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${isFilterOpen ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
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
