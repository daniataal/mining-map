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
    const timers = [0, 80, 350, 800, 1500].map((ms) => window.setTimeout(invalidate, ms));

    const onResize = () => {
      window.requestAnimationFrame(invalidate);
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    observer?.observe(container);
    let ancestor: HTMLElement | null = container.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth += 1) {
      observer?.observe(ancestor);
      if (ancestor.classList.contains('map-wrapper')) break;
      ancestor = ancestor.parentElement;
    }

    return () => {
      for (const id of timers) window.clearTimeout(id);
      observer?.disconnect();
    };
  }, [map, active, resizeKey]);

  return null;
}
