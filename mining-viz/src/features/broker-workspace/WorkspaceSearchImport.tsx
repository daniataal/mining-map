import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LucideBuilding, LucidePin, LucideSearch, LucideShip } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useDebouncedValue, SEARCH_DEBOUNCE_MS } from '../../hooks/use-debounced-value';
import { oilLiveApiUrl } from '../../api/oilLiveApi';
import { toast } from 'sonner';

type Props = {
  onImport: (hit: {
    hit_type: string;
    ref_id: string;
    display_name: string;
    lat: number;
    lng: number;
  }) => void;
};

export function WorkspaceSearchImport({ onImport }: Props) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const { data, isLoading } = useQuery({
    queryKey: ['workspace-search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return { hits: [] };
      const res = await fetch(oilLiveApiUrl(`/api/oil-live/search?q=${encodeURIComponent(debouncedQuery)}`));
      if (!res.ok) throw new Error('Search failed');
      return res.json();
    },
    enabled: debouncedQuery.trim().length > 1,
  });

  const handleImport = useCallback(
    (hit: { type: string; id: string; source: Record<string, unknown> }) => {
      const source = hit.source;
      const isVessel = hit.type === 'vessel';
      const name = String(isVessel ? source.vessel_name : source.name ?? hit.id);
      const refId = String(isVessel ? source.imo ?? hit.id : source.id ?? hit.id);
      onImport({
        hit_type: hit.type,
        ref_id: refId,
        display_name: name,
        lat: Number(source.lat ?? source.latitude ?? 0),
        lng: Number(source.lng ?? source.longitude ?? 0),
      });
      toast.success(`Imported ${name}`);
    },
    [onImport],
  );

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Search & Import</h3>
      <div className="relative">
        <LucideSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="IMO, vessel, company..."
          className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-black/10 dark:border-white/10 bg-white/50 dark:bg-slate-900/50"
        />
      </div>
      {isLoading && <p className="text-xs text-slate-500">Searching...</p>}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {(data?.hits ?? []).map((hit: { type: string; id: string; source: Record<string, unknown> }) => {
          const isVessel = hit.type === 'vessel';
          const name = String(isVessel ? hit.source.vessel_name : hit.source.name ?? hit.id);
          return (
            <div
              key={hit.id}
              className="flex items-center justify-between gap-2 p-2 rounded-lg border border-black/5 dark:border-white/5 bg-white/40 dark:bg-slate-900/40"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isVessel ? (
                  <LucideShip className="w-4 h-4 text-cyan-500 shrink-0" />
                ) : (
                  <LucideBuilding className="w-4 h-4 text-emerald-500 shrink-0" />
                )}
                <span className="text-sm font-semibold truncate">{name}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => handleImport(hit)}>
                <LucidePin className="w-3.5 h-3.5 mr-1" />
                Import
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
