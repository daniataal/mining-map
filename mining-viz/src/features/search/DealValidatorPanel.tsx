import { useState, useCallback } from 'react';
import { LucideSearch, LucideShieldAlert, LucideShieldCheck, LucidePin, LucideBuilding, LucideShip } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue, SEARCH_DEBOUNCE_MS } from '../../hooks/use-debounced-value';

export function DealValidatorPanel() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const { data, isLoading } = useQuery({
    queryKey: ['deal-search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return { hits: [] };
      const res = await fetch(`/api/oil-live/search?q=${encodeURIComponent(debouncedQuery)}`);
      if (!res.ok) throw new Error('Search failed');
      return res.json();
    },
    enabled: debouncedQuery.trim().length > 1,
  });

  const handlePin = useCallback((hit: any) => {
    // Stub implementation to demonstrate functionality
    window.alert(`Pinned ${hit.source.name || hit.source.vessel_name} to Workspace!`);
  }, []);

  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col items-center pt-32 overflow-y-auto px-4">
      <div className="w-full max-w-2xl flex flex-col items-center">
        <h1 className="text-4xl font-black text-slate-100 tracking-tight mb-8">
          Deal <span className="text-amber-500">Validator</span>
        </h1>
        
        <div className="w-full relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <LucideSearch className="h-6 w-6 text-slate-400" />
          </div>
          <input
            type="text"
            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all shadow-2xl"
            placeholder="Search IMO number, vessel name, or company..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {isLoading && (
          <div className="mt-12 text-slate-500 flex flex-col items-center gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
            <p>Scanning intelligence graph...</p>
          </div>
        )}

        {data?.hits && data.hits.length > 0 && (
          <div className="w-full mt-12 flex flex-col gap-4 pb-20">
            {data.hits.map((hit: any) => {
              const source = hit.source;
              const isVessel = hit.type === 'vessel';
              const name = isVessel ? source.vessel_name : source.name;
              
              // Dummy logic for red/green flags
              const hasRedFlag = isVessel ? (source.sanctioned || source.dark_activity_flag) : source.sanctioned;

              return (
                <div key={hit.id} className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/10 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${hasRedFlag ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {isVessel ? <LucideShip className="w-6 h-6" /> : <LucideBuilding className="w-6 h-6" />}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                        {name}
                        {hasRedFlag ? (
                          <LucideShieldAlert className="w-5 h-5 text-red-500" />
                        ) : (
                          <LucideShieldCheck className="w-5 h-5 text-emerald-500" />
                        )}
                      </h3>
                      <p className="text-slate-400 text-sm mt-1">
                        {isVessel ? `IMO: ${source.imo}` : `Location: ${source.country || 'Unknown'}`}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    className="border-amber-500/20 text-amber-500 hover:bg-amber-500/10 shrink-0"
                    onClick={() => handlePin(hit)}
                  >
                    <LucidePin className="w-4 h-4 mr-2" />
                    Pin to Workspace
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {debouncedQuery.trim().length > 1 && !isLoading && (!data?.hits || data.hits.length === 0) && (
          <div className="mt-12 text-slate-500 text-center">
            <LucideSearch className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No verified intelligence found for "{debouncedQuery}".</p>
            <p className="text-sm mt-2 opacity-75">Proceed with extreme caution.</p>
          </div>
        )}
      </div>
    </div>
  );
}
