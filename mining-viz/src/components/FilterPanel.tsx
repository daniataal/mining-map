import { useI18n } from '../lib/i18n';
import MultiSelect from './MultiSelect';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { LucideFilter, LucideRotateCcw, LucideX } from 'lucide-react';
import { motion } from 'framer-motion';

interface FilterPanelProps {
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
  isOpen: boolean;
  onClose: () => void;
}

export default function FilterPanel({
  selectedCommodity, setSelectedCommodity,
  selectedCountry, setSelectedCountry,
  userStatusFilter, setUserStatusFilter,
  selectedLicenseType, setSelectedLicenseType,
  commodities, countries, licenseTypes,
  isOpen, onClose
}: FilterPanelProps) {
  const { t } = useI18n();

  const resetFilters = () => {
    setSelectedCommodity([]);
    setSelectedCountry([]);
    setUserStatusFilter([]);
    setSelectedLicenseType([]);
  };

  const activeCount = selectedCommodity.length + selectedCountry.length + userStatusFilter.length + selectedLicenseType.length;

  return (
    <motion.div
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: isOpen ? 0 : 400, opacity: isOpen ? 1 : 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className={`fixed top-4 bottom-4 right-4 w-80 bg-slate-950/80 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-2xl z-40 flex flex-col overflow-hidden ${!isOpen && 'pointer-events-none'}`}
    >
      <header className="p-5 border-b border-white/5 flex items-center justify-between bg-white/5">
        <div className="flex items-center gap-2">
          <LucideFilter className="w-4 h-4 text-amber-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-200">{t("מסנני רישיון", "License Filters")}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-slate-500 hover:text-white">
          <LucideX className="w-4 h-4" />
        </Button>
      </header>

      <ScrollArea className="flex-1 px-5">
        <div className="py-6 space-y-8">
          <section className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t("סחורה", "Commodity Type")}</label>
            <MultiSelect
              options={commodities}
              selected={selectedCommodity}
              onChange={setSelectedCommodity}
              placeholder={t("כל הסחורות", "All Commodities")}
              searchable
            />
          </section>

          <section className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t("מדינה", "Country Area")}</label>
            <MultiSelect
              options={countries}
              selected={selectedCountry}
              onChange={setSelectedCountry}
              placeholder={t("כל המדינות", "All Countries")}
              searchable
            />
          </section>

          <section className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t("סוג רישיון", "License Class")}</label>
            <MultiSelect
              options={licenseTypes}
              selected={selectedLicenseType}
              onChange={setSelectedLicenseType}
              placeholder={t("כל הסוגים", "All Types")}
              searchable
            />
          </section>

          <section className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t("סטטוס אישי", "Intelligence Status")}</label>
            <MultiSelect
              options={['good', 'maybe', 'bad', 'unmarked']}
              selected={userStatusFilter}
              onChange={setUserStatusFilter}
              placeholder={t("כל הסטטוסים", "All Statuses")}
            />
          </section>
        </div>
      </ScrollArea>

      <footer className="p-5 border-t border-white/5 bg-white/5 flex gap-3">
        <Button 
          variant="outline" 
          className="flex-1 h-10 border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-white/5"
          onClick={resetFilters}
        >
          <LucideRotateCcw className="w-3 h-3 mr-2" />
          {t("איפוס", "Reset")}
        </Button>
        <Button 
          className="flex-1 h-10 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black uppercase tracking-widest text-[10px] shadow-[0_0_15px_rgba(245,158,11,0.2)]"
          onClick={onClose}
        >
          {t("החל", "Apply")}
        </Button>
      </footer>
    </motion.div>
  );
}
