import { useMemo } from 'react';
import { LayerGroup, Polyline } from 'react-leaflet';
import { bezierMidpoint, type LatLngTuple } from '../../lib/corridorGeometry';
import { countryCentroid } from '../../lib/countryCentroids';
import type { MacroTradeFlow } from '../../api/oilLiveApi';

export type MacroTradeFlowArc = {
  key: string;
  partner: string;
  reporter: string;
  hs_code: string;
  trade_value_usd: number;
  load: LatLngTuple;
  discharge: LatLngTuple;
};

export function flowsToMacroArcs(flows: MacroTradeFlow[]): MacroTradeFlowArc[] {
  const acc = new Map<string, MacroTradeFlowArc>();
  for (const f of flows) {
    const partner = (f.partner ?? '').trim();
    const reporter = (f.reporter ?? '').trim();
    if (!partner || !reporter) continue;
    const from = countryCentroid(partner);
    const to = countryCentroid(reporter);
    if (!from || !to) continue;
    const key = `${partner}|${reporter}|${f.hs_code ?? ''}`;
    const val = f.trade_value_usd ?? 0;
    const existing = acc.get(key);
    if (existing) {
      existing.trade_value_usd += val;
    } else {
      acc.set(key, {
        key,
        partner,
        reporter,
        hs_code: f.hs_code ?? '',
        trade_value_usd: val,
        load: [from.lat, from.lng],
        discharge: [to.lat, to.lng],
      });
    }
  }
  return [...acc.values()]
    .filter((a) => a.trade_value_usd > 0)
    .sort((a, b) => b.trade_value_usd - a.trade_value_usd)
    .slice(0, 80);
}

type Props = {
  enabled: boolean;
  flows: MacroTradeFlow[];
};

const MACRO_COLOR = '#64748b';

export default function MacroTradeFlowsMapLayer({ enabled, flows }: Props) {
  const arcs = useMemo(() => flowsToMacroArcs(flows), [flows]);

  if (!enabled || arcs.length === 0) return null;

  return (
    <LayerGroup>
      {arcs.map((arc, idx) => {
        const weight = Math.min(5, 1.5 + Math.log10(Math.max(arc.trade_value_usd, 1)) * 0.35);
        const pts = bezierMidpoint(arc.load, arc.discharge, idx);
        return (
          <Polyline
            key={arc.key}
            positions={pts}
            pathOptions={{
              color: MACRO_COLOR,
              weight,
              opacity: 0.55,
              dashArray: '4 6',
            }}
          />
        );
      })}
    </LayerGroup>
  );
}
