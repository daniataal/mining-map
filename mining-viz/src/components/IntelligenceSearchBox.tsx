import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  onApplyCountryFocus: (name: string) => void;
  onCommitLicenseSearch: (query: string) => void;
};

function IntelligenceSearchBox({
  countries,
  externalFilter,
  countryFocusCountry,
  onApplyCountryFocus,
  onCommitLicenseSearch,
}: IntelligenceSearchBoxProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(externalFilter);
  const debouncedDraft = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);

  useEffect(() => {
    setDraft(externalFilter);
  }, [externalFilter]);

  useEffect(() => {
    setSuggestionsDismissed(false);
  }, [debouncedDraft]);

  useEffect(() => {
    if (countryFocusCountry) setSuggestionsDismissed(true);
  }, [countryFocusCountry]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setSuggestionsDismissed(true);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const applyCountryFocusAndClose = useCallback(
    (name: string) => {
      setSuggestionsDismissed(true);
      setDraft('');
      onApplyCountryFocus(name);
    },
    [onApplyCountryFocus],
  );

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
          applyCountryFocusAndClose(name);
        }
        return;
      }
      const exact = matchExactCountryFocusQuery(raw, countries);
      if (exact) {
        e.preventDefault();
        applyCountryFocusAndClose(exact);
        return;
      }
      const resolved = resolveCountryFocusToken(raw, countries);
      if (resolved) {
        const suggestions = suggestCountriesForFocus(raw, countries, 2);
        if (suggestions.length === 1 && suggestions[0] === resolved) {
          e.preventDefault();
          applyCountryFocusAndClose(resolved);
          return;
        }
      }
      e.preventDefault();
      setSuggestionsDismissed(true);
      onCommitLicenseSearch(raw);
    },
    [draft, countries, applyCountryFocusAndClose, onCommitLicenseSearch],
  );

  const showCountrySuggestions =
    !suggestionsDismissed &&
    countryFocusSuggestions.length > 0 &&
    !countryFocusCountry;

  return (
    <div ref={rootRef} className="relative w-80 shrink-0">
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
          aria-expanded={showCountrySuggestions}
        />
      </div>
      {showCountrySuggestions && (
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
                onClick={() => applyCountryFocusAndClose(name)}
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
    </div>
  );
}

export default memo(IntelligenceSearchBox);
