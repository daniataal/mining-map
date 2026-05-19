import { memo, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { LucideSearch } from 'lucide-react';
import { useDebouncedValue, SEARCH_DEBOUNCE_MS } from '../hooks/use-debounced-value';
import {
  matchExactCountryFocusQuery,
  resolveCountryFocusToken,
  suggestCountriesForFocus,
  tryParseCountryColonQuery,
} from '../lib/countryFocusMatch';
import { useI18n } from '../lib/i18n';

const COUNTRY_SUGGESTION_LIMIT = 20;

type IntelligenceSearchBoxProps = {
  countries: readonly string[];
  externalFilter: string;
  countryFocusCountry: string | null;
  autoFocusCountryOnEnter: boolean;
  onAutoFocusCountryOnEnterChange: (checked: boolean) => void;
  onApplyCountryFocus: (name: string) => void;
  onCommitLicenseSearch: (query: string) => void;
};

function IntelligenceSearchBox({
  countries,
  externalFilter,
  countryFocusCountry,
  autoFocusCountryOnEnter,
  onAutoFocusCountryOnEnterChange,
  onApplyCountryFocus,
  onCommitLicenseSearch,
}: IntelligenceSearchBoxProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(externalFilter);
  const debouncedDraft = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    setDraft(externalFilter);
  }, [externalFilter]);

  const countryFocusSuggestions = useMemo(
    () =>
      countryFocusCountry || debouncedDraft.trim().length < 2
        ? []
        : suggestCountriesForFocus(debouncedDraft, countries, COUNTRY_SUGGESTION_LIMIT),
    [debouncedDraft, countries, countryFocusCountry],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return;
      const raw = draft;
      const colon = tryParseCountryColonQuery(raw);
      if (colon) {
        const name = resolveCountryFocusToken(colon, countries);
        if (name) {
          e.preventDefault();
          onApplyCountryFocus(name);
        }
        return;
      }
      if (autoFocusCountryOnEnter) {
        const exact = matchExactCountryFocusQuery(raw, countries);
        if (exact) {
          e.preventDefault();
          onApplyCountryFocus(exact);
          return;
        }
      }
      e.preventDefault();
      onCommitLicenseSearch(raw);
    },
    [draft, countries, autoFocusCountryOnEnter, onApplyCountryFocus, onCommitLicenseSearch],
  );

  return (
    <div className="relative w-80 shrink-0">
      <div className="flex items-center bg-stone-100/90 dark:bg-slate-950/60 backdrop-blur-2xl border border-stone-200/90 dark:border-white/10 rounded-2xl px-4 h-12 shadow-2xl">
        <LucideSearch className="w-5 h-5 shrink-0 text-slate-500 dark:text-slate-500 mr-3" />
        <input
          type="text"
          placeholder={t(
            'חפש מודיעין… Enter לסינון · country:UAE',
            'Search intelligence hub… Enter to filter · country:UAE',
          )}
          className="bg-transparent border-none outline-none text-sm font-bold text-slate-800 dark:text-slate-200 w-full min-w-0 placeholder:text-slate-500 dark:placeholder:text-slate-600 tracking-tight"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-autocomplete="list"
          aria-expanded={countryFocusSuggestions.length > 0 && !countryFocusCountry}
        />
      </div>
      {countryFocusSuggestions.length > 0 && !countryFocusCountry && (
        <ul
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-[1200] max-h-56 overflow-y-auto rounded-xl border border-stone-200/90 bg-stone-50/98 py-1 text-left shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95"
          role="listbox"
        >
          {countryFocusSuggestions.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-slate-800 hover:bg-amber-500/15 dark:text-slate-100 dark:hover:bg-amber-500/20"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onApplyCountryFocus(name)}
              >
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                  {t('מיקוד', 'Focus')}
                </span>
                <span>{name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-1.5 flex cursor-pointer items-center gap-2 px-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
          checked={autoFocusCountryOnEnter}
          onChange={(e) => onAutoFocusCountryOnEnterChange(e.target.checked)}
        />
        {t(
          'מיקוד מפה במדינה בלחיצת Enter כשהשם תואם',
          'Focus map on country with Enter when the name matches exactly',
        )}
      </label>
    </div>
  );
}

export default memo(IntelligenceSearchBox);
