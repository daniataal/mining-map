import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LucideBriefcase } from 'lucide-react';
import { toast } from 'sonner';
import { useBrokerWorkspaceContext } from './BrokerWorkspaceContext';
import { useWorkspaceSeed } from '../../hooks/use-workspace-seed';
import { listDueFollowups } from '../../api/brokerWorkspaceApi';
import type { MiningLicense, UserAnnotation } from '../../types';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { WorkspaceSearchImport } from './WorkspaceSearchImport';
import { WorkspaceEntityList } from './WorkspaceEntityList';
import { DealPackBuilder } from './DealPackBuilder';
import { DealPackDetailPanel } from './DealPackDetailPanel';

type Props = {
  licenses: MiningLicense[];
  userAnnotations: Record<string, UserAnnotation>;
  onAddBuyerPin?: () => void;
  sublayer?: 'suppliers' | 'buyers' | 'deal_packs';
};

export function BrokerWorkspaceShell({ licenses, userAnnotations, sublayer = 'suppliers' }: Props) {
  const bw = useBrokerWorkspaceContext();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useWorkspaceSeed(true, licenses, userAnnotations, (wsId) => {
    bw.setActiveWorkspaceId(wsId);
  });

  const dueQuery = useQuery({
    queryKey: ['broker-due-followups'],
    queryFn: listDueFollowups,
    refetchInterval: 120_000,
  });

  useEffect(() => {
    const due = dueQuery.data?.followups ?? [];
    for (const f of due) {
      toast.info(`Follow-up due: ${f.title}`, { id: `followup-${f.id}` });
    }
  }, [dueQuery.data?.followups]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const allEntities = bw.mapSnapshot?.entities ?? [];
  const entities = allEntities.filter((e) => {
    if (sublayer === 'deal_packs') return Boolean(e.packed_into_pack_id);
    if (sublayer === 'buyers') return e.entity_type.toLowerCase().includes('buyer');
    if (sublayer === 'suppliers') {
      return (
        !e.packed_into_pack_id &&
        (e.entity_type.toLowerCase().includes('supplier') ||
          !e.entity_type.toLowerCase().includes('buyer'))
      );
    }
    return true;
  });
  const allEntitiesForPack = [
    ...entities,
    ...(bw.mapSnapshot?.packs.flatMap((p) =>
      p.constituent_entity_ids.map((id) => {
        const e = entities.find((x) => x.id === id);
        return e
          ? { id: e.id, display_name: e.display_name, entity_type: e.entity_type }
          : { id, display_name: id, entity_type: 'unknown' };
      }),
    ) ?? []),
  ];

  if (bw.selectedPack && bw.activeWorkspaceId) {
    return (
      <DealPackDetailPanel
        workspaceId={bw.activeWorkspaceId}
        pack={bw.selectedPack}
        entities={allEntitiesForPack}
        onClose={() => bw.setSelectedPackId(null)}
        onUnpack={() => bw.unpackDeal.mutate(bw.selectedPack!.id)}
        onSave={(body) => {
          bw.patchPack.mutate(
            { packId: bw.selectedPack!.id, body },
            { onSuccess: () => toast.success('Deal pack saved') },
          );
        }}
      />
    );
  }

  return (
    <div className="h-full bg-stone-100 dark:bg-slate-900 border-l border-black/10 dark:border-white/10 shadow-2xl flex flex-col pointer-events-auto">
      <div className="shrink-0 border-b border-black/5 dark:border-white/5 bg-white dark:bg-slate-950 p-4 pt-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center">
            <LucideBriefcase className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-black tracking-tight">Supply Chain</h2>
            <p className="text-xs text-slate-500">
              {sublayer === 'buyers'
                ? 'Buyers on map'
                : sublayer === 'deal_packs'
                  ? 'Deal packs'
                  : 'Suppliers on map'}
            </p>
          </div>
          {(dueQuery.data?.followups?.length ?? 0) > 0 && (
            <span className="text-[10px] font-black uppercase bg-red-500/20 text-red-600 px-2 py-1 rounded-full">
              {dueQuery.data!.followups.length} due
            </span>
          )}
        </div>
        <WorkspaceSwitcher
          workspaces={bw.workspaces}
          activeId={bw.activeWorkspaceId}
          onSelect={bw.setActiveWorkspaceId}
          onCreate={(name) => bw.createWs.mutate({ name })}
          onDelete={(id) => bw.deleteWs.mutate(id)}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <WorkspaceSearchImport
          onImport={(hit) =>
            bw.importFromSearch.mutate(hit, {
              onError: (e) => toast.error(e.message),
            })
          }
        />

        <section>
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Map entities</h3>
          <WorkspaceEntityList
            entities={entities}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onRemove={(id) => bw.removeEntity.mutate(id)}
          />
        </section>

        <DealPackBuilder
          entities={entities}
          selectedIds={selectedIds}
          packLocationMode={bw.packLocationMode}
          onPack={() => bw.startPackFlow(selectedIds)}
          onAddRoute={() => {
            if (selectedIds.length !== 2 || !bw.activeWorkspaceId) return;
            bw.addEdge.mutate({
              source_entity_id: selectedIds[0],
              target_entity_id: selectedIds[1],
              label: 'logistics_route',
            });
            toast.success('Route added');
          }}
        />

        {bw.mapSnapshot?.packs && bw.mapSnapshot.packs.length > 0 && (
          <section>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Packed deals</h3>
            <div className="space-y-1">
              {bw.mapSnapshot.packs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => bw.setSelectedPackId(p.id)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm font-bold hover:bg-amber-500/20"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {bw.packLocationMode && (
        <div className="shrink-0 p-3 bg-amber-500/15 border-t border-amber-500/30 text-center text-xs font-bold text-amber-800 dark:text-amber-200">
          Click the map to place the deal package pin
        </div>
      )}
    </div>
  );
}
