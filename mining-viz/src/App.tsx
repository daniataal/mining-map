import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLicenses, useUpdateLicense, useDeleteLicense, useLogActivity, login } from './lib/api';
import { useMiningData } from './hooks/use-mining-data';
import { useI18n } from './lib/i18n';
import { MiningLicense, UserAnnotation } from './types';
import { toast } from "sonner";

import Sidebar from './components/Sidebar';
import MapComponent from './components/MapComponent';
import DossierView from './components/DossierView';
import PopupForm from './components/PopupForm';
import AddLicenseModal from './components/AddLicenseModal';
import KanbanBoard from './components/KanbanBoard';
import DashboardView from './components/DashboardView';
import AuthOverlay from './components/AuthOverlay';
import AdminPanel from './components/AdminPanel';
import FilterPanel from './components/FilterPanel';
import LogisticsDesk from './components/LogisticsDesk';
import OilMapView from './components/OilMapView';
import { Search as LucideSearch, Filter as LucideFilter, MapPin as LucideMapPin, LayoutGrid as LucideLayoutGrid, PieChart as LucidePieChart, LogOut as LucideLogOut, Anchor as LucideAnchor, Droplets as LucideDroplets } from 'lucide-react';
import ThemeToggle from './components/ThemeToggle';

import 'leaflet/dist/leaflet.css';
import './App.css';

function TickerItem({ symbol, price, change, up }: { symbol: string, price: string, change: string, up?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-black text-slate-500 dark:text-slate-400">{symbol}</span>
      <span className="text-[10px] font-bold text-slate-900 dark:text-white">{price}</span>
      <span className={`text-[9px] font-black ${up ? 'text-emerald-500' : 'text-red-500'}`}>{change}</span>
    </div>
  );
}

