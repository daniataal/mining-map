import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { ensurePipelineInteractionPane } from '../../lib/pipelineMapInteraction';

/** Ensures pipeline hit targets render above MVT + license layers. */
export default function PipelineInteractionPaneInit() {
  const map = useMap();
  useEffect(() => {
    ensurePipelineInteractionPane(map);
  }, [map]);
  return null;
}
