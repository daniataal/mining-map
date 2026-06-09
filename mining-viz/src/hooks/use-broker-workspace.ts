import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBrokerDealPack,
  createBrokerWorkspace,
  createWorkspaceEntity,
  createWorkspaceEdge,
  deleteBrokerWorkspace,
  deleteWorkspaceEntity,
  getWorkspaceMap,
  importSearchEntity,
  listBrokerWorkspaces,
  packBrokerDeal,
  unpackBrokerDeal,
  updateBrokerDealPack,
  updateBrokerWorkspace,
  updateWorkspaceEntity,
  type BrokerDealPack,
  type WorkspaceEntity,
} from '../api/brokerWorkspaceApi';

export const BROKER_WS_QUERY = ['broker-workspaces'] as const;
export const brokerMapQueryKey = (workspaceId: string | null) =>
  ['broker-workspace-map', workspaceId] as const;

export function useBrokerWorkspace() {
  const qc = useQueryClient();
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(() =>
    localStorage.getItem('broker_active_workspace_id'),
  );
  const setActiveWorkspaceId = useCallback((id: string | null) => {
    setActiveWorkspaceIdState(id);
    if (id) localStorage.setItem('broker_active_workspace_id', id);
    else localStorage.removeItem('broker_active_workspace_id');
  }, []);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const [packLocationMode, setPackLocationMode] = useState(false);
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);
  const [pendingConstituents, setPendingConstituents] = useState<string[]>([]);

  const workspacesQuery = useQuery({
    queryKey: BROKER_WS_QUERY,
    queryFn: listBrokerWorkspaces,
    staleTime: 30_000,
  });

  const workspaces = workspacesQuery.data?.workspaces ?? [];
  const effectiveWorkspaceId =
    activeWorkspaceId ?? workspaces.find((w) => w.is_default)?.id ?? workspaces[0]?.id ?? null;

  const mapQuery = useQuery({
    queryKey: brokerMapQueryKey(effectiveWorkspaceId),
    queryFn: () => getWorkspaceMap(effectiveWorkspaceId!),
    enabled: Boolean(effectiveWorkspaceId),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    setSelectedEntityIds([]);
  }, [effectiveWorkspaceId]);

  const toggleEntitySelection = useCallback((id: string) => {
    setSelectedEntityIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const clearEntitySelection = useCallback(() => {
    setSelectedEntityIds([]);
  }, []);

  const invalidateMap = useCallback(() => {
    if (effectiveWorkspaceId) {
      void qc.invalidateQueries({ queryKey: brokerMapQueryKey(effectiveWorkspaceId) });
    }
    void qc.invalidateQueries({ queryKey: BROKER_WS_QUERY });
  }, [qc, effectiveWorkspaceId]);

  const createWs = useMutation({
    mutationFn: createBrokerWorkspace,
    onSuccess: (res) => {
      invalidateMap();
      setActiveWorkspaceId(res.id);
    },
  });

  const deleteWs = useMutation({
    mutationFn: deleteBrokerWorkspace,
    onSuccess: () => {
      setActiveWorkspaceId(null);
      invalidateMap();
    },
  });

  const renameWs = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateBrokerWorkspace(id, { name }),
    onSuccess: invalidateMap,
  });

  const addEntity = useMutation({
    mutationFn: (body: Partial<WorkspaceEntity> & { entity_type: string; display_name: string }) =>
      createWorkspaceEntity(effectiveWorkspaceId!, body),
    onSuccess: invalidateMap,
  });

  const importFromSearch = useMutation({
    mutationFn: (body: Parameters<typeof importSearchEntity>[1]) =>
      importSearchEntity(effectiveWorkspaceId!, body),
    onSuccess: invalidateMap,
  });

  const patchEntity = useMutation({
    mutationFn: ({
      entityId,
      body,
    }: {
      entityId: string;
      body: Parameters<typeof updateWorkspaceEntity>[2];
    }) => updateWorkspaceEntity(effectiveWorkspaceId!, entityId, body),
    onSuccess: invalidateMap,
  });

  const removeEntity = useMutation({
    mutationFn: (entityId: string) => deleteWorkspaceEntity(effectiveWorkspaceId!, entityId),
    onSuccess: invalidateMap,
  });

  const addEdge = useMutation({
    mutationFn: (body: { source_entity_id: string; target_entity_id: string; label?: string }) =>
      createWorkspaceEdge(effectiveWorkspaceId!, body),
    onSuccess: invalidateMap,
  });

  const createPack = useMutation({
    mutationFn: (body: { name: string; constituent_entity_ids: string[] }) =>
      createBrokerDealPack(effectiveWorkspaceId!, body),
    onSuccess: invalidateMap,
  });

  const patchPack = useMutation({
    mutationFn: ({
      packId,
      body,
    }: {
      packId: string;
      body: Parameters<typeof updateBrokerDealPack>[2];
    }) => updateBrokerDealPack(effectiveWorkspaceId!, packId, body),
    onSuccess: invalidateMap,
  });

  const packDeal = useMutation({
    mutationFn: ({
      packId,
      map_lat,
      map_lng,
      constituent_entity_ids,
    }: {
      packId: string;
      map_lat: number;
      map_lng: number;
      constituent_entity_ids: string[];
    }) => packBrokerDeal(effectiveWorkspaceId!, packId, { map_lat, map_lng, constituent_entity_ids }),
    onSuccess: () => {
      setPackLocationMode(false);
      setPendingPackId(null);
      setPendingConstituents([]);
      invalidateMap();
    },
  });

  const unpackDeal = useMutation({
    mutationFn: (packId: string) => unpackBrokerDeal(effectiveWorkspaceId!, packId),
    onSuccess: () => {
      setSelectedPackId(null);
      invalidateMap();
    },
  });

  const startPackFlow = useCallback(
    (constituentIds: string[], packName = 'Deal Pack') => {
      if (!effectiveWorkspaceId || constituentIds.length === 0) return;
      createPack.mutate(
        { name: packName, constituent_entity_ids: constituentIds },
        {
          onSuccess: (res) => {
            setPendingPackId(res.id);
            setPendingConstituents(constituentIds);
            setPackLocationMode(true);
          },
        },
      );
    },
    [createPack, effectiveWorkspaceId],
  );

  const finishPackAtLocation = useCallback(
    (lat: number, lng: number) => {
      if (!pendingPackId || pendingConstituents.length === 0) return;
      packDeal.mutate({
        packId: pendingPackId,
        map_lat: lat,
        map_lng: lng,
        constituent_entity_ids: pendingConstituents,
      });
    },
    [packDeal, pendingConstituents, pendingPackId],
  );

  const selectedPack: BrokerDealPack | null =
    mapQuery.data?.packs.find((p) => p.id === selectedPackId) ?? null;

  return {
    workspaces,
    workspacesLoading: workspacesQuery.isLoading,
    activeWorkspaceId: effectiveWorkspaceId,
    setActiveWorkspaceId,
    mapSnapshot: mapQuery.data,
    mapLoading: mapQuery.isLoading,
    selectedPackId,
    setSelectedPackId,
    selectedPack,
    selectedEntityIds,
    toggleEntitySelection,
    clearEntitySelection,
    packLocationMode,
    setPackLocationMode,
    createWs,
    deleteWs,
    renameWs,
    addEntity,
    importFromSearch,
    patchEntity,
    removeEntity,
    addEdge,
    createPack,
    patchPack,
    packDeal,
    unpackDeal,
    startPackFlow,
    finishPackAtLocation,
    invalidateMap,
  };
}
