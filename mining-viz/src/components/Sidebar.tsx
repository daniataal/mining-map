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
  LayoutGrid as LucideLayoutGrid,
  Layers as LucideLayers,
  Settings as LucideSettings,
  Pin as LucidePin,
  PieChart as LucidePieChart
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface SidebarProps {
  processedData: MiningLicense[];
  setIsAddModalOpen: (val: boolean) => void;
  loading: boolean;
  onLogout: () => void;
  userAnnotations: Record<string, UserAnnotation>;
  selectedItem: MiningLicense | null;
  setSelectedItem: (item: MiningLicense) => void;
  viewMode: 'map' | 'pipeline' | 'admin' | 'dashboard';
  setViewMode: (mode: 'map' | 'pipeline' | 'admin' | 'dashboard') => void;
  onToggleFilter: () => void;
  onToggleAdmin: () => void;
  isFilterOpen: boolean;
  isPinned: boolean;
  setIsPinned: (val: boolean) => void;
  isCollapsed: boolean;
}

export default function Sidebar({
  processedData,
  loading,
  onLogout,
  setSelectedItem,
  selectedItem,
  userAnnotations,
  setIsAddModalOpen,
  viewMode,
  setViewMode,
  onToggleFilter,
  onToggleAdmin,
  isFilterOpen,
  isPinned,
  setIsPinned,
  isCollapsed
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
          onClick={() => setViewMode('map')}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 border
          ${viewMode === 'map' 
            ? 'bg-amber-500/20 text-amber-500 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.1)]' 
            : 'text-slate-400 dark:text-slate-500 border-transparent hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          <LucideMapPin className="w-5 h-5" />
        </button>
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
          onClick={() => setViewMode('pipeline')}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 border
          ${viewMode === 'pipeline' 
            ? 'bg-amber-500/20 text-amber-500 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.1)]' 
            : 'text-slate-400 dark:text-slate-500 border-transparent hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          <LucideLayoutGrid className="w-5 h-5" />
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
               <Button 
                 size="icon" 
                 variant="ghost" 
                 className="h-8 w-8 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg transition-all active:scale-95"
                 onClick={() => setIsAddModalOpen(true)}
               >
                 <LucidePlus className="w-4 h-4 stroke-[3]" />
               </Button>
            </div>
          </header>

          <ScrollArea className="min-h-0 flex-1 overflow-hidden">
            <div className="p-3 space-y-2">
            <AnimatePresence mode="popLayout">
              {processedData.slice(0, displayCount).map((item) => {
                const annotation = userAnnotations[item.id] || {};
                const isSelected = selectedItem?.id === item.id;

                return (
                  <motion.div
                    key={item.id}
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
