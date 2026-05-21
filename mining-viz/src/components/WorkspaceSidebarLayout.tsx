import type { ReactNode } from 'react';
import { Archive, Layers, List, LogOut, PieChart, Radio, Settings } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import Sidebar from './Sidebar';
import type { MiningLicense, UserAnnotation } from '../types';

export type MapSidebarTab = 'licenses' | 'live_data' | 'historic';

export type WorkspaceSidebarLayoutProps = {
  tab: MapSidebarTab;
  onTabChange: (tab: MapSidebarTab) => void;
  isCollapsed: boolean;
  isPinned: boolean;
  setIsPinned: (v: boolean) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  sidebarViewMode: 'map' | 'admin' | 'dashboard';
  onSidebarViewModeChange: (mode: 'map' | 'admin' | 'dashboard') => void;
  onToggleFilter: () => void;
  onToggleAdmin: () => void;
  isFilterOpen: boolean;
  onLogout: () => void;
  /** License list sidebar props */
  processedData: MiningLicense[];
  setIsAddModalOpen: (v: boolean) => void;
  onOpenBulkImport: () => void;
  loading: boolean;
  userAnnotations: Record<string, UserAnnotation>;
  selectedItem: MiningLicense | null;
  setSelectedItem: (item: MiningLicense) => void;
  infrastructureStats?: Parameters<typeof Sidebar>[0]['infrastructureStats'];
  isInDdQueue?: (id: string) => boolean;
  onAddToDueDiligence?: (id: string) => void;
  onRemoveFromDueDiligence?: (id: string) => void;
  getDealRoomForLicense?: Parameters<typeof Sidebar>[0]['getDealRoomForLicense'];
  liveDataPanel: ReactNode;
  historicPanel: ReactNode;
};

export default function WorkspaceSidebarLayout({
  tab,
  onTabChange,
  isCollapsed,
  isPinned,
  setIsPinned,
  onMouseEnter,
  onMouseLeave,
  sidebarViewMode,
  onSidebarViewModeChange,
  onToggleFilter,
  onToggleAdmin,
  isFilterOpen,
  onLogout,
  processedData,
  setIsAddModalOpen,
  onOpenBulkImport,
  loading,
  userAnnotations,
  selectedItem,
  setSelectedItem,
  infrastructureStats,
  isInDdQueue,
  onAddToDueDiligence,
  onRemoveFromDueDiligence,
  getDealRoomForLicense,
  liveDataPanel,
  historicPanel,
}: WorkspaceSidebarLayoutProps) {
  const { t } = useI18n();

  const tabBtn = (key: MapSidebarTab, labelHe: string, labelEn: string, Icon: typeof List) => {
    const active = tab === key;
    return (
      <button
        type="button"
        onClick={() => onTabChange(key)}
        className={`flex-1 min-w-0 px-2 py-2 text-[9px] font-black uppercase tracking-wide transition-colors flex items-center justify-center gap-1 ${
          active
            ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200 border-b-2 border-amber-500'
            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border-b-2 border-transparent'
        }`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{t(labelHe, labelEn)}</span>
      </button>
    );
  };

  if (tab === 'licenses') {
    return (
      <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="h-full min-h-0 flex flex-col">
        <Sidebar
          processedData={processedData}
          setIsAddModalOpen={setIsAddModalOpen}
          onOpenBulkImport={onOpenBulkImport}
          loading={loading}
          onLogout={onLogout}
          userAnnotations={userAnnotations}
          selectedItem={selectedItem}
          setSelectedItem={setSelectedItem}
          viewMode={sidebarViewMode}
          setViewMode={onSidebarViewModeChange}
          onToggleFilter={onToggleFilter}
          onToggleAdmin={onToggleAdmin}
          isFilterOpen={isFilterOpen}
          isPinned={isPinned}
          setIsPinned={setIsPinned}
          isCollapsed={isCollapsed}
          infrastructureStats={infrastructureStats}
          isInDdQueue={isInDdQueue}
          onAddToDueDiligence={onAddToDueDiligence}
          onRemoveFromDueDiligence={onRemoveFromDueDiligence}
          getDealRoomForLicense={getDealRoomForLicense}
          onSelectWorkspaceTab={onTabChange}
          workspaceTab={tab}
        />
      </div>
    );
  }

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="flex h-full min-h-0 flex-1 bg-transparent text-slate-800 dark:text-slate-100 select-none"
    >
      <div className="w-16 flex-shrink-0 border-r border-black/5 dark:border-white/5 flex flex-col items-center py-6 gap-4 bg-white dark:bg-slate-950">
        <button
          type="button"
          onClick={() => {
            onTabChange('licenses');
            onSidebarViewModeChange('map');
          }}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 border border-transparent hover:bg-black/5 dark:hover:bg-white/5"
          title={t('רישיונות', 'Licenses')}
        >
          <List className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => onTabChange('live_data')}
          className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
            tab === 'live_data'
              ? 'bg-sky-500/20 text-sky-600 border-sky-500/40'
              : 'text-slate-400 border-transparent hover:bg-black/5 dark:hover:bg-white/5'
          }`}
          title={t('נתונים חיים', 'Live Data')}
        >
          <Radio className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => onTabChange('historic')}
          className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
            tab === 'historic'
              ? 'bg-violet-500/20 text-violet-600 border-violet-500/40'
              : 'text-slate-400 border-transparent hover:bg-black/5 dark:hover:bg-white/5'
          }`}
          title={t('היסטורי', 'Historic')}
        >
          <Archive className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => onSidebarViewModeChange('dashboard')}
          className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
            sidebarViewMode === 'dashboard'
              ? 'bg-amber-500/20 text-amber-500 border-amber-500/40'
              : 'text-slate-400 border-transparent hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <PieChart className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onToggleFilter}
          className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
            isFilterOpen
              ? 'bg-amber-500 text-slate-950 border-amber-500'
              : 'text-slate-400 border-transparent hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <Layers className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onToggleAdmin}
          className="w-10 h-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center text-slate-400 border border-transparent"
        >
          <Settings className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="mt-auto w-10 h-10 rounded-xl hover:bg-red-500/10 flex items-center justify-center text-slate-400 hover:text-red-400"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      {!isCollapsed && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 border-b border-black/5 dark:border-white/5 bg-stone-50/80 dark:bg-slate-900/50">
            {tabBtn('licenses', 'רישיונות', 'Licenses', List)}
            {tabBtn('live_data', 'חי', 'Live', Radio)}
            {tabBtn('historic', 'היסטורי', 'Historic', Archive)}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {tab === 'live_data' && (
              <div className="flex-1 min-h-0 overflow-hidden">{liveDataPanel}</div>
            )}
            {tab === 'historic' && (
              <div className="flex-1 min-h-0 overflow-y-auto p-3">{historicPanel}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
