import { useMemo } from 'react';
import { Polyline } from 'react-leaflet';
import type { MaritimeVessel } from '../../lib/vessels/types';
import { buildAisProjectedRoute } from '../../lib/vessels/aisProjectedRoute';
import { useVesselTrack } from '../../hooks/useVesselTrack';

const TRACK_PATH_OPTIONS = {
  color: '#22d3ee',
  weight: 2.5,
  opacity: 0.9,
  dashArray: '6, 5',
  interactive: false,
} as const;

const PROJECTED_PATH_OPTIONS = {
  color: '#c084fc',
  weight: 2.25,
  opacity: 0.82,
  dashArray: '10, 7',
  interactive: false,
} as const;

type MaritimeVesselFocusLayersProps = {
  vessel: MaritimeVessel;
};

export default function MaritimeVesselFocusLayers({ vessel }: MaritimeVesselFocusLayersProps) {
  const { path: trackPath } = useVesselTrack(vessel.mmsi, 24, true);
  const projected = useMemo(() => buildAisProjectedRoute(vessel), [vessel]);

  return (
    <>
      {trackPath.length >= 2 && <Polyline positions={trackPath} pathOptions={TRACK_PATH_OPTIONS} />}
      {projected.status === 'ready' && projected.path.length >= 2 && (
        <Polyline positions={projected.path} pathOptions={PROJECTED_PATH_OPTIONS} />
      )}
    </>
  );
}
