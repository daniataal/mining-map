import { useState, useEffect, useRef } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from './ui/accordion';
import { 
  Search as LucideSearch, 
  Filter as LucideFilter, 
  Plus as LucidePlus, 
  FileText as LucideFileText, 
  Download as LucideDownload, 
  Upload as LucideUpload, 
  LogOut as LucideLogOut, 
  ChevronLeft as LucideChevronLeft, 
  MapPin as LucideMapPin,
  LayoutGrid as LucideLayoutGrid,
  Layers as LucideLayers,
  Settings as LucideSettings,
  ShieldCheck as LucideShieldCheck
} from 'lucide-react';
import MultiSelect from './MultiSelect';
import { motion, AnimatePresence } from 'framer-motion';

interface SidebarProps {
  processedData: MiningLicense[];
  filter: string;
  setFilter: (val: string) => void;
  sortBy: string;
  setSortBy: (val: any) => void;
  selectedCommodity: string[];
  setSelectedCommodity: (val: string[]) => void;
  selectedCountry: string[];
  setSelectedCountry: (val: string[]) => void;
  userStatusFilter: string[];
  setUserStatusFilter: (val: string[]) => void;
  selectedLicenseType: string[];
  setSelectedLicenseType: (val: string[]) => void;
  commodities: string[];
  countries: string[];
  licenseTypes: string[];
  setIsAddModalOpen: (val: boolean) => void;
  loading: boolean;
  onLogout: () => void;
  setSelectedItem: (item: MiningLicense) => void;
  selectedItem?: MiningLicense | null;
  userAnnotations: Record<string, UserAnnotation>;
  error?: string | null;
  onToggleCollapse?: () => void;
}

export default function Sidebar({
  processedData,
  loading,
  onLogout,
  setSelectedItem,
  selectedItem,
  userAnnotations,
  setIsAddModalOpen
}: Omit<SidebarProps, 'filter' | 'setFilter' | 'sortBy' | 'setSortBy' | 'selectedCommodity' | 'setSelectedCommodity' | 'selectedCountry' | 'setSelectedCountry' | 'userStatusFilter' | 'setUserStatusFilter' | 'selectedLicenseType' | 'setSelectedLicenseType' | 'commodities' | 'countries' | 'licenseTypes' | 'error' | 'onToggleCollapse'>) {
  const { t } = useI18n();
  const [displayCount, setDisplayCount] = useState(20);
  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDisplayCount(20);
  }, [processedData]);

  // Infinite scroll logic
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
    <div className="flex h-full bg-transparent text-slate-100 select-none">
      {/* Icon Rail (MarineTraffic style) */}
      <div className="w-16 flex-shrink-0 border-r border-white/5 flex flex-col items-center py-6 gap-6 bg-slate-950">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/20">
          <LucideMapPin className="w-5 h-5" />
        </div>
        <div className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-slate-500 transition-colors cursor-pointer">
          <LucideLayoutGrid className="w-5 h-5" />
        </div>
        <div className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-slate-500 transition-colors cursor-pointer">
          <LucideLayers className="w-5 h-5" />
        </div>
        <div className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-slate-500 transition-colors cursor-pointer">
          <LucideSettings className="w-5 h-5" />
        </div>
        <div className="mt-auto w-10 h-10 rounded-xl hover:bg-red-500/10 flex items-center justify-center text-slate-500 hover:text-red-400 transition-colors cursor-pointer" onClick={onLogout}>
          <LucideLogOut className="w-5 h-5" />
        </div>
      </div>

      {/* Results List */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="p-5 border-b border-white/5">
          <h1 className="text-sm font-black tracking-[0.2em] text-slate-500 uppercase">{t("תוצאות", "Live Results")}</h1>
          <div className="flex items-center justify-between mt-4">
             <Badge variant="outline" className="text-[10px] border-white/10 text-slate-400 bg-white/5 px-2 h-5 font-black uppercase">
                {processedData.length} {t("נמצאו", "Total Found")}
             </Badge>
             <Button 
               size="icon" 
               variant="ghost" 
               onClick={() => setIsAddModalOpen(true)}
               className="h-8 w-8 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg"
             >
               <LucidePlus className="w-4 h-4 stroke-[3]" />
             </Button>
          </div>
        </header>

        <ScrollArea className="flex-1 px-4">
          <div className="space-y-4 pb-10 pt-4">
            <AnimatePresence mode="popLayout">
              {processedData.slice(0, displayCount).map((item, index) => {
                const annotation = (userAnnotations && userAnnotations[item.id]) || {};
                const isSelected = selectedItem?.id === item.id;
                const isGold = item.commodity?.toLowerCase().includes('gold') || annotation.commodity?.toLowerCase().includes('gold');

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.01, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <Card 
                      className={`group cursor-pointer transition-all duration-300 border-white/5 bg-white/5 hover:bg-white/10 relative overflow-hidden
                      ${isSelected ? 'ring-1 ring-amber-500/50 border-amber-500/50 bg-amber-500/5 shadow-[0_0_20px_rgba(245,158,11,0.05)]' : ''}
                      ${isGold ? 'border-amber-500/20' : ''}`}
                      onClick={() => setSelectedItem(item)}
                    >
                      {/* Selected Indicator */}
                      {isSelected && (
                        <motion.div 
                          layoutId="active-indicator"
                          className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" 
                        />
                      )}

                      <CardHeader className="p-4 pb-1">
                        <div className="flex justify-between items-start gap-2">
                          <CardTitle className={`text-[13px] font-black tracking-tight leading-tight uppercase italic ${isGold ? 'text-amber-400' : 'text-slate-200'}`}>
                            {item.company}
                          </CardTitle>
                          {isGold && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] shrink-0" />}
                        </div>
                      </CardHeader>
                      <CardContent className="p-4 pt-2 space-y-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge className={`text-[9px] border-none px-1.5 h-4 font-black uppercase tracking-widest ${isGold ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-400'}`}>
                            {annotation.commodity || item.commodity || 'Unknown'}
                          </Badge>
                        </div>
                        <div className="flex items-center text-[10px] text-slate-500 font-bold uppercase tracking-wide truncate">
                          <LucideMapPin className="w-3 h-3 mr-1 text-slate-600" />
                          {item.region}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={observerTarget} className="h-4" />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
