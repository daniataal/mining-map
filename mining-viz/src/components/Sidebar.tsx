import { useState, useEffect, useRef } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { 
  Plus as LucidePlus, 
  LogOut as LucideLogOut, 
  MapPin as LucideMapPin,
  Layers as LucideLayers,
  Settings as LucideSettings,
  Pin as LucidePin,
  PieChart as LucidePieChart,
  Upload as LucideUpload,
  Radio as LucideRadio,
  Archive as LucideArchive,
  List as LucideList,
} from 'lucide-react';
import type { MapSidebarTab } from './WorkspaceSidebarLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { getLicenseRenderKey } from '../lib/licenseRenderKey';
import AddToDueDiligenceButton from './AddToDueDiligenceButton';

interface SidebarProps {
  processedData: MiningLicense[];
  setIsAddModalOpen: (val: boolean) => void;
  onOpenBulkImport: () => void;
  loading: boolean;
  onLogout: () => void;
  userAnnotations: Record<string, UserAnnotation>;
  selectedItem: MiningLicense | null;
  setSelectedItem: (item: MiningLicense) => void;
  viewMode: 'map' | 'admin' | 'dashboard';
  setViewMode: (mode: 'map' | 'admin' | 'dashboard') => void;
  onToggleFilter: () => void;
  onToggleAdmin: () => void;
  isFilterOpen: boolean;
  isPinned: boolean;
  setIsPinned: (val: boolean) => void;
  isCollapsed: boolean;
  infrastructureStats?: {
    total: number;
    countries: number;
    ports: number;
    withLocode: number;
    portLinked: number;
    withOperator: number;
    withCapacity: number;
    highConfidence: number;
    topCountries: Array<{ country: string; count: number }>;
  };
  isInDdQueue?: (id: string) => boolean;
  onAddToDueDiligence?: (id: string) => void;
  onRemoveFromDueDiligence?: (id: string) => void;
  getDealRoomForLicense?: (id: string, entityKind?: string) => { title: string } | null | undefined;
  workspaceTab?: MapSidebarTab;
  onSelectWorkspaceTab?: (tab: MapSidebarTab) => void;
}

function sourceTrustLabel(item: MiningLicense): string {
  const source = (item.sourceKind || item.recordOrigin || '').toLowerCase();
  if (source === 'official_registry' || item.recordOrigin === 'open_data') return 'Official';
  if (source === 'global_open_fallback' || item.recordOrigin === 'global_open_fallback') return 'Fallback';
  if (source === 'user_import_csv' || item.recordOrigin === 'user_import_csv') return 'User CSV';
  if (source === 'bundled_json' || item.recordOrigin === 'bundled_json') return 'Bundled';
  return item.sourceName ? 'Sourced' : 'Unverified';
}

function sourceTrustClass(item: MiningLicense): string {
  const label = sourceTrustLabel(item);
  if (label === 'Official') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (label === 'Fallback' || label === 'Bundled') return 'bg-violet-500/10 text-violet-600 dark:text-violet-300';
  if (label === 'User CSV') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'bg-slate-500/10 text-slate-500 dark:text-slate-400';
}

