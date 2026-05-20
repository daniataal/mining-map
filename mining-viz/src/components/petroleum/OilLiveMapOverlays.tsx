import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Marker, Popup, Polyline, LayerGroup } from 'react-leaflet';
import L from 'leaflet';
import {
  connectOilLiveWebSocket,
  getCargoRecords,
  getOilLiveMap,
  getOilOpportunities,
  type MeridianCargoRecord,
  type OilLiveVessel,
  type OilOpportunity,
  type OilTerminal,
} from '../../api/oilLiveApi';
import type { MaritimeViewportBounds } from '../../types';
import type { OilLiveEntityKind } from '../../features/live-data/OilLiveEntityDrawer';

export type OilLiveEntityClickPayload = {
  entityKind: OilLiveEntityKind;
  entityId: string;
  opportunityId?: string;
  title?: string;
  subtitle?: string;
};

export type OilLiveLayerVisibility = {
  terminals: boolean;
  vessels: boolean;
  corridors: boolean;
  opportunities: boolean;
};

const terminalIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 0 8px rgba(37,99,235,.7)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const vesselIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:10px;height:10px;border-radius:2px;background:#f59e0b;border:1px solid #fff;transform:rotate(45deg)"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const oppIcon = new L.DivIcon({
  className: '',
  html: '<div style="min-width:18px;height:18px;border-radius:9px;background:#10b981;color:#fff;font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;border:2px solid #fff">!</div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function inViewport(
  lat: number,
  lng: number,
  vp: MaritimeViewportBounds | null | undefined,
): boolean {
  if (!vp) return true;
  return lat >= vp.south && lat <= vp.north && lng >= vp.west && lng <= vp.east;
}

function hasLoadCoords(r: MeridianCargoRecord): boolean {
  return r.corridor_load_lat != null && r.corridor_load_lng != null;
}

function hasCorridorCoords(r: MeridianCargoRecord): boolean {
  return (
    hasLoadCoords(r) &&
    r.corridor_discharge_lat != null &&
    r.corridor_discharge_lng != null
  );
}

function isPartialCorridor(r: MeridianCargoRecord): boolean {
  return hasLoadCoords(r) && !hasCorridorCoords(r);
}

const partialCorridorIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:12px;height:12px;border-radius:50%;background:#f59e0b;border:2px dashed #fff;box-shadow:0 0 6px rgba(245,158,11,.8)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

type Props = {
  enabled: boolean;
  productFilter?: string;
  layers?: OilLiveLayerVisibility;
  viewport?: MaritimeViewportBounds | null;
  onStatsChange?: (stats: { terminals: number; vessels: number; opportunities: number }) => void;
  onEntityClick?: (payload: OilLiveEntityClickPayload) => void;
};

