import { ChevronDown, Search } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { Input } from '../../components/ui/input';
import type { LocationPreset } from './locationPresets';
import {
  MAX_PRESET_SEARCH_RESULTS,
  groupPresetsByKind,
  searchLocationPresets,
} from './locationPresets';

const GROUP_PREVIEW_LIMIT = 8;

interface RoutePresetPickerProps {
  presets: LocationPreset[];
  selectedLabel?: string;
  placeholder: string;
  pending?: boolean;
  disabled?: boolean;
  showBuyerGroups?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (preset: LocationPreset) => void;
  onFreePick?: () => void;
}

function RoutePresetPicker({
  presets,
  selectedLabel,
  placeholder,
  pending = false,
  disabled = false,
  showBuyerGroups = false,
  onOpenChange,
  onSelect,
  onFreePick,
}: RoutePresetPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 150);
  const rootRef = useRef<HTMLDivElement>(null);

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) {
      setSearch('');
      setExpandedGroup(null);
    }
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenState(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const groups = useMemo(
    () => groupPresetsByKind(presets, showBuyerGroups),
    [presets, showBuyerGroups],
  );

  const searchResults = useMemo(
    () => searchLocationPresets(presets, debouncedSearch, MAX_PRESET_SEARCH_RESULTS),
    [presets, debouncedSearch],
  );

  const displayLabel = selectedLabel?.trim() || placeholder;

  const pick = (preset: LocationPreset) => {
    onSelect(preset);
    setOpenState(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => setOpenState(!open)}
        className="flex h-9 w-full items-center justify-between rounded-xl border px-3 text-xs font-semibold border-black/10 bg-white dark:border-white/10 dark:bg-slate-950 disabled:opacity-60"
      >
        <span className={`truncate ${selectedLabel ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>
          {pending ? t('מעדכן רשימה...', 'Updating list...') : displayLabel}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && !pending && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-[1200] mt-1 overflow-hidden rounded-xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950"
        >
          <div className="relative border-b border-black/5 p-2 dark:border-white/10">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('חפש נמל, שדה, נכס...', 'Search port, airport, asset...')}
              className="h-8 pl-8 text-xs border-black/10 dark:border-white/10"
            />
          </div>

          <ul className="max-h-60 overflow-y-auto p-1 custom-scrollbar">
            <li>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-600 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/5"
                onClick={() => {
                  onFreePick?.();
                  setOpenState(false);
                }}
              >
                {t('מיקום חופשי / מהמפה', 'Free pick / from map')}
              </button>
            </li>

            {debouncedSearch.trim() ? (
              searchResults.length === 0 ? (
                <li className="px-3 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {t('אין תוצאות', 'No results')}
                </li>
              ) : (
                searchResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-xs truncate hover:bg-amber-500/10 text-slate-800 dark:text-slate-200"
                      onClick={() => pick(p)}
                    >
                      {p.name}
                    </button>
                  </li>
                ))
              )
            ) : (
              groups.map((group) => {
                const expanded = expandedGroup === group.key;
                const preview = group.items.slice(0, GROUP_PREVIEW_LIMIT);
                const more = group.items.length - preview.length;
                return (
                  <li key={group.key} className="mb-1">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[10px] font-black uppercase tracking-wider text-slate-600 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/5"
                      onClick={() => setExpandedGroup(expanded ? null : group.key)}
                    >
                      <span>{t(group.labelHe, group.labelEn)}</span>
                      <span className="tabular-nums text-slate-400">{group.items.length}</span>
                    </button>
                    {expanded &&
                      preview.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="ml-2 block w-[calc(100%-0.5rem)] rounded-lg px-3 py-1.5 text-left text-xs truncate hover:bg-amber-500/10 text-slate-800 dark:text-slate-200"
                          onClick={() => pick(p)}
                        >
                          {p.name}
                        </button>
                      ))}
                    {expanded && more > 0 && (
                      <p className="px-3 py-1 text-[9px] text-slate-500">
                        {t(`עוד ${more} — השתמשו בחיפוש`, `${more} more — use search`)}
                      </p>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default memo(RoutePresetPicker);
