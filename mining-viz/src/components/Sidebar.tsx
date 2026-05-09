import { useState, useEffect, useRef } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from './ui/accordion';
import { LucideSearch, LucideFilter, LucidePlus, LucideFileText, LucideDownload, LucideUpload, LucideLogOut, LucideChevronLeft, LucideMapPin } from 'lucide-react';
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
  filter, setFilter,
  selectedCommodity, setSelectedCommodity,
  selectedCountry, setSelectedCountry,
  userStatusFilter, setUserStatusFilter,
  selectedLicenseType, setSelectedLicenseType,
  commodities, countries, licenseTypes,
  setIsAddModalOpen,
  loading,
  onLogout,
  setSelectedItem,
  selectedItem,
  userAnnotations,
  error,
  onToggleCollapse
}: SidebarProps) {
  const { t, isRtl } = useI18n();
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

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [displayCount, processedData.length]);

  return (
    <div className="flex flex-col h-full bg-transparent text-slate-100 select-none">
      {/* Header */}
      <header className="p-5 border-b border-white/5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-amber-400 to-amber-600 bg-clip-text text-transparent uppercase italic">
              {t("מודיעין כריה", "Mining Intelligence")}
            </h1>
            <p className="text-[10px] text-slate-500 font-bold tracking-[0.1em] uppercase mt-0.5">
              {t("מערכת ניהול רישיונות", "Precision Mapping OS")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={onLogout} className="h-8 w-8 hover:bg-red-500/10 hover:text-red-400 text-slate-500 transition-colors">
              <LucideLogOut className="w-4 h-4" />
            </Button>
            {onToggleCollapse && (
              <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="h-8 w-8 hover:bg-white/5 text-slate-500">
                <LucideChevronLeft className={`w-4 h-4 transition-transform duration-500 ${isRtl ? 'rotate-180' : ''}`} />
              </Button>
            )}
          </div>
        </div>

        <Button 
          className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-black tracking-wide shadow-[0_0_20px_rgba(245,158,11,0.2)] transition-all active:scale-95"
          onClick={() => setIsAddModalOpen(true)}
        >
          <LucidePlus className="w-4 h-4 mr-2 stroke-[3]" />
          {t("הוסף רישיון חדש", "Add New License")}
        </Button>

        <div className="grid grid-cols-3 gap-2">
           <Button variant="outline" size="sm" className="text-[10px] px-1 border-slate-700 hover:bg-slate-800">
             <LucideUpload className="w-3 h-3 mr-1" /> {t("יבוא", "Import")}
           </Button>
           <Button variant="outline" size="sm" className="text-[10px] px-1 border-slate-700 hover:bg-slate-800">
             <LucideFileText className="w-3 h-3 mr-1" /> {t("תבנית", "Template")}
           </Button>
           <Button variant="outline" size="sm" className="text-[10px] px-1 border-slate-700 hover:bg-slate-800">
             <LucideDownload className="w-3 h-3 mr-1" /> {t("יצוא", "Export")}
           </Button>
        </div>
      </header>

      {/* Controls */}
      <div className="p-4 space-y-4">
        <div className="relative">
          <LucideSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input 
            placeholder={t("חיפוש...", "Search...")} 
            className="pl-9 bg-slate-950 border-slate-800 focus:ring-amber-500"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="filters" className="border-slate-800">
            <AccordionTrigger className="py-2 text-sm text-slate-400 hover:text-slate-200">
              <div className="flex items-center">
                <LucideFilter className="w-4 h-4 mr-2" />
                {t("מסננים מתקדמים", "Advanced Filters")}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-500">{t("מדינה", "Country")}</label>
                <MultiSelect 
                  options={countries} 
                  selected={selectedCountry} 
                  onChange={setSelectedCountry} 
                  placeholder={t("כל המדינות", "All Countries")} 
                  searchable 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-500">{t("סחורה", "Commodity")}</label>
                <MultiSelect 
                  options={commodities} 
                  selected={selectedCommodity} 
                  onChange={setSelectedCommodity} 
                  placeholder={t("כל הסחורות", "All Commodities")} 
                  searchable 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-500">{t("סוג רישיון", "License Type")}</label>
                <MultiSelect 
                  options={licenseTypes} 
                  selected={selectedLicenseType} 
                  onChange={setSelectedLicenseType} 
                  placeholder={t("כל הסוגים", "All Types")} 
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {/* List */}
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
                  transition={{ delay: index * 0.03, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                >
                  <Card 
                    className={`group cursor-pointer transition-all duration-300 border-white/5 bg-white/5 hover:bg-white/10 relative overflow-hidden
                    ${isSelected ? 'ring-1 ring-amber-500/50 border-amber-500/50 bg-amber-500/5' : ''}
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
                        <CardTitle className={`text-sm font-bold tracking-tight leading-tight ${isGold ? 'text-amber-400' : 'text-slate-200'}`}>
                          {item.company}
                        </CardTitle>
                        {isGold && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] shrink-0" />}
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-2 space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="secondary" className="text-[10px] bg-slate-800/80 hover:bg-slate-700/80 text-slate-400 border-none px-1.5 h-4 font-bold uppercase tracking-wider">
                          {item.status || 'Active'}
                        </Badge>
                        <Badge className={`text-[10px] border-none px-1.5 h-4 font-bold uppercase tracking-wider ${isGold ? 'bg-amber-500/20 text-amber-500' : 'bg-blue-500/20 text-blue-400'}`}>
                          {annotation.commodity || item.commodity || 'Unknown'}
                        </Badge>
                      </div>
                      <div className="flex items-center text-[10px] text-slate-500 font-bold uppercase tracking-wide">
                        <LucideMapPin className="w-3 h-3 mr-1 text-slate-600" />
                        {item.region} | {item.country}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
          
          <div ref={observerTarget} className="h-4" />
          
          {loading && <div className="text-center py-4 text-slate-500 text-xs">{t("טוען...", "Loading...")}</div>}
          {error && <div className="text-center py-4 text-red-500 text-xs">{error}</div>}
          {!loading && !error && processedData.length === 0 && (
            <div className="text-center py-12">
              <div className="text-slate-600 text-4xl mb-2 text-center flex justify-center">🔍</div>
              <p className="text-slate-500 text-xs">{t("לא נמצאו תוצאות", "No results found")}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
