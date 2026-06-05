import { LucidePackage } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { WorkspaceEntity } from '../../api/brokerWorkspaceApi';

type Props = {
  entities: WorkspaceEntity[];
  selectedIds: string[];
  packLocationMode: boolean;
  onPack: () => void;
  onAddRoute: () => void;
};

export function DealPackBuilder({ entities, selectedIds, packLocationMode, onPack, onAddRoute }: Props) {
  const suppliers = entities.filter((e) => e.entity_type === 'supplier' && !e.packed_into_pack_id);
  const buyers = entities.filter((e) => e.entity_type === 'buyer' && !e.packed_into_pack_id);
  const canPack = selectedIds.length >= 2;

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Deal Pack</h3>
      <div className="flex gap-2 text-[10px] font-bold uppercase text-slate-500">
        <span>{suppliers.length} suppliers</span>
        <span>·</span>
        <span>{buyers.length} buyers</span>
        <span>·</span>
        <span>{selectedIds.length} selected</span>
      </div>
      <Button
        className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold"
        disabled={!canPack || packLocationMode}
        onClick={onPack}
      >
        <LucidePackage className="w-4 h-4 mr-2" />
        {packLocationMode ? 'Click map to place package' : 'Pack selected deal'}
      </Button>
      <Button variant="outline" className="w-full" disabled={selectedIds.length !== 2} onClick={onAddRoute}>
        Draw route between 2 selected
      </Button>
      <p className="text-[10px] text-slate-500">
        Select supplier + buyer (and optional route endpoints), then pack. Constituents hide from map; package pin remains.
      </p>
    </section>
  );
}
