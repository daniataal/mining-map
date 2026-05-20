import { useMemo } from 'react';
import L from 'leaflet';
import { LayerGroup, LayersControl, Marker, Tooltip } from 'react-leaflet';
import type { MiningLicense } from '../../types';
import { useI18n } from '../../lib/i18n';
import {
  formatStorageOperatorLabel,
  formatStorageOwnerLabel,
  formatStorageSubstanceLabel,
  STORAGE_OPERATOR_UNTAGGED,
  storageTankFarmsLayerShouldMount,
} from '../../lib/storageTankFarmsLayer';
import { createStorageTerminalMapIcon, createTankFarmMapIcon } from './refineryMapIcon';

interface StorageTankFarmsMapLayerProps {
  entities: MiningLicense[];
  enabled: boolean;
  selectedId?: string | null;
  onSelect: (item: MiningLicense) => void;
}

export default function StorageTankFarmsMapLayer({
  entities,
  enabled,
  selectedId,
  onSelect,
}: StorageTankFarmsMapLayerProps) {
  const { t } = useI18n();
  const terminalIcon = useMemo(() => createStorageTerminalMapIcon(false), []);
  const tankFarmIcon = useMemo(() => createTankFarmMapIcon(false), []);
  const selectedTerminalIcon = useMemo(() => createStorageTerminalMapIcon(true), []);
  const selectedTankFarmIcon = useMemo(() => createTankFarmMapIcon(true), []);

  if (!storageTankFarmsLayerShouldMount(enabled)) return null;

  const layerLabel = t('מסופי אחסון / טנקים (OSM)', 'Storage / tank farms (OSM)');
  const placemarks = entities.filter(
    (item): item is MiningLicense & { lat: number; lng: number } =>
      item.lat != null && item.lng != null,
  );

  return (
    <LayersControl.Overlay checked name={layerLabel}>
      <LayerGroup>
        {placemarks.map((item) => {
          const isTankFarm = item.entitySubtype === 'tank_farm';
          const selected = item.id === selectedId;
          const icon = isTankFarm
            ? selected
              ? selectedTankFarmIcon
              : tankFarmIcon
            : selected
              ? selectedTerminalIcon
              : terminalIcon;

          return (
            <Marker
              key={item.id}
              position={[item.lat, item.lng]}
              icon={icon}
              zIndexOffset={selected ? 800 : 400}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelect(item);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -18]} opacity={1}>
                <div className="bg-slate-950 border border-cyan-500/30 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md max-w-[220px]">
                  <span className="text-[10px] font-black uppercase text-white tracking-widest break-words">
                    {item.company}
                  </span>
                  {item.entitySubtype && (
                    <p className="text-[8px] text-cyan-300 uppercase tracking-widest">
                      {item.entitySubtype.replaceAll('_', ' ')}
                    </p>
                  )}
                  <p className="mt-1 text-[8px] text-slate-300 break-words">
                    {t('מפעיל', 'Operator')}: {formatStorageOperatorLabel(item.operatorName, t('לא מתויג', STORAGE_OPERATOR_UNTAGGED))}
                  </p>
                  {formatStorageOwnerLabel(item.ownerName) && (
                    <p className="text-[8px] text-slate-400 break-words">
                      {t('בעלים', 'Owner')}: {item.ownerName}
                    </p>
                  )}
                  {formatStorageSubstanceLabel(item) && (
                    <p className="text-[8px] text-slate-400 break-words">
                      {t('חומר', 'Substance')}: {formatStorageSubstanceLabel(item)}
                    </p>
                  )}
                  {item.capacityText && (
                    <p className="text-[8px] text-slate-400 break-words">
                      {t('קיבולת', 'Capacity')}: {item.capacityText}
                    </p>
                  )}
                </div>
              </Tooltip>
            </Marker>
          );
        })}
      </LayerGroup>
    </LayersControl.Overlay>
  );
}
