import { LucidePackage, LucideRoute } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { WorkspaceEntity } from '../../api/brokerWorkspaceApi';
import {
  dealPackHasRequiredParties,
  selectedDealPackCounts,
} from '../../lib/brokerWorkspaceRoles';

type Props = {
  entities: WorkspaceEntity[];
  selectedIds: string[];
  packLocationMode: boolean;
  canDrawRoute: boolean;
  routePending?: boolean;
  routeButtonLabel?: string;
  routeHint?: string;
  onPack: () => void;
  onAddRoute: () => void;
};

export function DealPackBuilder({
  entities,
  selectedIds,
  packLocationMode,
  canDrawRoute,
  routePending = false,
  routeButtonLabel = 'Show route on map',
  routeHint,
  onPack,
  onAddRoute,
}: Props) {
  const looseEntities = entities.filter((e) => !e.packed_into_pack_id);
  const selectedCounts = selectedDealPackCounts(looseEntities, selectedIds);
  const canPack = dealPackHasRequiredParties(looseEntities, selectedIds);
  const selectedSummary = `${selectedCounts.suppliers} suppliers · ${selectedCounts.buyers} buyers · ${selectedCounts.facilities} optional`;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Deal Pack</h3>
        <span className="rounded-full bg-slate-950/5 px-2 py-1 text-[9px] font-black uppercase text-slate-500 dark:bg-white/10">
          {selectedCounts.total} selected
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <div className={`rounded-xl border px-2 py-2 ${selectedCounts.suppliers > 0 ? 'border-emerald-500/35 bg-emerald-500/10' : 'border-dashed border-white/10'}`}>
          <p className="text-[9px] font-black uppercase text-slate-500">Supplier</p>
          <p className="text-lg font-black">{selectedCounts.suppliers}</p>
        </div>
        <div className={`rounded-xl border px-2 py-2 ${selectedCounts.buyers > 0 ? 'border-blue-500/35 bg-blue-500/10' : 'border-dashed border-white/10'}`}>
          <p className="text-[9px] font-black uppercase text-slate-500">Buyer</p>
          <p className="text-lg font-black">{selectedCounts.buyers}</p>
        </div>
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-2 py-2">
          <p className="text-[9px] font-black uppercase text-slate-500">Optional</p>
          <p className="text-lg font-black">{selectedCounts.facilities}</p>
        </div>
      </div>
      <Button
        className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold"
        disabled={!canPack || packLocationMode}
        onClick={onPack}
      >
        <LucidePackage className="w-4 h-4 mr-2" />
        {packLocationMode ? 'Click map to place package' : 'Pack selected deal'}
      </Button>
      <Button
        variant="outline"
        className="w-full"
        disabled={!canDrawRoute || routePending}
        onClick={onAddRoute}
      >
        <LucideRoute className="w-4 h-4 mr-2" />
        {routePending ? 'Showing route...' : routeButtonLabel}
      </Button>
      <p className="text-[10px] text-slate-500">
        {routeHint ?? 'Select at least one supplier and one buyer. Add ports, terminals, vessels, refineries or route stops when they matter.'} {selectedSummary}
      </p>
    </section>
  );
}
