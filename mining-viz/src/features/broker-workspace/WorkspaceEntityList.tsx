import { LucideTrash2 } from 'lucide-react';
import { STAGE_BADGE_COLORS, normalizeDealStage } from '../../lib/dealWorkflow';
import type { WorkspaceEntity } from '../../api/brokerWorkspaceApi';

type Props = {
  entities: WorkspaceEntity[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onRemove: (id: string) => void;
};

const signalDot: Record<string, string> = {
  good: 'bg-emerald-500',
  maybe: 'bg-amber-500',
  bad: 'bg-red-500',
};

export function WorkspaceEntityList({ entities, selectedIds, onToggleSelect, onRemove }: Props) {
  const loose = entities.filter((e) => !e.packed_into_pack_id);
  if (loose.length === 0) {
    return (
      <p className="text-sm text-slate-500 text-center py-4 border border-dashed rounded-xl">
        No entities on map. Import from search or add from dossier.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {loose.map((e) => {
        const stage = normalizeDealStage(e.dd_stage);
        const selected = selectedIds.includes(e.id);
        return (
          <div
            key={e.id}
            className={`flex items-center gap-2 p-2 rounded-lg border ${
              selected ? 'border-amber-500/50 bg-amber-500/10' : 'border-black/5 dark:border-white/5'
            }`}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(e.id)}
              className="shrink-0"
            />
            <div className={`w-2 h-2 rounded-full shrink-0 ${signalDot[e.deal_signal] ?? 'bg-slate-400'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{e.display_name}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">
                {e.entity_type}
                {e.in_dd_queue && ' · DD'}
              </p>
              <span className={`inline-block mt-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${STAGE_BADGE_COLORS[stage]}`}>
                {stage}
              </span>
            </div>
            <button type="button" onClick={() => onRemove(e.id)} className="p-1 text-slate-400 hover:text-red-500">
              <LucideTrash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
