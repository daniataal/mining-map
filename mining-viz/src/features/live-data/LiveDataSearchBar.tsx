import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Building2, Loader2, Package, Search as SearchIcon, Ship, Warehouse } from 'lucide-react';
import {
  getOilLiveSearch,
  type OilLiveSearchEntityType,
  type OilLiveSearchHit,
  type OilLiveSearchResponse,
} from '../../api/oilLiveApi';

/**
 * Safe, no-throw translation helper. The hook-based useI18n() throws when
 * there's no provider, which is awkward inside tests; this function falls
 * back to English when localStorage isn't accessible (e.g. SSR / test env).
 */
function tShort(he: string, en: string): string {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      return localStorage.getItem('app_lang') === 'he' ? he : en;
    }
  } catch {
    /* ignore — fall through to English */
  }
  return en;
}

const DEBOUNCE_MS = 300;
const DEFAULT_LIMIT = 10;

/** Pretty label for each result group, in the same order the dropdown
 *  surfaces them. Order = priority when grouping hits. */
const GROUP_ORDER: OilLiveSearchEntityType[] = ['cargo', 'company', 'terminal', 'vessel'];

const GROUP_LABEL: Record<OilLiveSearchEntityType, [string, string]> = {
  cargo: ['מטען', 'Cargo'],
  company: ['חברות', 'Companies'],
  terminal: ['מסופים', 'Terminals'],
  vessel: ['מכליות', 'Vessels'],
};

const GROUP_ICON: Record<OilLiveSearchEntityType, React.ComponentType<{ className?: string }>> = {
  cargo: Package,
  company: Building2,
  terminal: Warehouse,
  vessel: Ship,
};

export type LiveDataSearchHitClick = {
  type: OilLiveSearchEntityType;
  id: string;
  title: string;
  subtitle?: string;
  lat?: number;
  lng?: number;
};

/** Extract map fly target from Elasticsearch _source (cargo corridor or terminal location). */
export function hitFlyCoords(hit: OilLiveSearchHit): { lat: number; lng: number } | null {
  const s = hit.source || {};
  const load = s.corridor_load as { lat?: number; lon?: number; lng?: number } | undefined;
  if (load && typeof load.lat === 'number') {
    const lng = load.lon ?? load.lng;
    if (typeof lng === 'number') return { lat: load.lat, lng };
  }
  const disc = s.corridor_discharge as { lat?: number; lon?: number; lng?: number } | undefined;
  if (disc && typeof disc.lat === 'number') {
    const lng = disc.lon ?? disc.lng;
    if (typeof lng === 'number') return { lat: disc.lat, lng };
  }
  const loc = s.location as { lat?: number; lon?: number; lng?: number } | undefined;
  if (loc && typeof loc.lat === 'number') {
    const lng = loc.lon ?? loc.lng;
    if (typeof lng === 'number') return { lat: loc.lat, lng };
  }
  if (typeof s.lat === 'number' && typeof s.lng === 'number') {
    return { lat: s.lat as number, lng: s.lng as number };
  }
  return null;
}

export interface LiveDataSearchBarProps {
  /** Called when the user clicks a hit (or presses Enter on the first one). */
  onHitClick: (hit: LiveDataSearchHitClick) => void;
  /** Optional fetcher override (tests inject a stub fetch). */
  searchFn?: (q: string) => Promise<OilLiveSearchResponse>;
  /** Restrict the dropdown to specific types (default = all four). */
  types?: OilLiveSearchEntityType[];
  /** Max results to request from the API. */
  limit?: number;
  /** Optional className for the wrapping div. */
  className?: string;
}

/**
 * Small debounced search input that hits `/api/oil-live/search` and renders
 * a grouped dropdown of results. Built to never break the panel: when
 * Elasticsearch is unavailable the dropdown shows "Search unavailable"
 * inline; on network errors the dropdown shows "No results".
 *
 * Keyboard:
 *   - Esc closes the dropdown.
 *   - Enter opens the first hit (when there is one).
 */
