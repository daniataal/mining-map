import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, LayerGroup, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import ArrowPolyline from '../../components/map/ArrowPolyline';
import {
  bezierMidpoint,
  commodityColor,
  volumeToWeight,
  type LatLngTuple,
} from '../../lib/corridorGeometry';
import { unwrapLongitudePath } from '../../lib/unwrapLongitudePath';
import { countryCentroid } from '../../lib/countryCentroids';
import { dischargeFromHistoricPort, type UsPortFields } from '../../lib/usPortCentroids';
import type { EiaHistoricMapArc, EiaHistoricMapOrigin } from '../../api/eiaHistoricApi';
import EiaHistoricOriginPopup from './EiaHistoricOriginPopup';

export type EiaHistoricMapArcGeo = EiaHistoricMapArc & {
  load: LatLngTuple;
  discharge: LatLngTuple;
  origin_label: string;
  discharge_label: string;
};

function arcPortFields(arc: EiaHistoricMapArc): UsPortFields {
  return {
    port_city: arc.port_city,
    port_state: arc.port_state,
    port_code: arc.port_code,
    port_label: arc.port_label,
  };
}

function originPrimaryPort(origin: EiaHistoricMapOrigin): UsPortFields | null {
  const top = origin.top_ports?.[0];
  if (!top) return null;
  return {
    port_city: top.port_city,
    port_state: top.port_state,
    port_code: top.port_code,
    port_label: top.port_label,
  };
}

export function arcsToGeo(arcs: EiaHistoricMapArc[]): EiaHistoricMapArcGeo[] {
  const out: EiaHistoricMapArcGeo[] = [];
  for (const arc of arcs) {
    const origin = countryCentroid(arc.origin_country);
    if (!origin) continue;
    const discharge = dischargeFromHistoricPort(arcPortFields(arc));
    out.push({
      ...arc,
      load: [origin.lat, origin.lng],
      discharge: [discharge.lat, discharge.lng],
      origin_label: origin.label,
      discharge_label: discharge.label,
    });
  }
  return out;
}

function aggregateCorridorsByOrigin(
  geoArcs: EiaHistoricMapArcGeo[],
  maxOrigins: number,
): EiaHistoricMapArcGeo[] {
  const byOrigin = new Map<
    string,
    EiaHistoricMapArcGeo & { dominantSliceVol: number }
  >();
  for (const arc of geoArcs) {
    const key = arc.origin_country;
    const prev = byOrigin.get(key);
    if (!prev) {
      byOrigin.set(key, { ...arc, dominantSliceVol: arc.volume_bbl });
      continue;
    }
    prev.volume_bbl += arc.volume_bbl;
    prev.row_count += arc.row_count;
    if (arc.volume_bbl > prev.dominantSliceVol) {
      prev.dominantSliceVol = arc.volume_bbl;
      prev.commodity_family = arc.commodity_family;
      prev.discharge = arc.discharge;
      prev.discharge_label = arc.discharge_label;
      prev.port_city = arc.port_city;
      prev.port_state = arc.port_state;
      prev.port_code = arc.port_code;
      prev.port_label = arc.port_label;
    }
  }
  return [...byOrigin.values()]
    .map(({ dominantSliceVol: _d, ...arc }) => arc)
    .sort((a, b) => b.volume_bbl - a.volume_bbl)
    .slice(0, maxOrigins);
}

function markerRadius(volumeBbl: number, selected: boolean): number {
  const w = volumeToWeight(volumeBbl);
  const base = Math.min(14, Math.max(6, 4 + w));
  return selected ? base + 4 : base;
}

function dominantCommodity(origin: EiaHistoricMapOrigin): string {
  const sorted = [...(origin.by_commodity ?? [])].sort(
    (a, b) => (b.volume_bbl ?? 0) - (a.volume_bbl ?? 0),
  );
  return sorted[0]?.commodity_family ?? 'other';
}

type OriginPoint = EiaHistoricMapOrigin & {
  lat: number;
  lng: number;
  label: string;
};

function MapClickClear({ onClear }: { onClear: () => void }) {
  useMapEvents({
    click: () => onClear(),
  });
  return null;
}

type Props = {
  enabled: boolean;
  arcs: EiaHistoricMapArc[];
  origins?: EiaHistoricMapOrigin[];
  year?: number;
  showCorridors?: boolean;
  onSelectImporter?: (importerName: string) => void;
};

const HUB_COLOR = '#8b5cf6';

