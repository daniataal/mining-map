import { useI18n } from '../lib/i18n';
import MultiSelect from './MultiSelect';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import {
  Filter as LucideFilter,
  RotateCcw as LucideRotateCcw,
  Ship as LucideShip,
  X as LucideX,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  DEFAULT_VESSEL_FILTERS,
  VESSEL_SHIP_TYPE_OPTIONS,
  countActiveVesselFilters,
  type VesselFilters,
} from '../lib/vessels';

interface FilterPanelProps {
  selectedCommodity: string[];
  setSelectedCommodity: (val: string[]) => void;
  selectedCountry: string[];
  setSelectedCountry: (val: string[]) => void;
  userStatusFilter: string[];
  setUserStatusFilter: (val: string[]) => void;
  selectedLicenseType: string[];
  setSelectedLicenseType: (val: string[]) => void;
  selectedEntitySubtype: string[];
  setSelectedEntitySubtype: (val: string[]) => void;
  selectedSourceLabel: string[];
  setSelectedSourceLabel: (val: string[]) => void;
  selectedConfidenceBucket: string[];
  setSelectedConfidenceBucket: (val: string[]) => void;
  portLinkedOnly: boolean;
  setPortLinkedOnly: (val: boolean) => void;
  commodities: string[];
  countries: string[];
  licenseTypes: string[];
  entitySubtypes: string[];
  sourceLabels: string[];
  isOpen: boolean;
  onClose: () => void;
  /** When set, show AIS vessel layer controls in this panel. */
  maritimeSection?: {
    layerEnabled: boolean;
    onLayerEnabledChange: (enabled: boolean) => void;
    vesselFilters: VesselFilters;
    onVesselFiltersChange: (filters: VesselFilters) => void;
    prioritizePetroleum: boolean;
    onPrioritizePetroleumChange: (enabled: boolean) => void;
    showPetroleumPriority?: boolean;
  };
}