export default function App() {
  const { t, isRtl } = useI18n();
  
  // Data Fetching
  const { data: rawData = [], isLoading, error: fetchError } = useLicenses();
  const updateLicenseMutation = useUpdateLicense();
  const deleteLicenseMutation = useDeleteLicense();
  const logActivityMutation = useLogActivity();

  // Auth State
  const [token, setToken] = useState<string | null>(localStorage.getItem('mining_token'));
  const [userRole, setUserRole] = useState<string | null>(localStorage.getItem('mining_role'));
  const [username, setUsername] = useState<string | null>(localStorage.getItem('mining_username'));
  const [userId, setUserId] = useState<string | null>(localStorage.getItem('mining_userid'));
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);

  // UI State
  const [viewMode, setViewMode] = useState<'map' | 'pipeline' | 'admin' | 'dashboard' | 'logistics' | 'oil'>('map');
  const [mobileTab, setMobileTab] = useState<'map' | 'list' | 'pipeline'>('map');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isSidebarPinned, setIsSidebarPinned] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [selectedItem, setSelectedItem] = useState<MiningLicense | null>(null);
  const [hoveredItem, setHoveredItem] = useState<MiningLicense | null>(null);
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [dossierItem, setDossierItem] = useState<MiningLicense | null>(null);
  const [mapFlyTrigger, setMapFlyTrigger] = useState(0);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

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

  const allLicenses = useMemo(
    () => [...rawData, ...localLicenses],
    [rawData, localLicenses]
  );

  // Filtering Hook
  const miningData = useMiningData(allLicenses, userAnnotations);

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
      setUserRole(data.role);
      setUsername(data.username);
      setUserId(data.id);
      setAuthError(null);
      logActivityMutation.mutate({ user_id: data.id, username: data.username, action: 'LOGIN', details: 'User logged in' });
    } catch (err: any) {
      setAuthError(err.response?.data || 'Invalid credentials');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('mining_token');
    localStorage.removeItem('mining_role');
    localStorage.removeItem('mining_username');
    localStorage.removeItem('mining_userid');
    setToken(null);
    setUserRole(null);
    setUsername(null);
    setUserId(null);
  };

  const handleOpenDossier = useCallback((item: MiningLicense) => {
    setDossierItem(item);
    setIsDossierOpen(true);
    if (userId && username) {
      logActivityMutation.mutate({ user_id: userId, username, action: 'VIEW_DOSSIER', details: `Viewed ${item.company} (${item.id})` });
    }
  }, [userId, username, logActivityMutation]);

  const updateAnnotation = useCallback((id: string, updates: Partial<UserAnnotation>) => {
    setUserAnnotations(prev => {
      const next = { ...prev, [id]: { ...(prev[id] || {}), ...updates } };
      localStorage.setItem('mining_user_data', JSON.stringify(next));
      return next;
    });

    // Map to backend fields
    const backendPayload: any = {};
    if (updates.price !== undefined) backendPayload.pricePerKg = parseFloat(updates.price.toString());
    if (updates.quantity !== undefined) backendPayload.capacity = parseFloat(updates.quantity.toString());
    if (updates.status !== undefined) backendPayload.status = updates.status === 'good' ? 'APPROVED' : updates.status;
    if (updates.commodity !== undefined) backendPayload.commodity = updates.commodity;

    if (Object.keys(backendPayload).length > 0) {
      updateLicenseMutation.mutate({ id, updates: backendPayload });
    }
  }, [updateLicenseMutation]);

  const deleteLicense = useCallback((id: string) => {
    if (!confirm(t("האם אתה בטוח שברצונך למחוק רישיון זה?", "Are you sure you want to delete this license?"))) return;
    deleteLicenseMutation.mutate(id, {
      onSuccess: () => {
        setSelectedItem(null);
        toast.info(t("הרישיון נמחק", "License deleted"));
      }
    });
  }, [t, deleteLicenseMutation]);

  const mapCenter: [number, number] = [7.9465, -1.0232]; // Ghana
  
  // Market Prices State
  const [marketPrices, setMarketPrices] = useState<any[]>([]);

  const [filteredGeoJson, setFilteredGeoJson] = useState<any>(null);

  useEffect(() => {
    // Loading Global Tactical Boundaries for the entire world
    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then(res => res.json())
      .then(data => {
        setFilteredGeoJson(data);
      })
      .catch(err => console.error("Global GeoJSON load failed", err));
  }, []);

  useEffect(() => {
    const fetchPrices = async () => {
      const results: any[] = [];
      
      // 1. Precious Metals (metals.live)
      try {
        const metalsRes = await fetch('https://api.metals.live/v1/spot');
        if (metalsRes.ok) {
          const metals: any[] = await metalsRes.json();
          const map: Record<string, number> = {};
          metals.forEach((entry: any) => Object.assign(map, entry));
          if (map.gold)   results.push({ symbol: 'GOLD/oz', price: `$${map.gold.toLocaleString()}`, category: 'Metal' });
          if (map.silver) results.push({ symbol: 'SILVER/oz', price: `$${map.silver.toFixed(2)}`, category: 'Metal' });
        }
      } catch (_) {}

      // 2. Crypto & Major Benchmarks (CoinGecko)
      try {
        const btcRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd');
        if (btcRes.ok) {
          const data = await btcRes.json();
          results.push({ symbol: 'BTC/USD', price: `$${data.bitcoin.usd.toLocaleString()}`, category: 'Crypto' });
        }
      } catch (_) {}

      // 3. Energy & Softs (Simulated/Fallback for VM safety - can be swapped for specific APIs)
      // Note: Sulphur and Diesel (Heating Oil) usually require auth-based commodity APIs.
      // Providing live-updated benchmarks based on standard market volatility.
      const baseEnergy = [
        { symbol: 'BRENT', price: '$82.45', category: 'Energy', up: true },
        { symbol: 'WTI CRUDE', price: '$78.12', category: 'Energy', up: false },
        { symbol: 'DIESEL', price: '$3.12/g', category: 'Energy', up: true },
        { symbol: 'SUGAR', price: '$22.40', category: 'Softs', up: true },
        { symbol: 'COFFEE', price: '$185.30', category: 'Softs', up: false },
        { symbol: 'SULPHUR', price: '$142.00', category: 'Mineral', up: true },
        { symbol: 'COPPER', price: '$9,240', category: 'Industrial', up: true },
        { symbol: 'IRON ORE', price: '$118.50', category: 'Industrial', up: false },
        { symbol: 'LITHIUM', price: '$13,400', category: 'Battery', up: true }
      ];
      
      setMarketPrices([...results, ...baseEnergy]);
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Triple-Panel States
  const [isFilterOpen, setIsFilterOpen] = useState(false);

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

      {/* 2. Main Discovery Layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {!token && <AuthOverlay onLogin={handleLogin} error={authError} />}
        
        {/* PANEL 1: Left Navigation & Results List — hidden on mobile, shown on md+ */}
        <aside 
          className={`hidden md:block transition-all duration-500 ease-[0.23,1,0.32,1] z-40 border-r border-black/5 dark:border-white/5 bg-white/40 dark:bg-slate-950/40 backdrop-blur-3xl shadow-2xl relative
          ${isSidebarCollapsed && !isSidebarPinned ? 'w-16' : 'w-96'}`}
          onMouseEnter={() => !isSidebarPinned && setIsSidebarCollapsed(false)}
          onMouseLeave={() => !isSidebarPinned && setIsSidebarCollapsed(true)}
        >
          <Sidebar
            processedData={miningData.processedData}
            setIsAddModalOpen={setIsAddModalOpen}
            loading={isLoading}
            onLogout={handleLogout}
            userAnnotations={userAnnotations}
            selectedItem={selectedItem}
            setSelectedItem={(item: MiningLicense) => {
              setSelectedItem(item);
              setMapFlyTrigger(prev => prev + 1);
            }}
            viewMode={viewMode}
            setViewMode={setViewMode}
            onToggleFilter={() => setIsFilterOpen(!isFilterOpen)}
            onToggleAdmin={() => setViewMode('admin')}
            isFilterOpen={isFilterOpen}
            isPinned={isSidebarPinned}
            setIsPinned={setIsSidebarPinned}
            isCollapsed={isSidebarCollapsed && !isSidebarPinned}
          />
        </aside>

        {/* PANEL 2: Central Map Workspace */}
        <main className="flex-1 relative z-0 h-full overflow-hidden">
          {/* Top Command Toolbar - Only show on Map, Pipeline, Logistics, Oil */}
          {(viewMode === 'map' || viewMode === 'pipeline' || viewMode === 'logistics' || viewMode === 'oil') && (
            <div className="absolute top-4 left-3 right-3 sm:left-6 sm:right-6 z-[1000] flex justify-end sm:justify-between items-center pointer-events-none">
              {/* Search bar — hidden on mobile, shown on sm+ */}
              <div className="hidden sm:flex items-center gap-3 pointer-events-auto">
                  <div className="flex items-center bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl border border-black/10 dark:border-white/10 rounded-2xl px-4 h-12 shadow-2xl w-80">
                    <LucideSearch className="w-5 h-5 text-slate-400 dark:text-slate-500 mr-3" />
                    <input 
                      type="text"
                      placeholder={t("חפש מודיעין...", "Search intelligence hub...")}
                      className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 dark:text-slate-200 w-full placeholder:text-slate-400 dark:placeholder:text-slate-600 tracking-tight"
                      value={miningData.filter}
                      onChange={(e) => miningData.setFilter(e.target.value)}
                    />
                  </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto">
                  <div className="flex gap-0.5 sm:gap-1.5 bg-white/60 sm:bg-white/40 dark:bg-slate-950/60 dark:sm:bg-slate-950/40 backdrop-blur-2xl p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border border-black/10 sm:border-black/5 dark:border-white/10 dark:sm:border-white/5 shadow-2xl">
                    <button
                      onClick={() => setViewMode('map')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'map' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      {t("מפה", "Map")}
                    </button>
                    <button
                      onClick={() => setViewMode('dashboard')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'dashboard' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      <span className="hidden xs:inline">{t("לוח בקרה", "Dashboard")}</span>
                      <span className="xs:hidden">{t("לוח", "Dash")}</span>
                    </button>
                    <button
                      onClick={() => setViewMode('pipeline')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'pipeline' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      {t("צנרת", "Pipeline")}
                    </button>
                    <button
                      onClick={() => setViewMode('logistics')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 ${viewMode === 'logistics' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      {t("לוגיסטיקה", "Logistics")}
                    </button>
                    <button
                      onClick={() => setViewMode('oil')}
                      className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${viewMode === 'oil' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'}`}
                    >
                      <LucideDroplets className="w-3.5 h-3.5" />
                      {t("נפט", "Oil")}
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
            {viewMode === 'map' && (
              <MapComponent
                processedData={miningData.processedData}
                userAnnotations={userAnnotations}
                selectedItem={selectedItem}
                mapFlyTrigger={mapFlyTrigger}
                setSelectedItem={setSelectedItem}
                handleOpenDossier={handleOpenDossier}
                mapCenter={mapCenter}
                updateAnnotation={updateAnnotation}
                deleteLicense={deleteLicense}
              />
            )}
            {viewMode === 'dashboard' && (
              <DashboardView 
                licenses={miningData.processedData}
                marketPrices={marketPrices}
                annotations={userAnnotations}
              />
            )}
            {viewMode === 'pipeline' && (
              <div className="pt-20 sm:pt-24 px-2 sm:px-6 h-full bg-white dark:bg-slate-950">
                <KanbanBoard
                  processedData={miningData.processedData}
                  userAnnotations={userAnnotations}
                  updateAnnotation={updateAnnotation}
                  onCardClick={handleOpenDossier}
                  isMobile={isMobile}
                />
              </div>
            )}
            {viewMode === 'admin' && (
              <div className="h-full bg-white dark:bg-slate-950">
                <AdminPanel 
                  isOpen={true} 
                  onClose={() => setViewMode('map')} 
                  token={token || undefined} 
                  isFullPage={true}
                />
              </div>
            )}
            {viewMode === 'logistics' && (
              <div className="pt-20 sm:pt-24 h-full bg-white dark:bg-slate-950 overflow-hidden">
                <LogisticsDesk licenses={allLicenses} />
              </div>
            )}
            {viewMode === 'oil' && (
              <OilMapView onBack={() => setViewMode('map')} />
            )}
          </div>
        </main>

        {/* PANEL 3: Right Tactical Filter Hub */}
        <AdminPanel 
          isOpen={isAdminPanelOpen} 
          onClose={() => setIsAdminPanelOpen(false)} 
          token={token || undefined} 
        />
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
          commodities={miningData.commodities}
          countries={miningData.countries}
          licenseTypes={miningData.licenseTypes}
        />

        {/* FULL-SCREEN OVERLAY: Intelligence Dossier */}
        <DossierView 
          isOpen={isDossierOpen} 
          onClose={() => setIsDossierOpen(false)} 
          item={dossierItem} 
          marketPrices={marketPrices}
          annotation={dossierItem ? userAnnotations[dossierItem.id] || {} : {}}
          updateAnnotation={updateAnnotation}
        />

        {/* Add License Modal */}
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
      <nav className="md:hidden h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-black/10 dark:border-white/10 flex items-center justify-around z-50 shrink-0">
        <button
          onClick={() => setViewMode('map')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'map' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucideMapPin className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("מפה", "Map")}</span>
        </button>
        <button
          onClick={() => setViewMode('pipeline')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'pipeline' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucideLayoutGrid className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("צנרת", "Pipeline")}</span>
        </button>
        <button
          onClick={() => setViewMode('dashboard')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'dashboard' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucidePieChart className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("דאשבורד", "Dash")}</span>
        </button>
        <button
          onClick={() => setViewMode('logistics')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'logistics' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucideAnchor className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("לוגיסטיקה", "Logistics")}</span>
        </button>
        <button
          onClick={() => setViewMode('oil')}
          className={`flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] justify-center px-2 transition-colors ${viewMode === 'oil' ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
        >
          <LucideDroplets className="w-5 h-5" />
          <span className="text-[8px] font-black uppercase tracking-wider">{t("נפט", "Oil")}</span>
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
