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
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 select-none">
      {/* Header */}
      <header className="p-4 border-b border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-amber-500">
              {t("מודיעין כריה", "Mining Intelligence")}
            </h1>
            <p className="text-xs text-slate-400 font-medium">
              {t("מערכת ניהול רישיונות", "License Management System")}
            </p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={onLogout} title={t("התנתק", "Logout")}>
              <LucideLogOut className="w-4 h-4 text-slate-400 hover:text-red-400" />
            </Button>
            {onToggleCollapse && (
              <Button variant="ghost" size="icon" onClick={onToggleCollapse}>
                <LucideChevronLeft className={`w-4 h-4 transition-transform ${isRtl ? 'rotate-180' : ''}`} />
              </Button>
            )}
          </div>
        </div>

        <Button 
          className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold"
          onClick={() => setIsAddModalOpen(true)}
        >
          <LucidePlus className="w-4 h-4 mr-2" />
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
        <div className="space-y-3 pb-4">
          {processedData.slice(0, displayCount).map((item) => {
            const annotation = userAnnotations[item.id] || {};
            const isSelected = selectedItem?.id === item.id;
            const isGold = item.commodity?.toLowerCase().includes('gold') || annotation.commodity?.toLowerCase().includes('gold');

            return (
              <Card 
                key={item.id}
                className={`cursor-pointer transition-all border-slate-800 bg-slate-900/50 hover:bg-slate-800 
                ${isSelected ? 'ring-2 ring-amber-500 border-transparent bg-slate-800' : ''}
                ${isGold ? 'border-amber-900/50' : ''}`}
                onClick={() => setSelectedItem(item)}
              >
                <CardHeader className="p-3 pb-0">
                  <div className="flex justify-between items-start">
                    <CardTitle className={`text-sm font-bold ${isGold ? 'text-amber-400' : 'text-slate-200'}`}>
                      {item.company}
                    </CardTitle>
                    {isGold && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]" />}
                  </div>
                </CardHeader>
                <CardContent className="p-3 pt-2 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 border-none">
                      {item.status || 'Active'}
                    </Badge>
                    <Badge className={`text-[10px] border-none ${isGold ? 'bg-amber-500/20 text-amber-500' : 'bg-blue-500/20 text-blue-400'}`}>
                      {annotation.commodity || item.commodity || 'Unknown'}
                    </Badge>
                  </div>
                  <div className="flex items-center text-[11px] text-slate-500 font-medium">
                    <LucideMapPin className="w-3 h-3 mr-1" />
                    {item.region} | {item.country}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          
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