export default function Sidebar({
  processedData,
  loading,
  onLogout,
  setSelectedItem,
  selectedItem,
  userAnnotations,
  setIsAddModalOpen,
  onOpenBulkImport,
  viewMode,
  setViewMode,
  onToggleFilter,
  onToggleAdmin,
  isFilterOpen,
  isPinned,
  setIsPinned,
  isCollapsed,
  infrastructureStats,
  isInDdQueue,
  onAddToDueDiligence,
  onRemoveFromDueDiligence,
  getDealRoomForLicense,
  workspaceTab = 'licenses',
  onSelectWorkspaceTab,
}: SidebarProps) {
  const { t } = useI18n();
  const [displayCount, setDisplayCount] = useState(20);
  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDisplayCount(20);
  }, [processedData]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && displayCount < processedData.length) {
          setDisplayCount(prev => prev + 20);
        }
      },
      { threshold: 1.0 }
    );

    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [displayCount, processedData.length]);

  return (
    <div className="flex h-full min-h-0 flex-1 bg-transparent text-slate-800 dark:text-slate-100 select-none">
      {/* Icon Rail (MarineTraffic style) */}
      <div className="w-16 flex-shrink-0 border-r border-black/5 dark:border-white/5 flex flex-col items-center py-6 gap-6 bg-white dark:bg-slate-950">
        <button 
          onClick={() => {
            onSelectWorkspaceTab?.('licenses');
            setViewMode('map');
          }}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 border
          ${workspaceTab === 'licenses' && viewMode === 'map'
            ? 'bg-amber-500/20 text-amber-500 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.1)]' 
            : 'text-slate-400 dark:text-slate-500 border-transparent hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-300'}`}
          title={t('רישיונות', 'Licenses')}
        >
          <LucideList className="w-5 h-5" />
        </button>
        {onSelectWorkspaceTab && (
          <>
            <button
              type="button"
              onClick={() => onSelectWorkspaceTab('live_data')}
              className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
                workspaceTab === 'live_data'
                  ? 'bg-sky-500/20 text-sky-600 border-sky-500/40'
                  : 'text-slate-400 border-transparent hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              title={t('נתונים חיים', 'Live Data')}
            >
              <LucideRadio className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => onSelectWorkspaceTab('historic')}
              className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
                workspaceTab === 'historic'
                  ? 'bg-violet-500/20 text-violet-600 border-violet-500/40'
                  : 'text-slate-400 border-transparent hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              title={t('היסטורי', 'Historic')}
            >
              <LucideArchive className="w-5 h-5" />
            </button>
          </>
        )}
        <button 
          onClick={() => setViewMode('dashboard')}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 border
          ${viewMode === 'dashboard' 
            ? 'bg-amber-500/20 text-amber-500 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.1)]' 
            : 'text-slate-400 dark:text-slate-500 border-transparent hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          <LucidePieChart className="w-5 h-5" />
        </button>
        <button 
          onClick={onToggleFilter}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 border
          ${isFilterOpen 
            ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]' 
            : 'text-slate-400 dark:text-slate-500 border-transparent hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          <LucideLayers className="w-5 h-5" />
        </button>
        <button 
          onClick={onToggleAdmin}
          className="w-10 h-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 border border-transparent transition-all cursor-pointer"
        >
          <LucideSettings className="w-5 h-5" />
        </button>
        <div className="mt-auto w-10 h-10 rounded-xl hover:bg-red-500/10 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-red-400 transition-colors cursor-pointer" onClick={onLogout}>
          <LucideLogOut className="w-5 h-5" />
        </div>
      </div>

      {/* Results List */}
      {!isCollapsed && (
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {onSelectWorkspaceTab && (
            <div className="flex shrink-0 border-b border-black/5 dark:border-white/5">
              {(
                [
                  ['licenses', 'רישיונות', 'Licenses', LucideList],
                  ['live_data', 'חי', 'Live', LucideRadio],
                  ['historic', 'היסטורי', 'Historic', LucideArchive],
                ] as const
              ).map(([key, he, en, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectWorkspaceTab(key)}
                  className={`flex-1 px-2 py-2 text-[9px] font-black uppercase tracking-wide flex items-center justify-center gap-1 ${
                    workspaceTab === key
                      ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200 border-b-2 border-amber-500'
                      : 'text-slate-500 border-b-2 border-transparent hover:text-slate-700'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {t(he, en)}
                </button>
              ))}
            </div>
          )}
          <header className="p-5 border-b border-black/5 dark:border-white/5">
            <div className="flex items-center justify-between">
              <h1 className="text-sm font-black tracking-[0.2em] text-slate-400 dark:text-slate-500 uppercase">{t("תוצאות", "Live Results")}</h1>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPinned(!isPinned);
                }}
                className={`p-1.5 rounded-lg transition-all ${isPinned ? 'text-amber-500 bg-amber-500/10' : 'text-slate-600 hover:text-slate-400'}`}
              >
                <LucidePin className={`w-3.5 h-3.5 ${isPinned ? 'fill-amber-500 rotate-45' : ''} transition-transform`} />
              </button>
            </div>
            <div className="flex items-center justify-between mt-4">
               <Badge variant="outline" className="text-[10px] border-black/10 dark:border-white/10 text-slate-500 dark:text-slate-400 bg-black/5 dark:bg-white/5 px-2 h-5 font-black uppercase">
                  {processedData.length} {t("נמצאו", "Total Found")}
               </Badge>
               <div className="flex items-center gap-1">
                 <Button 
                   size="icon" 
                   variant="ghost" 
                   title={t("ייבוא CSV", "Bulk import CSV")}
                   className="h-8 w-8 bg-slate-500/10 text-slate-400 hover:bg-slate-500/20 border border-slate-500/20 rounded-lg transition-all active:scale-95"
                   onClick={onOpenBulkImport}
                 >
                   <LucideUpload className="w-4 h-4 stroke-[3]" />
                 </Button>
                 <Button 
                   size="icon" 
                   variant="ghost" 
                   className="h-8 w-8 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg transition-all active:scale-95"
                   onClick={() => setIsAddModalOpen(true)}
                 >
                   <LucidePlus className="w-4 h-4 stroke-[3]" />
                 </Button>
               </div>
            </div>
            {infrastructureStats && infrastructureStats.total > 0 && (
              <div className="mt-4 rounded-2xl border border-cyan-500/10 bg-cyan-500/5 p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Nodes</p>
                    <p className="text-sm font-black text-slate-900 dark:text-white">{infrastructureStats.total}</p>
                  </div>
                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Countries</p>
                    <p className="text-sm font-black text-slate-900 dark:text-white">{infrastructureStats.countries}</p>
                  </div>
                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Ports</p>
                    <p className="text-sm font-black text-emerald-500">{infrastructureStats.ports}</p>
                  </div>
                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">With LOCODE</p>
                    <p className="text-sm font-black text-cyan-500">{infrastructureStats.withLocode}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Port Linked</p>
                    <p className="text-sm font-black text-emerald-500">{infrastructureStats.portLinked}</p>
                  </div>
                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">High Confidence</p>
                    <p className="text-sm font-black text-cyan-500">{infrastructureStats.highConfidence}</p>
                  </div>
                </div>
                {infrastructureStats.topCountries.length > 0 && (
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-2">
                      Top Countries
                    </p>
                    <div className="space-y-1.5">
                      {infrastructureStats.topCountries.slice(0, 4).map((row) => (
                        <div key={row.country} className="flex items-center justify-between text-[10px] font-bold text-slate-600 dark:text-slate-300">
                          <span className="truncate pr-3">{row.country}</span>
                          <span>{row.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </header>

          <ScrollArea className="min-h-0 flex-1 overflow-hidden">
            <div className="p-3 space-y-2">
            <AnimatePresence mode="popLayout">
              {processedData.slice(0, displayCount).map((item, index) => {
                const annotation = userAnnotations[item.id] || {};
                const isSelected = selectedItem?.id === item.id;

                return (
                  <motion.div
                    key={getLicenseRenderKey(item, index)}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`group p-4 rounded-xl cursor-pointer transition-all duration-300 border
                      ${isSelected 
                        ? 'bg-amber-500/10 border-amber-500/30 shadow-[inset_0_0_20px_rgba(245,158,11,0.05)]' 
                        : 'bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] hover:border-black/10 dark:hover:border-white/10'}`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className={`text-xs font-black uppercase tracking-tight truncate pr-4 transition-colors ${isSelected ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>
                        {item.company}
                      </h3>
                      <div className="flex gap-1 shrink-0">
                         {annotation.status === 'good' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />}
                         {annotation.status === 'maybe' && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />}
                         {annotation.status === 'bad' && <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />}
                      </div>
                    </div>
                    <div className="flex items-center text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
                       <LucideMapPin className="w-3 h-3 mr-1 text-slate-600" />
                       <span className="truncate">{item.region}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge className={`${sourceTrustClass(item)} border-none text-[8px] font-black uppercase`}>
                        {sourceTrustLabel(item)}
                        {typeof item.confidenceScore === 'number' ? ` ${(item.confidenceScore * 100).toFixed(0)}%` : ''}
                      </Badge>
                      {item.coverageState && (
                        <Badge className="bg-slate-900/5 dark:bg-white/5 text-slate-500 dark:text-slate-300 border-none text-[8px] font-black uppercase">
                          {item.coverageState.replaceAll('_', ' ')}
                        </Badge>
                      )}
                      {item.entitySubtype && (
                        <Badge className="bg-cyan-500/10 text-cyan-500 border-none text-[8px] font-black uppercase">
                          {item.entitySubtype.replaceAll('_', ' ')}
                        </Badge>
                      )}
                      {item.operatorName && (
                        <Badge className="bg-slate-900/5 dark:bg-white/5 text-slate-500 dark:text-slate-300 border-none text-[8px] font-black uppercase">
                          {item.operatorName}
                        </Badge>
                      )}
                      {item.nearbyPort?.name && (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[8px] font-black uppercase">
                          Port {item.nearbyPort.name}
                        </Badge>
                      )}
                      {getDealRoomForLicense?.(item.id, item.entityKind || 'license') && (
                        <Badge
                          className="bg-violet-500/10 text-violet-600 dark:text-violet-300 border-none text-[8px] font-black uppercase max-w-full truncate"
                          title={getDealRoomForLicense(item.id, item.entityKind || 'license')?.title}
                        >
                          {t('חדר עסקאות', 'Deal room')}
                        </Badge>
                      )}
                    </div>
                    {isInDdQueue && onAddToDueDiligence && onRemoveFromDueDiligence && (
                      <div className={`mt-3 ${isSelected ? '' : 'opacity-80 group-hover:opacity-100'} transition-opacity`}>
                        <AddToDueDiligenceButton
                          compact
                          isInQueue={isInDdQueue(item.id)}
                          onAdd={() => onAddToDueDiligence(item.id)}
                          onRemove={() => onRemoveFromDueDiligence(item.id)}
                        />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={observerTarget} className="h-4" />
          </div>
        </ScrollArea>
      </motion.div>
      )}
    </div>
  );
}
