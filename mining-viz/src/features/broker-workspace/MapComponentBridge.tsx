import { useCallback, useMemo } from 'react';
import type { ComponentProps } from 'react';
import MapComponent from '../../components/MapComponent';
import { useBrokerWorkspaceContext } from './BrokerWorkspaceContext';
import { workspaceHiddenLicenseIds } from '../../lib/brokerWorkspaceMapVisibility';

type MapProps = ComponentProps<typeof MapComponent>;

export function MapComponentBridge(props: MapProps) {
  const bw = useBrokerWorkspaceContext();
  const isWorkspace =
    props.viewModeKey === 'workspace' || props.viewModeKey === 'supply_chain';

  const hiddenLicenseIds = useMemo(() => {
    if (!isWorkspace || !bw.mapSnapshot?.entities) return new Set<string>();
    const packedIds = new Set(
      bw.mapSnapshot.packs.flatMap((p) => p.constituent_entity_ids),
    );
    return workspaceHiddenLicenseIds(bw.mapSnapshot.entities, packedIds);
  }, [isWorkspace, bw.mapSnapshot]);

  const filteredProcessedData = useMemo(() => {
    if (!isWorkspace || hiddenLicenseIds.size === 0) return props.processedData;
    return props.processedData.filter((lic) => !hiddenLicenseIds.has(lic.id));
  }, [hiddenLicenseIds, isWorkspace, props.processedData]);

  const onPackLocationPick = useCallback(
    (lat: number, lng: number) => {
      if (bw.packLocationMode) {
        bw.finishPackAtLocation(lat, lng);
      }
    },
    [bw],
  );

  return (
    <MapComponent
      {...props}
      processedData={filteredProcessedData}
      brokerWorkspaceMap={isWorkspace ? bw.mapSnapshot : undefined}
      brokerWorkspaceSelectedEntityIds={isWorkspace ? bw.selectedEntityIds : undefined}
      brokerPackLocationMode={isWorkspace && bw.packLocationMode}
      onBrokerPackLocationPick={isWorkspace ? onPackLocationPick : undefined}
      onBrokerWorkspaceEntitySelect={
        isWorkspace ? bw.toggleEntitySelection : undefined
      }
      onBrokerPackSelect={
        isWorkspace ? (packId: string) => bw.setSelectedPackId(packId) : undefined
      }
      onAddToBrokerWorkspace={
        bw.activeWorkspaceId
          ? (body) => bw.addEntity.mutate(body)
          : undefined
      }
    />
  );
}
