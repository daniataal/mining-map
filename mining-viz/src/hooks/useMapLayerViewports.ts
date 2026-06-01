import { useCallback, useState } from 'react';
import type { MaritimeViewportBounds } from '../types';

export type MapLayerViewportState = {
  licenseViewport: MaritimeViewportBounds | null;
  oilGasMapViewport: MaritimeViewportBounds | null;
  liveDataMapViewport: MaritimeViewportBounds | null;
  maritimeViewport: MaritimeViewportBounds | null;
  currentVisibleViewport: MaritimeViewportBounds | null;
};

const initial: MapLayerViewportState = {
  licenseViewport: null,
  oilGasMapViewport: null,
  liveDataMapViewport: null,
  maritimeViewport: null,
  currentVisibleViewport: null,
};

/**
 * Central viewport state for map layers — one debounced tracker per layer family
 * should call these setters from MapComponent's ViewportBoundsTracker.
 */
export function useMapLayerViewports() {
  const [state, setState] = useState<MapLayerViewportState>(initial);

  const setLicenseViewport = useCallback((bbox: MaritimeViewportBounds | null) => {
    setState((s) => ({ ...s, licenseViewport: bbox }));
  }, []);

  const setOilGasMapViewport = useCallback((bbox: MaritimeViewportBounds | null) => {
    setState((s) => ({ ...s, oilGasMapViewport: bbox }));
  }, []);

  const setLiveDataMapViewport = useCallback((bbox: MaritimeViewportBounds | null) => {
    setState((s) => ({ ...s, liveDataMapViewport: bbox }));
  }, []);

  const setMaritimeViewport = useCallback((bbox: MaritimeViewportBounds | null) => {
    setState((s) => ({ ...s, maritimeViewport: bbox }));
  }, []);

  const setCurrentVisibleViewport = useCallback((bbox: MaritimeViewportBounds | null) => {
    setState((s) => ({ ...s, currentVisibleViewport: bbox }));
  }, []);

  return {
    ...state,
    setLicenseViewport,
    setOilGasMapViewport,
    setLiveDataMapViewport,
    setMaritimeViewport,
    setCurrentVisibleViewport,
  };
}
