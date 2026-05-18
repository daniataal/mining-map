import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/** Leaflet often renders a black/gray tile pane until size is recalculated after layout overlays. */
export default function RoutePlannerMapResizeEffect({
  active,
  resizeKey,
}: {
  active: boolean;
  /** Changes when route results or panel layout updates (triggers invalidateSize). */
  resizeKey?: string | number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!active) return;
    const container = map.getContainer();
    const invalidate = () => {
      map.invalidateSize({ animate: false, pan: false });
    };

    invalidate();
    const t0 = window.setTimeout(invalidate, 80);
    const t1 = window.setTimeout(invalidate, 350);

    const onResize = () => {
      window.requestAnimationFrame(invalidate);
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    observer?.observe(container);
    const parent = container.parentElement;
    if (parent) observer?.observe(parent);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      observer?.disconnect();
    };
  }, [map, active, resizeKey]);

  return null;
}
