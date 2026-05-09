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
import AuthOverlay from './components/AuthOverlay';
import AdminPanel from './components/AdminPanel';
import FilterPanel from './components/FilterPanel';
import { Search as LucideSearch, Filter as LucideFilter } from 'lucide-react';

import 'leaflet/dist/leaflet.css';
import './App.css';

function TickerItem({ symbol, price, change, up }: { symbol: string, price: string, change: string, up?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-black text-slate-400">{symbol}</span>
      <span className="text-[10px] font-bold text-white">{price}</span>
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
  const [viewMode, setViewMode] = useState<'map' | 'pipeline' | 'admin'>('map');
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

  // Filtering Hook
  const miningData = useMiningData(rawData, userAnnotations);

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
    if (updates.price !== undefined) backendPayload.pricePerKg = updates.price;
    if (updates.quantity !== undefined) backendPayload.capacity = updates.quantity;
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

  // Triple-Panel States
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  return (
    <div className={`h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans ${isRtl ? 'rtl' : 'ltr'}`}>
      {/* 1. Global Market Ticker (Entrepreneur Desk) */}
      <div className="h-8 w-full bg-slate-950 border-b border-white/5 flex items-center overflow-hidden">
         <div className="flex items-center gap-2 px-4 border-r border-white/5 bg-amber-500/10 h-full shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[9px] font-black uppercase text-amber-500 tracking-widest">{t("שווקים חיים", "LIVE MARKETS")}</span>
         </div>
         <div className="flex-1 overflow-hidden relative">
            <div className="flex items-center gap-12 whitespace-nowrap animate-marquee py-1">
               <TickerItem symbol="XAU/USD" price="2,341.20" change="+1.2%" up />
               <TickerItem symbol="XAG/USD" price="28.45" change="-0.4%" />
               <TickerItem symbol="XPT/USD" price="982.10" change="+0.8%" up />
               <TickerItem symbol="BRENT" price="83.42" change="+2.1%" up />
               <TickerItem symbol="COPPER" price="4.52" change="-0.2%" />
               <TickerItem symbol="XAU/USD" price="2,341.20" change="+1.2%" up />
               <TickerItem symbol="XAG/USD" price="28.45" change="-0.4%" />
               <TickerItem symbol="XPT/USD" price="982.10" change="+0.8%" up />
            </div>
         </div>
      </div>

      {/* 2. Main Discovery Layout */}
      <div className="flex-1 flex overflow-hidden">
        {!token && <AuthOverlay onLogin={handleLogin} error={authError} />}
        
        {/* PANEL 1: Left Navigation & Results List */}
        <aside 
          className={`transition-all duration-500 ease-[0.23,1,0.32,1] z-40 border-r border-white/5 bg-slate-950/40 backdrop-blur-3xl shadow-2xl
          ${isSidebarCollapsed ? 'w-16' : 'w-96'}`}
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
          />
        </aside>

        {/* PANEL 2: Central Map Workspace */}
        <main className="flex-1 relative z-0 h-full overflow-hidden">
          {/* Top Command Toolbar - Only show on Map and Pipeline */}
          {(viewMode === 'map' || viewMode === 'pipeline') && (
            <div className="absolute top-4 left-6 right-6 z-[1000] flex justify-between items-center pointer-events-none">
              <div className="flex items-center gap-3 pointer-events-auto">
                  <div className="flex items-center bg-slate-950/60 backdrop-blur-2xl border border-white/10 rounded-2xl px-4 h-12 shadow-2xl w-80">
                    <LucideSearch className="w-5 h-5 text-slate-500 mr-3" />
                    <input 
                      type="text"
                      placeholder={t("חפש מודיעין...", "Search intelligence hub...")}
                      className="bg-transparent border-none outline-none text-sm font-bold text-slate-200 w-full placeholder:text-slate-600 tracking-tight"
                      value={miningData.filter}
                      onChange={(e) => miningData.setFilter(e.target.value)}
                    />
                  </div>
              </div>

              <div className="flex items-center gap-3 pointer-events-auto">
                  <div className="flex gap-1.5 bg-slate-950/40 backdrop-blur-2xl p-1.5 rounded-2xl border border-white/5 shadow-2xl">
                    <button
                      onClick={() => setViewMode('map')}
                      className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'map' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
                    >
                      {t("מפה", "Map")}
                    </button>
                    <button
                      onClick={() => setViewMode('pipeline')}
                      className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'pipeline' ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
                    >
                      {t("צנרת", "Pipeline")}
                    </button>
                  </div>

                  <button
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    className={`p-3 rounded-2xl border transition-all active:scale-95 shadow-2xl backdrop-blur-2xl ${isFilterOpen ? 'bg-amber-500 border-amber-500 text-slate-950' : 'bg-slate-950/60 border-white/10 text-slate-400 hover:text-white'}`}
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
            {viewMode === 'pipeline' && (
              <div className="pt-24 px-6 h-full bg-slate-950">
                <KanbanBoard
                  processedData={miningData.processedData}
                  userAnnotations={userAnnotations}
                  updateAnnotation={updateAnnotation}
                  onCardClick={handleOpenDossier}
                />
              </div>
            )}
            {viewMode === 'admin' && (
              <div className="h-full bg-slate-950">
                <AdminPanel 
                  isOpen={true} 
                  onClose={() => setViewMode('map')} 
                  token={token || undefined} 
                  isFullPage={true}
                />
              </div>
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
          item={dossierItem}
          annotation={dossierItem ? userAnnotations[dossierItem.id] : {} as any}
          updateAnnotation={updateAnnotation}
          onClose={() => setIsDossierOpen(false)}
        />
      </div>

      {/* Mobile Nav */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 h-16 bg-slate-900 border-t border-slate-800 flex items-center justify-around z-40">
           {/* Mobile nav items... */}
        </nav>
      )}
    </div>
  );
}
