import { useMemo } from 'react';
import L from 'leaflet';
import { LayerGroup, LayersControl, Marker, Tooltip } from 'react-leaflet';
import type { MiningLicense } from '../../types';
import { useI18n } from '../../lib/i18n';
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

  if (!enabled || entities.length === 0) return null;

  const layerLabel = t('מסופי אחסון / טנקים (OSM)', 'Storage / tank farms (OSM)');

  return (
    <LayersControl.Overlay checked name={layerLabel}>
      <LayerGroup>
        {entities.map((item) => {
          if (item.lat == null || item.lng == null) return null;
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
                <div className="bg-slate-950 border border-cyan-500/30 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md">
                  <span className="text-[10px] font-black uppercase text-white tracking-widest">
                    {item.company}
                  </span>
                  {item.entitySubtype && (
                    <p className="text-[8px] text-cyan-300 uppercase tracking-widest">
                      {item.entitySubtype.replaceAll('_', ' ')}
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
