import { useEffect } from 'react';
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
import {
  isBuyerEntity,
  resolveSelectedRouteEndpointIds,
  isSupplierEntity,
} from '../../lib/brokerWorkspaceRoles';

type Props = {
  licenses: MiningLicense[];
  userAnnotations: Record<string, UserAnnotation>;
  onAddBuyerPin?: () => void;
  sublayer?: 'suppliers' | 'buyers' | 'deal_packs';
};

export function BrokerWorkspaceShell({ licenses, userAnnotations, sublayer = 'suppliers' }: Props) {
  const bw = useBrokerWorkspaceContext();

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

  const allEntities = bw.mapSnapshot?.entities ?? [];
  const packs = bw.mapSnapshot?.packs ?? [];
  const looseEntities = allEntities.filter((e) => !e.packed_into_pack_id);
  const visibleEntities = looseEntities;
  const selectedIds = bw.selectedEntityIds;
  const selectedEntities = visibleEntities.filter((entity) => selectedIds.includes(entity.id));
  const selectedSuppliers = selectedEntities.filter(isSupplierEntity);
  const selectedBuyers = selectedEntities.filter(isBuyerEntity);
  const routeEndpointIds = resolveSelectedRouteEndpointIds(visibleEntities, selectedIds);
  const routeAlreadyExists = routeEndpointIds
    ? (bw.mapSnapshot?.edges ?? []).some((edge) => {
        const [sourceId, targetId] = routeEndpointIds;
        return (
          (edge.source_node_id === sourceId && edge.target_node_id === targetId) ||
          (edge.source_node_id === targetId && edge.target_node_id === sourceId)
        );
      })
    : false;
  const routeEndpointNames = routeEndpointIds
    ?.map((id) => visibleEntities.find((entity) => entity.id === id)?.display_name)
    .filter(Boolean)
    .join(' → ');
  const knownEntityIds = new Set(allEntities.map((entity) => entity.id));
  const allEntitiesForPack = [
    ...allEntities,
    ...(packs.flatMap((p) =>
      p.constituent_entity_ids.filter((id) => !knownEntityIds.has(id)).map((id) => {
        const e = allEntities.find((x) => x.id === id);
        return e
          ? { id: e.id, display_name: e.display_name, entity_type: e.entity_type }
          : { id, display_name: id, entity_type: 'unknown' };
      }),
    ) ?? []),
  ];
  const panelSubtitle =
    sublayer === 'deal_packs'
      ? 'Saved deal packs'
      : 'Deal canvas';
  const selectedPackName =
    selectedSuppliers[0] && selectedBuyers[0]
      ? `${selectedSuppliers[0].display_name} → ${selectedBuyers[0].display_name}`
      : 'Deal Pack';

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
            <p className="text-xs text-slate-500">{panelSubtitle}</p>
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
            bw.importFromSearch.mutate(
              {
                ...hit,
                deal_signal: hit.entity_type === 'supplier' ? 'good' : 'maybe',
              },
              {
                onError: (e) => toast.error(e.message),
              },
            )
          }
          onAddCustomLicense={(body) => bw.addEntity.mutateAsync(body)}
        />

        {sublayer === 'deal_packs' && (
          <section>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Deal packs</h3>
            {packs.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4 border border-dashed rounded-xl">
                No deal packs yet. Add a supplier and buyer, select both, then pack the deal.
              </p>
            ) : (
              <div className="space-y-2">
                {packs.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => bw.setSelectedPackId(p.id)}
                    className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left hover:bg-amber-500/20"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-black">{p.name}</span>
                      <span className="shrink-0 rounded-full bg-slate-950/10 px-2 py-0.5 text-[9px] font-black uppercase text-slate-500 dark:bg-white/10">
                        {p.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {p.constituent_entity_ids.length} parties · click to manage DD, route, economics and follow-ups
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Deal canvas</h3>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              {visibleEntities.length} loose
            </span>
          </div>
          <WorkspaceEntityList
            entities={visibleEntities}
            selectedIds={selectedIds}
            onToggleSelect={bw.toggleEntitySelection}
            onRemove={(id) => bw.removeEntity.mutate(id)}
          />
        </section>

        <DealPackBuilder
          entities={visibleEntities}
          selectedIds={selectedIds}
          packLocationMode={bw.packLocationMode}
          onPack={() => bw.startPackFlow(selectedIds, selectedPackName)}
          canDrawRoute={Boolean(routeEndpointIds) && !routeAlreadyExists}
          routePending={bw.addEdge.isPending}
          routeButtonLabel={
            routeAlreadyExists
              ? 'Route already on map'
              : routeEndpointIds
                ? 'Show route on map'
                : 'Select route points'
          }
          routeHint={
            routeEndpointNames
              ? `Route preview: ${routeEndpointNames}.`
              : 'Select exactly two points, or select a supplier and buyer. Optional ports, vessels and facilities can stay selected for the deal pack.'
          }
          onAddRoute={() => {
            if (!routeEndpointIds || !bw.activeWorkspaceId) {
              toast.error('Select two route points first');
              return;
            }
            if (routeAlreadyExists) {
              toast.info('Route is already on the map');
              return;
            }
            const [sourceId, targetId] = routeEndpointIds;
            bw.addEdge.mutate(
              {
                source_entity_id: sourceId,
                target_entity_id: targetId,
                label: 'planned_logistics_route',
              },
              {
                onSuccess: () => toast.success('Route shown on map'),
                onError: (e) => toast.error(e.message),
              },
            );
          }}
        />

        {sublayer !== 'deal_packs' && packs.length > 0 && (
          <section>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Packed deals</h3>
            <div className="space-y-1">
              {packs.map((p) => (
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
