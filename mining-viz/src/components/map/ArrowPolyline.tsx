import { useEffect, useState, type ReactNode } from 'react';
import { Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-polylinedecorator';
import type { LatLngTuple } from '../../lib/corridorGeometry';

export type ArrowPolylineProps = {
  positions: LatLngTuple[];
  pathOptions: L.PathOptions;
  arrowColor: string;
  arrowSize?: number;
  children?: ReactNode;
  eventHandlers?: L.LeafletEventHandlerFnMap;
};

/** Curved polyline with arrowhead at the discharge (last) end. */
export default function ArrowPolyline({
  positions,
  pathOptions,
  arrowColor,
  arrowSize = 12,
  children,
  eventHandlers,
}: ArrowPolylineProps) {
  const map = useMap();
  const [polyline, setPolyline] = useState<L.Polyline | null>(null);

  useEffect(() => {
    if (!polyline) return;
    const decoratorFactory = (L as unknown as { polylineDecorator?: typeof L.polylineDecorator })
      .polylineDecorator;
    if (typeof decoratorFactory !== 'function') return;
    let decorator: L.PolylineDecorator;
    try {
      decorator = decoratorFactory(polyline, {
        patterns: [
          {
            offset: '100%',
            repeat: 0,
            symbol: L.Symbol.arrowHead({
              pixelSize: arrowSize,
              polygon: false,
              pathOptions: {
                stroke: true,
                color: arrowColor,
                weight: Math.max(2, Math.min(5, (pathOptions.weight as number) ?? 3)),
                opacity: pathOptions.opacity ?? 1,
              },
            }),
          },
        ],
      });
    } catch {
      return;
    }
    decorator.addTo(map);
    return () => {
      decorator.remove();
    };
  }, [map, polyline, arrowColor, arrowSize, pathOptions.opacity, pathOptions.weight]);

  return (
    <Polyline
      positions={positions}
      pathOptions={pathOptions}
      eventHandlers={eventHandlers}
      ref={(instance) => {
        setPolyline((current) => (current === instance ? current : instance ?? null));
      }}
    >
      {children}
    </Polyline>
  );
}