export default function LiveDataSearchBar({
  onHitClick,
  searchFn,
  types,
  limit = DEFAULT_LIMIT,
  className = '',
}: LiveDataSearchBarProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<OilLiveSearchHit[]>([]);
  const [errorState, setErrorState] = useState<'none' | 'unavailable'>('none');
  const [touched, setTouched] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const requestSeq = useRef(0);
  const listboxId = useId();

  const fetcher = useMemo(() => {
    if (searchFn) return searchFn;
    return (q: string) => getOilLiveSearch({ q, types, limit });
  }, [searchFn, types, limit]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) {
      setHits([]);
      setErrorState('none');
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setErrorState('none');
    fetcher(debouncedQuery)
      .then((res) => {
        if (seq !== requestSeq.current) return;
        if (res.error === 'search_unavailable') {
          setHits([]);
          setErrorState('unavailable');
        } else {
          setHits(Array.isArray(res.hits) ? res.hits : []);
          setErrorState('none');
        }
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setHits([]);
        setErrorState('unavailable');
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setLoading(false);
      });
  }, [debouncedQuery, fetcher]);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<OilLiveSearchEntityType, OilLiveSearchHit[]>();
    for (const hit of hits) {
      const arr = map.get(hit.type) ?? [];
      arr.push(hit);
      map.set(hit.type, arr);
    }
    return GROUP_ORDER.map((key) => ({ key, hits: map.get(key) ?? [] })).filter(
      (g) => g.hits.length > 0,
    );
  }, [hits]);

  const firstHit = hits.length > 0 ? hits[0] : null;

  const handleSelect = useCallback(
    (hit: OilLiveSearchHit) => {
      const fly = hitFlyCoords(hit);
      onHitClick({
        type: hit.type,
        id: hit.id,
        title: hitTitle(hit),
        subtitle: hitSubtitle(hit) || undefined,
        lat: fly?.lat,
        lng: fly?.lng,
      });
      setOpen(false);
    },
    [onHitClick],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key === 'Enter' && firstHit) {
        e.preventDefault();
        handleSelect(firstHit);
      }
    },
    [firstHit, handleSelect],
  );

  const showDropdown =
    open && touched && (loading || hits.length > 0 || errorState === 'unavailable' || (!!debouncedQuery && !loading));

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <label className="sr-only" htmlFor={`${listboxId}-input`}>
        {tShort('חיפוש', 'Search')}
      </label>
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        <input
          id={`${listboxId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setTouched(true);
          }}
          onFocus={() => {
            setOpen(true);
            setTouched(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={tShort(
            'חיפוש מטענים, חברות, מסופים, מכליות…',
            'Search cargo, companies, terminals, vessels…',
          )}
          className="w-full pl-8 pr-9 py-2 rounded-lg border border-black/10 dark:border-white/10 text-xs bg-white dark:bg-slate-900"
          data-testid="live-data-search-input"
        />
        {loading && (
          <Loader2
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-slate-400"
            aria-label={tShort('טוען…', 'Loading…')}
          />
        )}
      </div>
      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-80 overflow-y-auto rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl"
          data-testid="live-data-search-dropdown"
        >
          {errorState === 'unavailable' && (
            <p
              data-testid="live-data-search-unavailable"
              className="px-3 py-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
            >
              {tShort('החיפוש לא זמין', 'Search unavailable')}
            </p>
          )}
          {errorState === 'none' && !loading && hits.length === 0 && !!debouncedQuery && (
            <p
              data-testid="live-data-search-empty"
              className="px-3 py-2.5 text-xs text-slate-500"
            >
              {tShort('אין תוצאות', 'No results')}
            </p>
          )}
          {grouped.map((group) => {
            const Icon = GROUP_ICON[group.key];
            const [he, en] = GROUP_LABEL[group.key];
            return (
              <div key={group.key} className="py-1">
                <p className="px-3 pt-1 pb-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                  {tShort(he, en)} · {group.hits.length}
                </p>
                <ul>
                  {group.hits.map((hit) => (
                    <li key={`${hit.type}-${hit.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => handleSelect(hit)}
                        className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                        data-testid={`live-data-search-hit-${hit.type}`}
                      >
                        <Icon className="mt-0.5 w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-slate-900 dark:text-white truncate">
                            {hitTitle(hit)}
                          </span>
                          {hitSubtitle(hit) && (
                            <span className="block text-[10px] text-slate-500 truncate">
                              {hitSubtitle(hit)}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                          {hit.score.toFixed(1)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Extract a sensible "display title" from a hit's `_source`. */
export function hitTitle(hit: OilLiveSearchHit): string {
  const src = hit.source ?? {};
  switch (hit.type) {
    case 'cargo': {
      const synthetic = stringField(src, 'synthetic_bol_id');
      const shipper = stringField(src, 'shipper_name');
      const consignee = stringField(src, 'consignee_name');
      const commodity = stringField(src, 'commodity_family') || stringField(src, 'commodity_description');
      if (shipper && consignee) return `${shipper} → ${consignee}`;
      if (synthetic) return synthetic;
      if (commodity) return commodity;
      return hit.id;
    }
    case 'company':
      return stringField(src, 'name') || hit.id;
    case 'terminal':
      return stringField(src, 'name') || hit.id;
    case 'vessel':
      return stringField(src, 'name') || stringField(src, 'imo') || hit.id;
  }
}

/** Smaller line under the title (country / commodity / etc). */
export function hitSubtitle(hit: OilLiveSearchHit): string {
  const src = hit.source ?? {};
  switch (hit.type) {
    case 'cargo': {
      const fam = stringField(src, 'commodity_family');
      const country = stringField(src, 'load_country') || stringField(src, 'discharge_country');
      return [fam, country].filter(Boolean).join(' · ');
    }
    case 'company':
      return stringField(src, 'country');
    case 'terminal': {
      const country = stringField(src, 'country');
      const operator = stringField(src, 'operator_name');
      return [operator, country].filter(Boolean).join(' · ');
    }
    case 'vessel': {
      const klass = stringField(src, 'tanker_class');
      const flag = stringField(src, 'flag');
      return [klass, flag].filter(Boolean).join(' · ');
    }
  }
}

function stringField(src: Record<string, unknown>, key: string): string {
  const v = src[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}
