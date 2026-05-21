import { useMemo } from 'react';
import { LayerGroup, Polyline } from 'react-leaflet';
import {
  bezierMidpoint,
  type LatLngTuple,
} from '../../lib/corridorGeometry';
import {
  countryCentroid,
  US_IMPORT_HUB,
  type CountryCentroid,
} from '../../lib/countryCentroids';
import type { EiaHistoricMapArc } from '../../api/eiaHistoricApi';

export type EiaHistoricMapArcGeo = EiaHistoricMapArc & {
  load: LatLngTuple;
  discharge: LatLngTuple;
  origin_label: string;
};

export function arcsToGeo(arcs: EiaHistoricMapArc[]): EiaHistoricMapArcGeo[] {
  const out: EiaHistoricMapArcGeo[] = [];
  for (const arc of arcs) {
    const origin = countryCentroid(arc.origin_country);
    if (!origin) continue;
    out.push({
      ...arc,
      load: [origin.lat, origin.lng],
      discharge: [US_IMPORT_HUB.lat, US_IMPORT_HUB.lng],
      origin_label: origin.label,
    });
  }
  return out;
}

type Props = {
  enabled: boolean;
  arcs: EiaHistoricMapArc[];
};

const HISTORIC_COLOR = '#a855f7';

export default function EiaHistoricMapLayer({ enabled, arcs }: Props) {
  const geoArcs = useMemo(() => arcsToGeo(arcs), [arcs]);

  if (!enabled || geoArcs.length === 0) return null;

  return (
    <LayerGroup>
      {geoArcs.map((arc, idx) => {
        const pts = bezierMidpoint(arc.load, arc.discharge, idx);
        return (
          <Polyline
            key={`${arc.origin_country}-${arc.commodity_family}-${idx}`}
            positions={pts}
            pathOptions={{
              color: HISTORIC_COLOR,
              weight: 2.5,
              opacity: 0.75,
              dashArray: '10 8',
            }}
          />
        );
      })}
    </LayerGroup>
  );
}

export { US_IMPORT_HUB, type CountryCentroid };
