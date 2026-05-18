import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { Input } from '../../components/ui/input';
import { filterRouteCountries } from './routeCountryData';

interface RouteCountryComboboxProps {
  value: string;
  onChange: (country: string | undefined) => void;
  placeholder?: string;
  requireHighlight?: boolean;
}

export default function RouteCountryCombobox({
  value,
  onChange,
  placeholder,
  requireHighlight = false,
}: RouteCountryComboboxProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const rootRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => filterRouteCountries(debouncedSearch), [debouncedSearch]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const displayLabel = value || placeholder || t('בחר מדינה...', 'Select country...');

  return (
    <div ref={rootRef} className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-full items-center justify-between rounded-xl border px-3 text-xs font-semibold border-black/10 bg-white dark:border-white/10 dark:bg-slate-950 ${
          requireHighlight && !value ? 'border-amber-500/60' : ''
        }`}
      >
        <span className={`truncate ${value ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>
          {displayLabel}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-[1200] mt-1 overflow-hidden rounded-xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950"
          role="listbox"
        >
          <div className="relative border-b border-black/5 p-2 dark:border-white/10">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('חפש מדינה...', 'Search country...')}
              className="h-8 pl-8 text-xs border-black/10 dark:border-white/10"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto p-1 custom-scrollbar">
            <li>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-500 hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                  setSearch('');
                }}
              >
                {t('ללא / לא ידוע', 'Not set')}
              </button>
            </li>
            {options.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  className={`w-full rounded-lg px-3 py-2 text-left text-xs truncate hover:bg-amber-500/10 ${
                    c === value
                      ? 'bg-amber-500/15 font-bold text-amber-700 dark:text-amber-300'
                      : 'text-slate-800 dark:text-slate-200'
                  }`}
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  {c}
                </button>
              </li>
            ))}
            {options.length === 0 && (
              <li className="px-3 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {t('אין תוצאות', 'No results')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}