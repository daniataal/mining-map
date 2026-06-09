import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, MapPin, Minimize2, Maximize2, Star, X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { useNearbySuppliers } from '../../lib/nearbySuppliers';
import type { NearbySupplier } from '../../lib/nearbySuppliers';
import { BUNKER_REGISTRY_HUBS, bunkerHubByLocode } from './bunkerHubs';
import type { BunkerRegistryLayout } from './useBunkerRegistryState';
import { Button } from '../../components/ui/button';

type Props = {
  layout: BunkerRegistryLayout;
  hubLocode: string | null;
  selectedSupplierId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onHubChange: (locode: string) => void;
  onLayoutChange: (layout: BunkerRegistryLayout) => void;
  onClose: () => void;
  onSelectSupplier: (supplier: NearbySupplier) => void;
  onOpenDossier: (supplier: NearbySupplier) => void;
};

const WATCHLIST_KEY = 'bunker_registry_watchlist';
const MAX_COMPARE = 3;

function readWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function toggleWatchlist(locode: string): string[] {
  const current = readWatchlist();
  const next = current.includes(locode)
    ? current.filter((id) => id !== locode)
    : [...current, locode];
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  return next;
}

function CompareField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p className="text-[10px] text-slate-400">
      <span className="font-semibold text-slate-500">{label}: </span>
      {value}
    </p>
  );
}

