import { useMemo, useState } from 'react';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import {
  Filter as LucideFilter,
  MapPin as LucideMapPin,
  RotateCcw as LucideRotateCcw,
  Search as LucideSearch,
  ClipboardList,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import {
  applyDdFilters,
  buildDdFacetOptions,
  DdFilterState,
  DdListMode,
  EMPTY_DD_FILTERS,
} from '../lib/filterLicensesForDd';
import { DdQueueEntry } from '../lib/dueDiligenceQueue';
import { MiningLicense, UserAnnotation } from '../types';
import KanbanBoard from './KanbanBoard';
import MultiSelect from './MultiSelect';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface DueDiligencePanelProps {
  allLicenses: MiningLicense[];
  queue: DdQueueEntry[];
  queueIds: Set<string>;
  notesById: Record<string, string>;
  userAnnotations: Record<string, UserAnnotation>;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  updateNote: (id: string, note: string) => void;
  onRemoveFromQueue: (id: string) => void;
  onCardClick: (item: MiningLicense) => void;
  onOpenMap?: () => void;
  isMobile?: boolean;
}

export default function DueDiligencePanel({
  allLicenses,
  queue,
  queueIds,
  notesById,
  userAnnotations,
  updateAnnotation,
  updateNote,
  onRemoveFromQueue,
  onCardClick,
  onOpenMap,
  isMobile,
}: DueDiligencePanelProps) {
  const { t } = useI18n();
  const [listMode, setListMode] = useState<DdListMode>('queue');
  const [filters, setFilters] = useState<DdFilterState>(EMPTY_DD_FILTERS);
  const debouncedSearch = useDebouncedValue(filters.search);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const licenseById = useMemo(
    () => Object.fromEntries(allLicenses.map((item) => [item.id, item])),
    [allLicenses],
  );

  const queueItems = useMemo(
    () =>
      queue
        .map((entry) => licenseById[entry.id])
        .filter((item): item is MiningLicense => Boolean(item)),
    [licenseById, queue],
  );

  const baseItems = listMode === 'queue' ? queueItems : allLicenses;
  const facets = useMemo(
    () => buildDdFacetOptions(listMode === 'queue' ? queueItems : allLicenses, userAnnotations),
    [allLicenses, listMode, queueItems, userAnnotations],
  );

  const filtersApplied = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  );

  const filteredItems = useMemo(
    () => applyDdFilters(baseItems, filtersApplied, userAnnotations, queueIds),
    [baseItems, filtersApplied, queueIds, userAnnotations],
  );

  const activeFilterCount =
    filters.countries.length +
    filters.commodities.length +
    filters.sectors.length +
    filters.statuses.length +
    filters.stages.length +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.search.trim() ? 1 : 0) +
    (filters.addedOnly ? 1 : 0);

  const resetFilters = () => setFilters(EMPTY_DD_FILTERS);
  const showEmptyQueue = listMode === 'queue' && queue.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0 pt-20 sm:pt-24 px-2 sm:px-4 pb-4 bg-white dark:bg-slate-950">
      <header className="shrink-0 space-y-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg sm:text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
              {t('בדיקת נאותות', 'Due Diligence')}
            </h1>
            <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px] font-black uppercase">
              {queue.length} {t('בתור', 'queued')}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-black/10 dark:border-white/10 p-0.5 bg-black/[0.03] dark:bg-white/[0.03]">
              <button
                type="button"
                onClick={() => setListMode('queue')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  listMode === 'queue'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t('התור שלי', 'My queue')}
              </button>
              <button
                type="button"
                onClick={() => setListMode('browse')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  listMode === 'browse'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t('עיון בכל הנכסים', 'Browse all')}
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[10px] font-black uppercase tracking-widest border-black/10 dark:border-white/10"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <LucideFilter className="w-3.5 h-3.5 mr-1.5" />
              {t('מסננים', 'Filters')}
              {activeFilterCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[9px]">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {filtersOpen && (
          <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-slate-50/80 dark:bg-slate-900/50 p-4 space-y-3">
            <div className="relative">
              <LucideSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                placeholder={t('חיפוש חברה, מדינה, סחורה…', 'Search company, country, commodity…')}
                className="w-full h-10 pl-10 pr-3 rounded-xl bg-white dark:bg-slate-950 border border-black/10 dark:border-white/10 text-sm font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              <FilterField label={t('מדינה', 'Country')}>
                <MultiSelect
                  options={facets.countries}
                  selected={filters.countries}
                  onChange={(countries) => setFilters((prev) => ({ ...prev, countries }))}
                  placeholder={t('כל המדינות', 'All countries')}
                />
              </FilterField>
              <FilterField label={t('סחורה', 'Commodity')}>
                <MultiSelect
                  options={facets.commodities}
                  selected={filters.commodities}
                  onChange={(commodities) => setFilters((prev) => ({ ...prev, commodities }))}
                  placeholder={t('כל הסחורות', 'All commodities')}
                />
              </FilterField>
              <FilterField label={t('סקטור', 'Sector')}>
                <MultiSelect
                  options={['Mining', 'Oil & Gas']}
                  selected={filters.sectors.map((s) => (s === 'oil_and_gas' ? 'Oil & Gas' : 'Mining'))}
                  onChange={(selected) => {
                    const sectors = selected.map((label) =>
                      label === 'Oil & Gas' ? 'oil_and_gas' : 'mining',
                    );
                    setFilters((prev) => ({ ...prev, sectors }));
                  }}
                  placeholder={t('כל הסקטורים', 'All sectors')}
                />
              </FilterField>
              <FilterField label={t('סטטוס רישיון', 'License status')}>
                <MultiSelect
                  options={facets.statuses}
                  selected={filters.statuses}
                  onChange={(statuses) => setFilters((prev) => ({ ...prev, statuses }))}
                  placeholder={t('כל הסטטוסים', 'All statuses')}
                />
              </FilterField>
              <FilterField label={t('שלב בדיקה', 'DD stage')}>
                <MultiSelect
                  options={facets.stages}
                  selected={filters.stages}
                  onChange={(stages) => setFilters((prev) => ({ ...prev, stages }))}
                  placeholder={t('כל השלבים', 'All stages')}
                />
              </FilterField>
              <FilterField label={t('מתאריך', 'From date')}>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg bg-white dark:bg-slate-950 border border-black/10 dark:border-white/10 text-xs font-medium"
                />
              </FilterField>
              <FilterField label={t('עד תאריך', 'To date')}>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg bg-white dark:bg-slate-950 border border-black/10 dark:border-white/10 text-xs font-medium"
                />
              </FilterField>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {listMode === 'browse' && (
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.addedOnly}
                    onChange={(e) => setFilters((prev) => ({ ...prev, addedOnly: e.target.checked }))}
                    className="rounded border-slate-400 text-amber-500 focus:ring-amber-500"
                  />
                  {t('רק פריטים שהוספתי', 'Added to my queue only')}
                </label>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  {filteredItems.length} {t('מוצגים', 'shown')}
                </span>
                {activeFilterCount > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[10px] font-black uppercase"
                    onClick={resetFilters}
                  >
                    <LucideRotateCcw className="w-3.5 h-3.5 mr-1" />
                    {t('איפוס', 'Reset')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-hidden">
        {showEmptyQueue ? (
          <EmptyQueueState onOpenMap={onOpenMap} />
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[280px] text-center px-6">
            <ClipboardList className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-4" />
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
              {t('אין התאמות למסננים', 'No items match your filters')}
            </p>
            <p className="text-xs text-slate-500 mt-2 max-w-md">
              {t('נסה לשנות מסננים או לעבור לעיון בכל הנכסים', 'Try adjusting filters or switch to Browse all')}
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-4" onClick={resetFilters}>
              {t('איפוס מסננים', 'Clear filters')}
            </Button>
          </div>
        ) : (
          <KanbanBoard
            processedData={filteredItems}
            userAnnotations={userAnnotations}
            updateAnnotation={updateAnnotation}
            onCardClick={onCardClick}
            isMobile={isMobile}
            queueIds={queueIds}
            notesById={notesById}
            onNoteChange={updateNote}
            onRemoveFromQueue={onRemoveFromQueue}
          />
        )}
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function EmptyQueueState({ onOpenMap }: { onOpenMap?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[360px] text-center px-6 max-w-lg mx-auto">
      <div className="w-20 h-20 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-6">
        <ClipboardList className="w-10 h-10 text-amber-500" />
      </div>
      <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic mb-2">
        {t('התור שלך ריק', 'Your queue is empty')}
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
        {t(
          'הוסף נכסים מתוצאות החיות בצד, מלחיצה על נקודה במפה, או מכרטיס הנכס — ואז חזור לכאן לנהל את בדיקת הנאותות.',
          'Add assets from Live Results on the left, by clicking a point on the map, or from the dossier — then return here to run your diligence workflow.',
        )}
      </p>
      <ol className="text-left text-xs text-slate-500 space-y-2 mb-8 w-full max-w-sm">
        <li className="flex gap-2">
          <span className="font-black text-amber-500">1.</span>
          {t('בחר נכס ברשימת התוצאות', 'Pick an asset in Live Results')}
        </li>
        <li className="flex gap-2">
          <span className="font-black text-amber-500">2.</span>
          {t('לחץ "הוסף לבדיקת נאותות"', 'Tap Add to Due Diligence')}
        </li>
        <li className="flex gap-2">
          <span className="font-black text-amber-500">3.</span>
          {t('גרור בין שלבי הקנבן', 'Move cards across kanban stages')}
        </li>
      </ol>
      {onOpenMap && (
        <Button
          type="button"
          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black uppercase tracking-widest text-[10px] h-11 px-6"
          onClick={onOpenMap}
        >
          <LucideMapPin className="w-4 h-4 mr-2" />
          {t('פתח מפה להוספה', 'Open map to add')}
        </Button>
      )}
    </div>
  );
}