export default function FilterPanel({
  selectedCommodity, setSelectedCommodity,
  selectedCountry, setSelectedCountry,
  userStatusFilter, setUserStatusFilter,
  selectedLicenseType, setSelectedLicenseType,
  selectedEntitySubtype, setSelectedEntitySubtype,
  selectedSourceLabel, setSelectedSourceLabel,
  selectedConfidenceBucket, setSelectedConfidenceBucket,
  portLinkedOnly, setPortLinkedOnly,
  commodities, countries, licenseTypes, entitySubtypes, sourceLabels,
  isOpen, onClose,
  maritimeSection,
}: FilterPanelProps) {
  const { t } = useI18n();

  const resetFilters = () => {
    setSelectedCommodity([]);
    setSelectedCountry([]);
    setUserStatusFilter([]);
    setSelectedLicenseType([]);
    setSelectedEntitySubtype([]);
    setSelectedSourceLabel([]);
    setSelectedConfidenceBucket([]);
    setPortLinkedOnly(false);
    if (maritimeSection) {
      maritimeSection.onVesselFiltersChange(DEFAULT_VESSEL_FILTERS);
      maritimeSection.onPrioritizePetroleumChange(maritimeSection.showPetroleumPriority ?? false);
    }
  };

  const activeCount =
    selectedCommodity.length +
    selectedCountry.length +
    userStatusFilter.length +
    selectedLicenseType.length +
    selectedEntitySubtype.length +
    selectedSourceLabel.length +
    selectedConfidenceBucket.length +
    (portLinkedOnly ? 1 : 0) +
    (maritimeSection
      ? (maritimeSection.layerEnabled ? 1 : 0) + countActiveVesselFilters(maritimeSection.vesselFilters)
      : 0);

  return (
    <motion.div
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: isOpen ? 0 : 400, opacity: isOpen ? 1 : 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className={`fixed inset-0 sm:inset-auto sm:top-4 sm:bottom-4 sm:right-4 sm:w-80 bg-white/95 sm:bg-white/80 dark:bg-slate-950/95 dark:sm:bg-slate-950/80 backdrop-blur-3xl border-0 sm:border border-black/10 dark:border-white/10 sm:rounded-3xl shadow-2xl z-50 flex flex-col overflow-hidden ${!isOpen && 'pointer-events-none'}`}
    >
      <header className="p-5 border-b border-black/5 dark:border-white/5 flex items-center justify-between bg-black/5 dark:bg-white/5">
        <div className="flex items-center gap-2">
          <LucideFilter className="w-4 h-4 text-amber-500" />
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t("מסנני ישות", "Entity Filters")}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-slate-500 hover:text-white">
          <LucideX className="w-4 h-4" />
        </Button>
      </header>

      <ScrollArea className="flex-1 px-5">
        <motion.div className="py-6 space-y-8">
          {maritimeSection && (
            <section className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="flex items-center gap-2">
                <LucideShip className="h-4 w-4 text-cyan-500" />
                <label className="text-[10px] font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-400">
                  {t('שכבת כלי שיט (AIS)', 'Vessels (AIS)')}
                </label>
              </div>
              <Button
                type="button"
                variant={maritimeSection.layerEnabled ? 'default' : 'outline'}
                className={`h-10 w-full text-[10px] font-black uppercase tracking-widest ${
                  maritimeSection.layerEnabled
                    ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                    : 'border-black/10 dark:border-white/10'
                }`}
                onClick={() => maritimeSection.onLayerEnabledChange(!maritimeSection.layerEnabled)}
              >
                {maritimeSection.layerEnabled
                  ? t('כבה שכבת כלי שיט', 'Turn off vessel layer')
                  : t('הפעל שכבת כלי שיט', 'Enable vessel layer')}
              </Button>
              {maritimeSection.showPetroleumPriority && (
                <Button
                  type="button"
                  variant={maritimeSection.prioritizePetroleum ? 'default' : 'outline'}
                  className={`h-9 w-full text-[9px] font-black uppercase tracking-widest ${
                    maritimeSection.prioritizePetroleum
                      ? 'bg-amber-500/90 text-slate-950 hover:bg-amber-500'
                      : 'border-black/10 dark:border-white/10 text-slate-500'
                  }`}
                  onClick={() =>
                    maritimeSection.onPrioritizePetroleumChange(!maritimeSection.prioritizePetroleum)
                  }
                >
                  {maritimeSection.prioritizePetroleum
                    ? t('מועדף: נפט וגז (טנקרים)', 'Prioritizing oil & gas tankers')
                    : t('העדף טנקרי נפט/גז', 'Prioritize oil & gas tankers')}
                </Button>
              )}
              {maritimeSection.layerEnabled && (
                <>
                  <input
                    type="search"
                    value={maritimeSection.vesselFilters.search}
                    onChange={(e) =>
                      maritimeSection.onVesselFiltersChange({
                        ...maritimeSection.vesselFilters,
                        search: e.target.value,
                      })
                    }
                    placeholder={t('חיפוש שם, MMSI, IMO…', 'Search name, MMSI, IMO…')}
                    className="h-9 w-full rounded-xl border border-black/10 bg-white/80 px-3 text-[11px] dark:border-white/10 dark:bg-slate-950/80"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {VESSEL_SHIP_TYPE_OPTIONS.map((typeLabel) => {
                      const active = maritimeSection.vesselFilters.shipTypes.includes(typeLabel);
                      return (
                        <button
                          key={typeLabel}
                          type="button"
                          onClick={() => {
                            const next = active
                              ? maritimeSection.vesselFilters.shipTypes.filter((t) => t !== typeLabel)
                              : [...maritimeSection.vesselFilters.shipTypes, typeLabel];
                            maritimeSection.onVesselFiltersChange({
                              ...maritimeSection.vesselFilters,
                              shipTypes: next,
                            });
                          }}
                          className={`rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                            active
                              ? 'bg-cyan-500 text-slate-950'
                              : 'bg-black/5 text-slate-500 dark:bg-white/5 dark:text-slate-400'
                          }`}
                        >
                          {typeLabel}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          )}

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
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t("סוג ישות", "Entity Class")}</label>
            <MultiSelect
              options={licenseTypes}
              selected={selectedLicenseType}
              onChange={setSelectedLicenseType}
              placeholder={t("כל הסוגים", "All Types")}
              searchable
            />
          </section>

          {entitySubtypes.length > 0 && (
            <section className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                {t("תת-סוג תשתית", "Infrastructure Subtype")}
              </label>
              <MultiSelect
                options={entitySubtypes}
                selected={selectedEntitySubtype}
                onChange={setSelectedEntitySubtype}
                placeholder={t("כל התת-סוגים", "All subtypes")}
              />
            </section>
          )}

          <section className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Operation Status</label>
            <MultiSelect
              options={['Good', 'Maybe', 'Bad', 'Unmarked']}
              selected={userStatusFilter}
              onChange={setUserStatusFilter}
              placeholder="All Pipeline States"
            />
          </section>

          {sourceLabels.length > 0 && (
            <section className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                {t("מקור נתונים", "Source Provenance")}
              </label>
              <MultiSelect
                options={sourceLabels}
                selected={selectedSourceLabel}
                onChange={setSelectedSourceLabel}
                placeholder={t("כל המקורות", "All sources")}
              />
            </section>
          )}

          <section className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {t("רמת ביטחון", "Confidence Bucket")}
            </label>
            <MultiSelect
              options={['High confidence', 'Medium confidence', 'Needs review']}
              selected={selectedConfidenceBucket}
              onChange={setSelectedConfidenceBucket}
              placeholder={t("כל הרמות", "All confidence levels")}
            />
          </section>

          <section className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {t("הקשר נמל", "Port Context")}
            </label>
            <Button
              type="button"
              variant={portLinkedOnly ? 'default' : 'outline'}
              className={`w-full h-10 text-[10px] font-black uppercase tracking-widest ${
                portLinkedOnly
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950'
                  : 'border-black/10 dark:border-white/10 bg-transparent text-slate-500 dark:text-slate-400'
              }`}
              onClick={() => setPortLinkedOnly(!portLinkedOnly)}
            >
              {portLinkedOnly
                ? t("רק נכסים עם הקשר נמל", "Only assets with nearby-port context")
                : t("כלל הנכסים", "Show all assets")}
            </Button>
          </section>
        </motion.div>
      </ScrollArea>

      <footer className="p-5 border-t border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 flex gap-3">
        <Button 
          variant="outline" 
          className="flex-1 h-10 border-black/10 dark:border-white/10 bg-transparent text-slate-500 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-colors"
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
