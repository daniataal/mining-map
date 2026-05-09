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

import 'leaflet/dist/leaflet.css';
import './App.css';

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
  const [viewMode, setViewMode] = useState<'map' | 'pipeline'>('map');
  const [mobileTab, setMobileTab] = useState<'map' | 'list' | 'pipeline'>('map');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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

  return (
    <div className={`flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden ${isRtl ? 'rtl' : 'ltr'}`}>
      {!token && <AuthOverlay onLogin={handleLogin} error={authError} />}
      
      <AdminPanel isOpen={isAdminPanelOpen} onClose={() => setIsAdminPanelOpen(false)} token={token} />

      {/* Admin Button */}
      {userRole === 'admin' && (
        <button
          onClick={() => setIsAdminPanelOpen(true)}
          className="fixed bottom-6 right-6 z-50 p-3 bg-amber-500 hover:bg-amber-600 rounded-full shadow-lg transition-all"
          title={t("לוח בקרה", "Admin Panel")}
        >
          ⚙️
        </button>
      )}

      <AddLicenseModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={(item: any) => {/* mutation here */}}
      />

      <DossierView
        isOpen={isDossierOpen}
        onClose={() => setIsDossierOpen(false)}
        item={dossierItem}
        annotation={dossierItem ? (userAnnotations[dossierItem.id] || {}) : {}}
        updateAnnotation={updateAnnotation}
      />

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside 
          className={`transition-all duration-500 ease-in-out border-r border-slate-800 bg-slate-950/40 backdrop-blur-3xl z-20 shadow-2xl
          ${isSidebarCollapsed ? 'w-0 overflow-hidden opacity-0 -translate-x-full' : 'w-80 translate-x-0'} 
          ${isMobile && mobileTab !== 'list' ? 'hidden' : ''}`}
        >
          <Sidebar
            processedData={miningData.processedData}
            filter={miningData.filter} setFilter={miningData.setFilter}
            sortBy={miningData.sortBy} setSortBy={miningData.setSortBy}
            selectedCommodity={miningData.selectedCommodity} setSelectedCommodity={miningData.setSelectedCommodity}
            selectedCountry={miningData.selectedCountry} setSelectedCountry={miningData.setSelectedCountry}
            userStatusFilter={miningData.userStatusFilter} setUserStatusFilter={miningData.setUserStatusFilter}
            selectedLicenseType={miningData.selectedLicenseType} setSelectedLicenseType={miningData.setSelectedLicenseType}
            commodities={miningData.commodities} countries={miningData.countries} licenseTypes={miningData.licenseTypes}
            setIsAddModalOpen={setIsAddModalOpen}
            loading={isLoading}
            onLogout={handleLogout}
            userAnnotations={userAnnotations}
            selectedItem={selectedItem}
            setSelectedItem={(item: MiningLicense) => {
              setSelectedItem(item);
              handleOpenDossier(item);
              setMapFlyTrigger(prev => prev + 1);
            }}
          />
        </aside>

        {/* Content Area */}
        <main className="flex-1 relative">
          {/* Sidebar Toggle */}
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="absolute top-4 left-4 z-30 p-2 bg-slate-800 hover:bg-slate-700 rounded-md shadow-md"
          >
            {isSidebarCollapsed ? '»' : '«'}
          </button>

          {/* View Mode Switcher */}
          <div className="absolute top-4 right-4 z-30 flex gap-2 bg-slate-800/80 backdrop-blur p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1 rounded-md transition-all ${viewMode === 'map' ? 'bg-amber-500 text-slate-950' : 'hover:bg-slate-700'}`}
            >
              🗺️ {t("מפה", "Map")}
            </button>
            <button
              onClick={() => setViewMode('pipeline')}
              className={`px-3 py-1 rounded-md transition-all ${viewMode === 'pipeline' ? 'bg-amber-500 text-slate-950' : 'hover:bg-slate-700'}`}
            >
              📊 {t("צנרת", "Pipeline")}
            </button>
          </div>

          {viewMode === 'map' ? (
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
          ) : (
            <KanbanBoard
              processedData={miningData.processedData}
              userAnnotations={userAnnotations}
              updateAnnotation={updateAnnotation}
              onCardClick={handleOpenDossier}
            />
          )}
        </main>
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
