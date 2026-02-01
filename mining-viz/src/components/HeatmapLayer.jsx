import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';

const HeatmapLayer = ({ points, options }) => {
    const map = useMap();

    useEffect(() => {
        if (!points || points.length === 0) return;

        // Points format: [lat, lng, intensity]
        const heat = L.heatLayer(points, options).addTo(map);

        return () => {
            map.removeLayer(heat);
        };
    }, [points, options, map]);

    return null;
};

export default HeatmapLayer;