export default function BunkerSupplierRegistryShell({
  layout,
  hubLocode,
  selectedSupplierId,
  search,
  onSearchChange,
  onHubChange,
  onLayoutChange,
  onClose,
  onSelectSupplier,
  onOpenDossier,
}: Props) {
  const { t } = useI18n();
  const activeHub = bunkerHubByLocode(hubLocode) ?? BUNKER_REGISTRY_HUBS[0];
  const { data, isLoading } = useNearbySuppliers(null, true, activeHub.locode, 200);
  const [watchlist, setWatchlist] = useState<string[]>(() => readWatchlist());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const suppliers = useMemo(() => {
    const rows = data?.suppliers ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.fuels_supplied ?? '').toLowerCase().includes(q) ||
        (s.country ?? '').toLowerCase().includes(q),
    );
  }, [data?.suppliers, search]);

  const compareSuppliers = useMemo(
    () => compareIds.map((id) => suppliers.find((s) => s.id === id)).filter(Boolean) as NearbySupplier[],
    [compareIds, suppliers],
  );

  const watchedHubs = useMemo(
    () => BUNKER_REGISTRY_HUBS.filter((hub) => watchlist.includes(hub.locode)),
    [watchlist],
  );

  useEffect(() => {
    if (!selectedSupplierId) return;
    const row = rowRefs.current[selectedSupplierId];
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedSupplierId, suppliers]);

  const handleWatchToggle = (locode: string) => {
    setWatchlist(toggleWatchlist(locode));
  };

  const handleCompareToggle = (supplierId: string, checked: boolean) => {
    setCompareIds((prev) => {
      if (!checked) return prev.filter((id) => id !== supplierId);
      if (prev.includes(supplierId)) return prev;
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, supplierId];
    });
  };

  if (layout === 'closed') return null;

  return (
    <div
      className="pointer-events-auto flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-cyan-500/25 bg-slate-950/95 shadow-2xl backdrop-blur-xl"
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-cyan-300">
            {t('רשם ספקי בונקר', 'Bunker supplier registry')}
          </p>
          <h2 className="text-sm font-bold text-white">{activeHub.name}</h2>
          <p className="text-[10px] text-slate-400">
            {suppliers.length} {t('ספקים', 'suppliers')} · {activeHub.locode} ·{' '}
            {t('רשם נמל', 'port register')}
          </p>
        </div>
        <div className="flex shrink-0 gap-0.5">
          {layout === 'full' ? (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onLayoutChange('split')}>
              <Minimize2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onLayoutChange('full')}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {watchedHubs.length > 0 && (
        <div className="shrink-0 border-b border-white/5 px-3 py-2">
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-amber-400/90">
            {t('מעקב נמלים', 'Watched hubs')}
          </p>
          <div className="flex flex-wrap gap-1">
            {watchedHubs.map((hub) => (
              <button
                key={hub.locode}
                type="button"
                onClick={() => onHubChange(hub.locode)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                  hub.locode === activeHub.locode
                    ? 'bg-amber-600/30 text-amber-100'
                    : 'bg-slate-800/80 text-slate-300 hover:text-white'
                }`}
              >
                {hub.locode}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 space-y-2 border-b border-white/5 px-3 py-2">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('חיפוש ספק / דלק…', 'Search supplier or fuel…')}
          className="w-full rounded-lg border border-slate-600/50 bg-slate-900/80 px-2.5 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-500"
        />
        <div className="flex flex-wrap gap-1">
          {BUNKER_REGISTRY_HUBS.map((hub) => {
            const watched = watchlist.includes(hub.locode);
            return (
              <div key={hub.locode} className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onHubChange(hub.locode)}
                  className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                    hub.locode === activeHub.locode
                      ? 'bg-cyan-600/30 text-cyan-100'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {hub.locode}
                </button>
                <button
                  type="button"
                  aria-label={t('מעקב נמל', 'Watch hub')}
                  onClick={() => handleWatchToggle(hub.locode)}
                  className={`rounded p-0.5 ${watched ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                >
                  <Star className={`h-3 w-3 ${watched ? 'fill-amber-400' : ''}`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading && (
          <li className="px-2 py-4 text-center text-[11px] text-slate-500">
            {t('טוען…', 'Loading…')}
          </li>
        )}
        {!isLoading && suppliers.length === 0 && (
          <li className="px-2 py-4 text-center text-[11px] text-slate-500">
            {t('אין ספקים להצגה', 'No suppliers to show')}
          </li>
        )}
        {suppliers.map((supplier) => (
          <li
            key={supplier.id}
            ref={(el) => {
              rowRefs.current[supplier.id] = el;
            }}
          >
            <div
              className={`mb-1 flex gap-2 rounded-lg border px-2 py-2 transition-colors ${
                selectedSupplierId === supplier.id
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-transparent bg-slate-900/40 hover:bg-slate-800/60'
              }`}
            >
              <input
                type="checkbox"
                className="mt-1 h-3.5 w-3.5 shrink-0 accent-cyan-500"
                checked={compareIds.includes(supplier.id)}
                disabled={!compareIds.includes(supplier.id) && compareIds.length >= MAX_COMPARE}
                onChange={(e) => handleCompareToggle(supplier.id, e.target.checked)}
                aria-label={t('השווה ספק', 'Compare supplier')}
              />
              <button
                type="button"
                onClick={() => onSelectSupplier(supplier)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-[12px] font-semibold text-slate-100">{supplier.name}</p>
                {supplier.fuels_supplied && (
                  <p className="text-[10px] text-slate-400">{supplier.fuels_supplied}</p>
                )}
                {supplier.geocode_tier && (
                  <p className="text-[9px] uppercase tracking-wide text-slate-500">
                    {supplier.geocode_tier.replace(/_/g, ' ')}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-cyan-400">
                    <MapPin className="h-3 w-3" />
                    {t('הצג במפה', 'Show on map')}
                  </span>
                  <button
                    type="button"
                    className="text-[10px] text-slate-400 underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDossier(supplier);
                    }}
                  >
                    {t('פתח תיק', 'Open dossier')}
                  </button>
                  {supplier.source_url && (
                    <a
                      href={supplier.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-[10px] text-amber-500"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t('מקור', 'Source')}
                    </a>
                  )}
                </div>
              </button>
            </div>
          </li>
        ))}
      </ul>

      {compareSuppliers.length >= 2 && (
        <div className="shrink-0 border-t border-cyan-500/20 bg-slate-900/90 px-3 py-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-widest text-cyan-300">
              {t('השוואת ספקים', 'Supplier compare')} ({compareSuppliers.length}/{MAX_COMPARE})
            </p>
            <button
              type="button"
              className="text-[9px] text-slate-500 underline"
              onClick={() => setCompareIds([])}
            >
              {t('נקה', 'Clear')}
            </button>
          </div>
          <div className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {compareSuppliers.map((supplier) => (
              <div
                key={supplier.id}
                className="rounded-lg border border-white/10 bg-slate-950/60 p-2"
              >
                <p className="text-[11px] font-bold text-slate-100">{supplier.name}</p>
                <CompareField label={t('דלקים', 'Fuels')} value={supplier.fuels_supplied} />
                <CompareField label={t('רשות', 'Authority')} value={supplier.license_authority} />
                <CompareField label={t('איש קשר', 'Contact')} value={supplier.contact_person} />
                <CompareField
                  label={t('גיאוקוד', 'Geocode')}
                  value={supplier.geocode_tier?.replace(/_/g, ' ')}
                />
                {supplier.source_url && (
                  <a
                    href={supplier.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-0.5 text-[9px] text-amber-500"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t('מקור', 'Source')}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { toggleWatchlist, readWatchlist, WATCHLIST_KEY };