export default function OilLiveMapOverlays({
  enabled,
  productFilter = 'all',
  layers = { terminals: true, vessels: true, corridors: true, opportunities: true },
  viewport,
  onStatsChange,
  onEntityClick,
}: Props) {
  const queryClient = useQueryClient();
  const [liveVessels, setLiveVessels] = useState<Record<number, OilLiveVessel>>({});

  const bbox = viewport
    ? `${viewport.west},${viewport.south},${viewport.east},${viewport.north}`
    : undefined;

  const { data: mapData } = useQuery({
    queryKey: ['oil-live-map', bbox],
    queryFn: () => getOilLiveMap(bbox),
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? 20_000 : false,
  });

  const { data: cargoData } = useQuery({
    queryKey: ['oil-live-cargo', productFilter],
    queryFn: () =>
      getCargoRecords({
        commodity: productFilter === 'all' ? undefined : productFilter,
        min_confidence: 0.6,
        limit: 50,
      }),
    enabled: enabled && layers.corridors,
    staleTime: 60_000,
  });

  const { data: oppsData } = useQuery({
    queryKey: ['oil-live-opportunities-map'],
    queryFn: () => getOilOpportunities(0.55),
    enabled: enabled && layers.opportunities,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!enabled) return;
    const disconnect = connectOilLiveWebSocket((msg) => {
      if (msg.type === 'vessel_position' && msg.data && typeof msg.data === 'object') {
        const d = msg.data as OilLiveVessel;
        if (d.mmsi) {
          setLiveVessels((prev) => ({ ...prev, [d.mmsi]: { ...prev[d.mmsi], ...d } }));
        }
      }
      if (msg.type === 'intelligence_card_created') {
        void queryClient.invalidateQueries({ queryKey: ['oil-live-map'] });
      }
    });
    return disconnect;
  }, [enabled, queryClient]);

  const terminals = useMemo(() => {
    let list = mapData?.terminals ?? [];
    if (productFilter !== 'all') {
      list = list.filter((t) =>
        (t.products ?? []).some((p) => p.toLowerCase().includes(productFilter)),
      );
    }
    return list.filter(
      (t) => t.lat != null && t.lng != null && inViewport(t.lat!, t.lng!, viewport),
    );
  }, [mapData?.terminals, productFilter, viewport]);

  const vessels = useMemo(() => {
    const base = mapData?.vessels ?? [];
    const merged = base.map((v) => ({ ...v, ...liveVessels[v.mmsi] }));
    const extra = Object.values(liveVessels).filter(
      (v) => !base.some((b) => b.mmsi === v.mmsi),
    );
    return [...merged, ...extra].filter(
      (v) => v.lat != null && v.lng != null && inViewport(v.lat, v.lng, viewport),
    );
  }, [mapData?.vessels, liveVessels, viewport]);

  const corridors = useMemo(() => {
    return (cargoData?.cargo_records ?? [])
      .filter((r) => hasCorridorCoords(r))
      .map((r) => ({
        record: r,
        id: r.id,
        positions: [
          [r.corridor_load_lat!, r.corridor_load_lng!] as [number, number],
          [r.corridor_discharge_lat!, r.corridor_discharge_lng!] as [number, number],
        ],
      }))
      .filter(({ positions }) => {
        const [load, disc] = positions;
        return (
          inViewport(load[0], load[1], viewport) ||
          inViewport(disc[0], disc[1], viewport)
        );
      });
  }, [cargoData?.cargo_records, viewport]);

  const partialCorridors = useMemo(() => {
    return (cargoData?.cargo_records ?? [])
      .filter((r) => isPartialCorridor(r))
      .filter((r) => inViewport(r.corridor_load_lat!, r.corridor_load_lng!, viewport));
  }, [cargoData?.cargo_records, viewport]);

  const terminalById = useMemo(() => {
    const m = new Map<string, OilTerminal>();
    for (const t of mapData?.terminals ?? []) m.set(t.id, t);
    return m;
  }, [mapData?.terminals]);

  const opportunityMarkers = useMemo(() => {
    const opps = oppsData?.opportunities ?? [];
    const out: Array<{ key: string; lat: number; lng: number; title: string; oppId: string }> = [];
    for (const opp of opps) {
      const tid = opp.terminal_id;
      if (!tid) continue;
      const term = terminalById.get(tid);
      if (!term || term.lat == null || term.lng == null) continue;
      if (!inViewport(term.lat, term.lng, viewport)) continue;
      out.push({
        key: opp.id,
        oppId: opp.id,
        lat: term.lat,
        lng: term.lng,
        title: opp.title ?? 'Opportunity',
      });
    }
    return out;
  }, [oppsData?.opportunities, terminalById, viewport]);

  const opportunityByTerminalId = useMemo(() => {
    const m = new Map<string, OilOpportunity>();
    for (const opp of oppsData?.opportunities ?? []) {
      if (opp.terminal_id && !m.has(opp.terminal_id)) {
        m.set(opp.terminal_id, opp);
      }
    }
    return m;
  }, [oppsData?.opportunities]);

  useEffect(() => {
    if (!onStatsChange) return;
    onStatsChange({
      terminals: terminals.length,
      vessels: vessels.length,
      opportunities: opportunityMarkers.length,
    });
  }, [terminals.length, vessels.length, opportunityMarkers.length, onStatsChange]);

  if (!enabled) return null;

  return (
    <LayerGroup>
      {layers.terminals &&
        terminals.map((term) => (
          <Marker
            key={term.id}
            position={[term.lat!, term.lng!]}
            icon={terminalIcon}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                const linked = opportunityByTerminalId.get(term.id);
                onEntityClick?.({
                  entityKind: 'terminal',
                  entityId: term.id,
                  opportunityId: linked?.id,
                  title: term.name,
                  subtitle: [term.operator_name, term.country].filter(Boolean).join(' · '),
                });
              },
            }}
          >
            <Popup>
              <strong>{term.name}</strong>
              <br />
              {term.operator_name}
              <br />
              {(term.products ?? []).join(', ')}
            </Popup>
          </Marker>
        ))}
      {layers.vessels &&
        vessels.map((v) => (
          <Marker
            key={v.mmsi}
            position={[v.lat, v.lng]}
            icon={vesselIcon}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                onEntityClick?.({
                  entityKind: 'vessel',
                  entityId: String(v.mmsi),
                  title: v.name ?? `MMSI ${v.mmsi}`,
                  subtitle: v.tanker_class,
                });
              },
            }}
          >
            <Popup>
              <strong>{v.name ?? `MMSI ${v.mmsi}`}</strong>
              <br />
              {v.tanker_class}
            </Popup>
          </Marker>
        ))}
      {layers.corridors &&
        partialCorridors.map((r) => (
          <Marker
            key={`partial-${r.id}`}
            position={[r.corridor_load_lat!, r.corridor_load_lng!]}
            icon={partialCorridorIcon}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                onEntityClick?.({
                  entityKind: 'cargo',
                  entityId: r.id,
                  title: r.vessel_name ?? `Cargo ${r.commodity_family ?? ''}`,
                  subtitle: [r.load_port_name, r.discharge_hint ?? 'discharge unknown']
                    .filter(Boolean)
                    .join(' → '),
                });
              },
            }}
          >
            <Popup>
              <span
                style={{
                  display: 'inline-block',
                  marginBottom: 4,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: '#fef3c7',
                  color: '#92400e',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                partial corridor
              </span>
              <br />
              <strong>{r.commodity_family ?? 'Cargo'}</strong>
              <br />
              Load: {r.load_port_name ?? '—'}
              {r.discharge_hint && (
                <>
                  <br />
                  Discharge hint: {r.discharge_hint}
                </>
              )}
            </Popup>
          </Marker>
        ))}
      {layers.corridors &&
        corridors.map((c) => (
          <Polyline
            key={c.id}
            positions={c.positions}
            pathOptions={{ color: '#f59e0b', weight: 2, dashArray: '8 6', opacity: 0.85 }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                onEntityClick?.({
                  entityKind: 'cargo',
                  entityId: c.id,
                  title: c.record.vessel_name ?? `Cargo ${c.record.commodity_family ?? ''}`,
                  subtitle: [c.record.load_port_name, c.record.discharge_hint]
                    .filter(Boolean)
                    .join(' → '),
                });
              },
            }}
          >
            <Popup>
              <strong>{c.record.commodity_family ?? 'Cargo corridor'}</strong>
              <br />
              {c.record.shipper_name && <>Shipper: {c.record.shipper_name}<br /></>}
              {c.record.consignee_name && <>Consignee: {c.record.consignee_name}<br /></>}
              {c.record.load_port_name && <>Load: {c.record.load_port_name}<br /></>}
              {c.record.discharge_hint && <>Discharge: {c.record.discharge_hint}<br /></>}
              {c.record.confidence != null && (
                <>Confidence: {(c.record.confidence * 100).toFixed(0)}%</>
              )}
            </Popup>
          </Polyline>
        ))}
      {layers.opportunities &&
        opportunityMarkers.map((o) => (
          <Marker
            key={o.key}
            position={[o.lat, o.lng]}
            icon={oppIcon}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                onEntityClick?.({
                  entityKind: 'opportunity',
                  entityId: o.oppId,
                  opportunityId: o.oppId,
                  title: o.title,
                });
              },
            }}
          >
            <Popup>{o.title}</Popup>
          </Marker>
        ))}
    </LayerGroup>
  );
}