export default function EiaHistoricMapLayer({
  enabled,
  arcs,
  origins = [],
  year,
  showCorridors = false,
  onSelectImporter,
}: Props) {
  const [selectedOriginKey, setSelectedOriginKey] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) setSelectedOriginKey(null);
  }, [enabled]);

  const geoArcs = useMemo(() => arcsToGeo(arcs), [arcs]);

  const corridorArcs = useMemo(
    () => (showCorridors ? aggregateCorridorsByOrigin(geoArcs, 18) : []),
    [geoArcs, showCorridors],
  );

  const originPoints = useMemo((): OriginPoint[] => {
    const list = origins.length > 0 ? origins : [];
    const fromArcs: EiaHistoricMapOrigin[] =
      list.length > 0
        ? list
        : (() => {
            const byOrigin = new Map<string, EiaHistoricMapOrigin>();
            for (const arc of arcs) {
              const key = arc.origin_country;
              const prev = byOrigin.get(key);
              if (!prev) {
                byOrigin.set(key, {
                  origin_country: key,
                  volume_bbl: arc.volume_bbl,
                  row_count: arc.row_count,
                  top_importers: [],
                  top_ports: arc.port_city
                    ? [
                        {
                          port_city: arc.port_city ?? null,
                          port_state: arc.port_state ?? null,
                          port_code: arc.port_code ?? null,
                          port_label: arc.port_label ?? '',
                          volume_bbl: arc.volume_bbl,
                          row_count: arc.row_count,
                        },
                      ]
                    : [],
                  by_commodity: [
                    {
                      commodity_family: arc.commodity_family,
                      volume_bbl: arc.volume_bbl,
                      row_count: arc.row_count,
                    },
                  ],
                });
              } else {
                prev.volume_bbl += arc.volume_bbl;
                prev.row_count += arc.row_count;
                prev.by_commodity.push({
                  commodity_family: arc.commodity_family,
                  volume_bbl: arc.volume_bbl,
                  row_count: arc.row_count,
                });
              }
            }
            return [...byOrigin.values()];
          })();

    return fromArcs
      .map((o) => {
        const c = countryCentroid(o.origin_country);
        if (!c) return null;
        return { ...o, lat: c.lat, lng: c.lng, label: c.label };
      })
      .filter((x): x is OriginPoint => x != null)
      .sort((a, b) => b.volume_bbl - a.volume_bbl);
  }, [arcs, origins]);

  const selectedOrigin = useMemo(
    () => originPoints.find((o) => o.origin_country === selectedOriginKey) ?? null,
    [originPoints, selectedOriginKey],
  );

  const selectedDischarge = useMemo(() => {
    if (!selectedOrigin) return null;
    const portFields = originPrimaryPort(selectedOrigin);
    if (portFields) return dischargeFromHistoricPort(portFields);
    const fallbackArc = geoArcs.find((a) => a.origin_country === selectedOrigin.origin_country);
    if (fallbackArc) {
      return {
        lat: fallbackArc.discharge[0],
        lng: fallbackArc.discharge[1],
        label: fallbackArc.discharge_label,
      };
    }
    return null;
  }, [selectedOrigin, geoArcs]);

  const selectedCorridor = useMemo(() => {
    if (!selectedOrigin || !selectedDischarge) return null;
    const load: LatLngTuple = [selectedOrigin.lat, selectedOrigin.lng];
    const discharge: LatLngTuple = [selectedDischarge.lat, selectedDischarge.lng];
    const color = commodityColor(dominantCommodity(selectedOrigin));
    const positions = unwrapLongitudePath(bezierMidpoint(load, discharge, 0));
    return { positions, color, load, discharge, dischargeLabel: selectedDischarge.label };
  }, [selectedOrigin, selectedDischarge]);

  if (!enabled || (originPoints.length === 0 && corridorArcs.length === 0)) return null;

  return (
    <LayerGroup>
      <MapClickClear onClear={() => setSelectedOriginKey(null)} />

      {showCorridors &&
        !selectedOriginKey &&
        corridorArcs.map((arc, idx) => {
          const bent = bezierMidpoint(arc.load, arc.discharge, idx);
          const positions = unwrapLongitudePath(bent);
          const color = commodityColor(arc.commodity_family);
          const weight = Math.min(4, volumeToWeight(arc.volume_bbl));
          return (
            <ArrowPolyline
              key={`corridor-${arc.origin_country}-${arc.discharge_label}`}
              positions={positions}
              arrowColor={color}
              arrowSize={10}
              pathOptions={{
                color,
                weight,
                opacity: 0.35,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          );
        })}

      {selectedCorridor && selectedDischarge && (
        <>
          <ArrowPolyline
            key={`selected-${selectedOriginKey}`}
            positions={selectedCorridor.positions}
            arrowColor={selectedCorridor.color}
            arrowSize={14}
            pathOptions={{
              color: selectedCorridor.color,
              weight: 4,
              opacity: 0.92,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <CircleMarker
            center={[selectedDischarge.lat, selectedDischarge.lng]}
            radius={10}
            pathOptions={{
              color: '#f5f3ff',
              fillColor: HUB_COLOR,
              fillOpacity: 1,
              weight: 3,
            }}
          >
            <Popup className="eia-historic-leaflet-popup" maxWidth={300} minWidth={260}>
              <div className="eia-historic-popup-card eia-historic-popup-card--hub">
                <p className="eia-historic-popup-title">{selectedDischarge.label}</p>
                <p className="eia-historic-popup-sub">
                  U.S. discharge port for {selectedOrigin?.label} ({year ?? '—'}).
                </p>
                <span className="eia-historic-popup-tier">Historic · EIA</span>
              </div>
            </Popup>
          </CircleMarker>
        </>
      )}

      {originPoints.map((o) => {
        const isSelected = o.origin_country === selectedOriginKey;
        const dimmed = selectedOriginKey != null && !isSelected;
        const dischargeLabel =
          originPrimaryPort(o) != null
            ? dischargeFromHistoricPort(originPrimaryPort(o)!).label
            : selectedDischarge?.label ?? 'U.S. port';
        return (
          <CircleMarker
            key={o.origin_country}
            center={[o.lat, o.lng]}
            radius={markerRadius(o.volume_bbl, isSelected)}
            pathOptions={{
              color: isSelected ? '#f5f3ff' : '#5b21b6',
              fillColor: isSelected ? '#c4b5fd' : '#a78bfa',
              fillOpacity: dimmed ? 0.35 : isSelected ? 1 : 0.88,
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                setSelectedOriginKey(o.origin_country);
              },
            }}
          >
            <Popup
              className="eia-historic-leaflet-popup"
              maxWidth={340}
              minWidth={280}
              eventHandlers={{
                add: () => setSelectedOriginKey(o.origin_country),
              }}
            >
              <EiaHistoricOriginPopup
                label={o.label}
                origin={o}
                year={year}
                routeLabel={`${o.label} → ${dischargeLabel}`}
                onSelectImporter={onSelectImporter}
              />
            </Popup>
          </CircleMarker>
        );
      })}
    </LayerGroup>
  );
}
