import { Fragment } from 'react';
import { Marker, Pane, Polyline, Tooltip } from 'react-leaflet';
import Leaflet from 'leaflet';
import type { BrokerDealPack, WorkspaceEdge, WorkspaceEntity } from '../../api/brokerWorkspaceApi';
import { entityMarkerColor } from '../../lib/brokerWorkspaceMapVisibility';

const packIcon = Leaflet.divIcon({
  className: 'broker-pack-pin',
  html: `<div style="width:22px;height:22px;background:#f59e0b;border:2px solid white;border-radius:6px;box-shadow:0 0 12px rgba(245,158,11,0.9);display:flex;align-items:center;justify-content:center;font-size:12px;">📦</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function entityIcon(color: string, label: string, selected: boolean) {
  const size = selected ? 20 : 14;
  const anchor = size / 2;
  const border = selected ? '#f59e0b' : 'white';
  const ring = selected ? `0 0 0 4px rgba(245,158,11,0.32), 0 0 18px ${color}` : `0 0 8px ${color}88`;
  return Leaflet.divIcon({
    className: 'broker-entity-pin',
    html: `<div title="${escapeHtmlAttribute(label)}" style="width:${size}px;height:${size}px;background:${color};border:2px solid ${border};border-radius:50%;box-shadow:${ring};"></div>`,
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
}

type Props = {
  entities: WorkspaceEntity[];
  packs: BrokerDealPack[];
  edges: WorkspaceEdge[];
  selectedEntityIds?: readonly string[];
  onEntityClick?: (entity: WorkspaceEntity) => void;
  onPackClick?: (pack: BrokerDealPack) => void;
};

function hasValidCoordinates(entity: WorkspaceEntity): boolean {
  return Number.isFinite(entity.lat) && Number.isFinite(entity.lng);
}

export function WorkspaceMapLayer({
  entities,
  packs,
  edges,
  selectedEntityIds = [],
  onEntityClick,
  onPackClick,
}: Props) {
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));
  const looseEntities = entities.filter((e) => !e.packed_into_pack_id);
  const selected = new Set(selectedEntityIds);

  return (
    <>
      {looseEntities.filter(hasValidCoordinates).map((e) => {
        const color = entityMarkerColor(e.deal_signal, e.in_dd_queue, e.dd_stage);
        const isSelected = selected.has(e.id);
        return (
          <Marker
            key={e.id}
            position={[e.lat, e.lng]}
            icon={entityIcon(color, e.display_name, isSelected)}
            zIndexOffset={isSelected ? 1900 : 1500}
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

      <Pane name="broker-routes-pane" style={{ zIndex: 625 }}>
        {edges.map((edge) => {
          const src = entityById[edge.source_node_id];
          const tgt = entityById[edge.target_node_id];
          if (!src || !tgt || !hasValidCoordinates(src) || !hasValidCoordinates(tgt)) return null;
          const positions: [number, number][] = [
            [src.lat, src.lng],
            [tgt.lat, tgt.lng],
          ];
          return (
            <Fragment key={edge.id}>
              <Polyline
                positions={positions}
                pathOptions={{ color: '#f59e0b', weight: 10, opacity: 0.22 }}
                interactive={false}
              />
              <Polyline
                positions={positions}
                pathOptions={{ color: '#fbbf24', weight: 4, dashArray: '10 8', opacity: 0.96 }}
              >
                <Tooltip>
                  <span className="font-bold">Planned logistics route</span>
                  <br />
                  <span>{src.display_name} → {tgt.display_name}</span>
                </Tooltip>
              </Polyline>
            </Fragment>
          );
        })}
      </Pane>

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
