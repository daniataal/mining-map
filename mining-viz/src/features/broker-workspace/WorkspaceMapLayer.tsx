import { Marker, Polyline, Tooltip } from 'react-leaflet';
import Leaflet from 'leaflet';
import type { BrokerDealPack, WorkspaceEdge, WorkspaceEntity } from '../../api/brokerWorkspaceApi';
import { entityMarkerColor } from '../../lib/brokerWorkspaceMapVisibility';

const packIcon = Leaflet.divIcon({
  className: 'broker-pack-pin',
  html: `<div style="width:22px;height:22px;background:#f59e0b;border:2px solid white;border-radius:6px;box-shadow:0 0 12px rgba(245,158,11,0.9);display:flex;align-items:center;justify-content:center;font-size:12px;">📦</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function entityIcon(color: string, label: string) {
  return Leaflet.divIcon({
    className: 'broker-entity-pin',
    html: `<div style="width:14px;height:14px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 0 8px ${color}88;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

type Props = {
  entities: WorkspaceEntity[];
  packs: BrokerDealPack[];
  edges: WorkspaceEdge[];
  onEntityClick?: (entity: WorkspaceEntity) => void;
  onPackClick?: (pack: BrokerDealPack) => void;
};

export function WorkspaceMapLayer({ entities, packs, edges, onEntityClick, onPackClick }: Props) {
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));
  const looseEntities = entities.filter((e) => !e.packed_into_pack_id);

  return (
    <>
      {looseEntities.map((e) => {
        const color = entityMarkerColor(e.deal_signal, e.in_dd_queue, e.dd_stage);
        return (
          <Marker
            key={e.id}
            position={[e.lat, e.lng]}
            icon={entityIcon(color, e.display_name)}
            zIndexOffset={1500}
            eventHandlers={{
              click: () => onEntityClick?.(e),
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              <span className="font-bold">{e.display_name}</span>
              <br />
              <span className="text-[10px] uppercase">{e.entity_type}</span>
              {e.in_dd_queue && <span className="text-amber-600"> · DD</span>}
            </Tooltip>
          </Marker>
        );
      })}

      {edges.map((edge) => {
        const src = entityById[edge.source_node_id];
        const tgt = entityById[edge.target_node_id];
        if (!src || !tgt || src.packed_into_pack_id || tgt.packed_into_pack_id) return null;
        return (
          <Polyline
            key={edge.id}
            positions={[
              [src.lat, src.lng],
              [tgt.lat, tgt.lng],
            ]}
            pathOptions={{ color: '#f59e0b', weight: 3, dashArray: '6, 8', opacity: 0.85 }}
          >
            <Tooltip>{edge.label || 'Logistics route'}</Tooltip>
          </Polyline>
        );
      })}

      {packs
        .filter((p) => p.status === 'packed' && p.map_lat != null && p.map_lng != null)
        .map((p) => (
          <Marker
            key={p.id}
            position={[p.map_lat!, p.map_lng!]}
            icon={packIcon}
            zIndexOffset={2000}
            eventHandlers={{
              click: () => onPackClick?.(p),
            }}
          >
            <Tooltip direction="top" offset={[0, -12]}>
              <span className="font-bold text-amber-600">{p.name}</span>
            </Tooltip>
          </Marker>
        ))}
    </>
  );
}
