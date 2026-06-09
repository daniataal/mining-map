import { useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { bezierMidpoint, type LatLngTuple } from '../../lib/corridorGeometry';
import { countryCentroid } from '../../lib/countryCentroids';
import type { MacroTradeFlow } from '../../api/oilLiveApi';
import CanvasLiveDealLayer from '../../components/petroleum/CanvasLiveDealLayer';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';

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
  const map = useMap();
  const popupRef = useRef<L.Popup | null>(null);
  const arcs = useMemo(() => flowsToMacroArcs(flows), [flows]);
  const features = useMemo<LiveDealMapFeature[]>(
    () =>
      arcs.map((arc, idx) => {
        const weight = Math.min(5, 1.5 + Math.log10(Math.max(arc.trade_value_usd, 1)) * 0.35);
        const pts = bezierMidpoint(arc.load, arc.discharge, idx);
        return {
          shape: 'arc',
          uid: `macro-flow:${arc.key}`,
          id: arc.key,
          kind: 'trade_flow',
          positions: pts,
          popupLat: pts[1]?.[0] ?? arc.load[0],
          popupLng: pts[1]?.[1] ?? arc.load[1],
          title: `${arc.partner} → ${arc.reporter}`,
          subtitle: `${arc.hs_code || 'HS'} · $${Math.round(arc.trade_value_usd).toLocaleString()}`,
          tier: 'macro',
          confidence: 0.65,
          sourceCount: 1,
          dealScore: Math.min(1, Math.log10(Math.max(arc.trade_value_usd, 1)) / 10),
          styleKey: arc.hs_code,
          color: MACRO_COLOR,
          weight,
          opacity: 0.55,
          dashArray: '4 6',
          data: arc,
        };
      }),
    [arcs],
  );

  if (!enabled || arcs.length === 0) return null;

  return (
    <CanvasLiveDealLayer
      features={features}
      mapZoom={5}
      selectedUid={null}
      onFeatureClick={(feature) => {
        const arc = feature.data as MacroTradeFlowArc | undefined;
        if (!arc) return;
        popupRef.current?.remove();
        popupRef.current = L.popup({ className: 'macro-trade-flow-popup', maxWidth: 300 })
          .setLatLng([feature.popupLat ?? arc.load[0], feature.popupLng ?? arc.load[1]])
          .setContent(
            `<div class="text-xs space-y-1">
              <p class="font-bold text-slate-100">${arc.partner} → ${arc.reporter}</p>
              <p class="text-slate-300">HS ${arc.hs_code || '—'} · $${Math.round(arc.trade_value_usd).toLocaleString()} trade value (macro)</p>
              <p class="text-slate-500">Open-data macro flow — verify before commercial use.</p>
            </div>`,
          )
          .openOn(map);
      }}
    />
  );
}
