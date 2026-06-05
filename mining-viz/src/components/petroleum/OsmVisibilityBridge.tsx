import { useEffect, useRef } from 'react';

/** Sync Leaflet LayersControl overlay toggles to parent visibility state. */
export function OsmVisibilityBridge({
  onEnable,
  onDisable,
}: {
  onEnable: () => void;
  onDisable: () => void;
}) {
  const onEnableRef = useRef(onEnable);
  const onDisableRef = useRef(onDisable);
  onEnableRef.current = onEnable;
  onDisableRef.current = onDisable;

  useEffect(() => {
    onEnableRef.current();
    return () => onDisableRef.current();
  }, []);
  return null;
}
