import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, LayerGroup, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { HistoricArcSelection } from './HistoricArcDetailDrawer';
import ArrowPolyline from '../../components/map/ArrowPolyline';
import {
  bezierMidpoint,
  commodityColor,
  volumeToWeight,
  type LatLngTuple,
} from '../../lib/corridorGeometry';
import { unwrapLongitudePath } from '../../lib/unwrapLongitudePath';
import { countryCentroid } from '../../lib/countryCentroids';
import {
  dischargeFromHistoricPort,
  importerPortFields,
  type UsPortFields,
} from '../../lib/usPortCentroids';
import type {
  EiaHistoricMapArc,
  EiaHistoricMapOrigin,
  EiaHistoricOriginImporter,
} from '../../api/eiaHistoricApi';
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

function portSliceKey(fields: UsPortFields): string {
  return [
    fields.port_city ?? '',
    fields.port_state ?? '',
    fields.port_code ?? '',
  ].join('|');
}

/** One arc per origin → U.S. port (not collapsed to a single Gulf line). */
function aggregateCorridorsByOriginPort(
  geoArcs: EiaHistoricMapArcGeo[],
  maxLines: number,
): EiaHistoricMapArcGeo[] {
  const byKey = new Map<string, EiaHistoricMapArcGeo>();
  for (const arc of geoArcs) {
    const key = `${arc.origin_country}::${portSliceKey(arcPortFields(arc))}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...arc });
      continue;
    }
    prev.volume_bbl += arc.volume_bbl;
    prev.row_count += arc.row_count;
  }
  return [...byKey.values()]
    .sort((a, b) => b.volume_bbl - a.volume_bbl)
    .slice(0, maxLines);
}

type PortCorridorSlice = {
  fields: UsPortFields;
  volume_bbl: number;
  discharge: { lat: number; lng: number; label: string };
};

function portSlicesForOrigin(
  origin: EiaHistoricMapOrigin,
  geoArcs: EiaHistoricMapArcGeo[],
): PortCorridorSlice[] {
  const fromTop = (origin.top_ports ?? []).filter((p) => p.volume_bbl > 0);
  if (fromTop.length > 0) {
    return fromTop.map((p) => ({
      fields: {
        port_city: p.port_city,
        port_state: p.port_state,
        port_code: p.port_code,
        port_label: p.port_label,
      },
      volume_bbl: p.volume_bbl,
      discharge: dischargeFromHistoricPort(p),
    }));
  }
  const byPort = new Map<string, PortCorridorSlice>();
  for (const arc of geoArcs) {
    if (arc.origin_country !== origin.origin_country) continue;
    const key = portSliceKey(arcPortFields(arc));
    const prev = byPort.get(key);
    if (!prev) {
      byPort.set(key, {
        fields: arcPortFields(arc),
        volume_bbl: arc.volume_bbl,
        discharge: {
          lat: arc.discharge[0],
          lng: arc.discharge[1],
          label: arc.discharge_label,
        },
      });
    } else {
      prev.volume_bbl += arc.volume_bbl;
    }
  }
  return [...byPort.values()].sort((a, b) => b.volume_bbl - a.volume_bbl);
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
  /** Opens detail drawer (explicit action — not on every map click). */
  onViewArcDetails?: (selection: HistoricArcSelection) => void;
};

const HUB_COLOR = '#8b5cf6';

function arcSelectionKey(arc: EiaHistoricMapArc): string {
  return [
    arc.origin_country,
    arc.commodity_family,
    arc.port_city ?? '',
    arc.port_state ?? '',
    arc.port_code ?? '',
  ].join('::');
}

export default function EiaHistoricMapLayer({
  enabled,
  arcs,
  origins = [],
  year,
  showCorridors = false,
  onSelectImporter,
  onViewArcDetails,
}: Props) {
  const [selectedOriginKey, setSelectedOriginKey] = useState<string | null>(null);
  const [highlightImporter, setHighlightImporter] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSelectedOriginKey(null);
      setHighlightImporter(null);
    }
  }, [enabled]);

  const geoArcs = useMemo(() => arcsToGeo(arcs), [arcs]);

  const corridorArcs = useMemo(
    () => (showCorridors ? aggregateCorridorsByOriginPort(geoArcs, 48) : []),
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

  const selectedPortSlices = useMemo(() => {
    if (!selectedOrigin) return [];
    return portSlicesForOrigin(selectedOrigin, geoArcs);
  }, [selectedOrigin, geoArcs]);

  const selectedCorridors = useMemo(() => {
    if (!selectedOrigin || selectedPortSlices.length === 0) return [];
    const load: LatLngTuple = [selectedOrigin.lat, selectedOrigin.lng];
    const color = commodityColor(dominantCommodity(selectedOrigin));
    return selectedPortSlices.map((slice, idx) => {
      const discharge: LatLngTuple = [slice.discharge.lat, slice.discharge.lng];
      const positions = unwrapLongitudePath(bezierMidpoint(load, discharge, idx));
      const importerRow = highlightImporter
        ? selectedOrigin.top_importers?.find((imp) => imp.importer_name === highlightImporter)
        : undefined;
      const emphasized = Boolean(
        importerRow &&
          portSliceKey(importerPortFields(importerRow)) === portSliceKey(slice.fields),
      );
      const dimmed =
        Boolean(highlightImporter) && !emphasized && selectedPortSlices.length > 1;
      return {
        key: portSliceKey(slice.fields),
        positions,
        discharge,
        dischargeLabel: slice.discharge.label,
        volume_bbl: slice.volume_bbl,
        color,
        weight: emphasized ? 4.5 : dimmed ? 1.5 : Math.min(4, volumeToWeight(slice.volume_bbl)),
        opacity: emphasized ? 0.95 : dimmed ? 0.22 : 0.72,
        arrowSize: emphasized ? 14 : 10,
      };
    });
  }, [selectedOrigin, selectedPortSlices, highlightImporter]);

  if (!enabled || (originPoints.length === 0 && corridorArcs.length === 0)) return null;

  return (
    <LayerGroup>
      <MapClickClear
        onClear={() => {
          setSelectedOriginKey(null);
          setHighlightImporter(null);
        }}
      />

      {showCorridors &&
        !selectedOriginKey &&
        corridorArcs.map((arc, idx) => {
          const bent = bezierMidpoint(arc.load, arc.discharge, idx);
          const positions = unwrapLongitudePath(bent);
          const color = commodityColor(arc.commodity_family);
          const weight = Math.min(4, volumeToWeight(arc.volume_bbl));
          const openDetails = () => {
            if (year == null || !onViewArcDetails) return;
            onViewArcDetails({ arc, year });
          };
          return (
            <ArrowPolyline
              key={`corridor-${arcSelectionKey(arc)}-${arc.discharge_label}`}
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
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  openDetails();
                },
              }}
            >
              {onViewArcDetails && (
                <Popup className="eia-historic-leaflet-popup" maxWidth={280}>
                  <div className="eia-historic-popup-card">
                    <p className="eia-historic-popup-title">
                      {arc.origin_label} → {arc.discharge_label}
                    </p>
                    <p className="eia-historic-popup-sub capitalize">
                      {arc.commodity_family} · {year ?? '—'}
                    </p>
                    <span className="eia-historic-popup-tier">Historic · EIA</span>
                    <button type="button" className="eia-historic-importer-btn mt-2 w-full" onClick={openDetails}>
                      View details
                    </button>
                  </div>
                </Popup>
              )}
            </ArrowPolyline>
          );
        })}

      {selectedCorridors.map((corridor) => {
        const slice = selectedPortSlices.find((s) => portSliceKey(s.fields) === corridor.key);
        const matchingArc = geoArcs.find(
          (a) =>
            a.origin_country === selectedOriginKey &&
            portSliceKey(arcPortFields(a)) === corridor.key,
        );
        const openSliceDetails = () => {
          if (year == null || !onViewArcDetails || !matchingArc) return;
          onViewArcDetails({ arc: matchingArc, year });
        };
        return (
          <ArrowPolyline
            key={`selected-${selectedOriginKey}-${corridor.key}`}
            positions={corridor.positions}
            arrowColor={corridor.color}
            arrowSize={corridor.arrowSize}
            pathOptions={{
              color: corridor.color,
              weight: corridor.weight,
              opacity: corridor.opacity,
              lineCap: 'round',
              lineJoin: 'round',
            }}
            eventHandlers={
              onViewArcDetails && matchingArc
                ? {
                    click: (e) => {
                      L.DomEvent.stopPropagation(e);
                      openSliceDetails();
                    },
                  }
                : undefined
            }
          >
            {onViewArcDetails && matchingArc && slice && (
              <Popup className="eia-historic-leaflet-popup" maxWidth={280}>
                <div className="eia-historic-popup-card">
                  <p className="eia-historic-popup-title">{corridor.dischargeLabel}</p>
                  <p className="eia-historic-popup-sub">
                    {selectedOrigin?.label} · {year ?? '—'}
                  </p>
                  <button type="button" className="eia-historic-importer-btn mt-2 w-full" onClick={openSliceDetails}>
                    View details
                  </button>
                </div>
              </Popup>
            )}
          </ArrowPolyline>
        );
      })}
      {selectedCorridors.map((corridor) => (
        <CircleMarker
          key={`hub-${selectedOriginKey}-${corridor.key}`}
          center={corridor.discharge}
          radius={highlightImporter ? 9 : 8}
          pathOptions={{
            color: '#f5f3ff',
            fillColor: HUB_COLOR,
            fillOpacity: corridor.opacity,
            weight: 2,
          }}
        >
          <Popup className="eia-historic-leaflet-popup" maxWidth={300} minWidth={260}>
            <div className="eia-historic-popup-card eia-historic-popup-card--hub">
              <p className="eia-historic-popup-title">{corridor.dischargeLabel}</p>
              <p className="eia-historic-popup-sub">
                U.S. discharge · {selectedOrigin?.label} ({year ?? '—'})
              </p>
              <span className="eia-historic-popup-tier">Historic · EIA</span>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {originPoints.map((o) => {
        const isSelected = o.origin_country === selectedOriginKey;
        const dimmed = selectedOriginKey != null && !isSelected;
        const primaryPort = originPrimaryPort(o);
        const routeTo =
          (o.top_ports?.length ?? 0) > 1
            ? `${o.top_ports!.length} U.S. ports`
            : primaryPort
              ? dischargeFromHistoricPort(primaryPort).label
              : 'U.S. ports';
        const handleImporterClick = (imp: EiaHistoricOriginImporter) => {
          setSelectedOriginKey(o.origin_country);
          setHighlightImporter(imp.importer_name);
          onSelectImporter?.(imp.importer_name);
        };
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
                setHighlightImporter(null);
                setSelectedOriginKey(o.origin_country);
              },
            }}
          >
            <Popup
              className="eia-historic-leaflet-popup"
              maxWidth={340}
              minWidth={280}
              eventHandlers={{
                add: () => {
                  setHighlightImporter(null);
                  setSelectedOriginKey(o.origin_country);
                },
              }}
            >
              <EiaHistoricOriginPopup
                label={o.label}
                origin={o}
                year={year}
                routeLabel={`${o.label} → ${routeTo}`}
                onSelectImporter={handleImporterClick}
              />
            </Popup>
          </CircleMarker>
        );
      })}
    </LayerGroup>
  );
}
