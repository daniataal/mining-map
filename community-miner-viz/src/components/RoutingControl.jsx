import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-routing-machine';

export default function RoutingControl({ startNode, endNode }) {
    const map = useMap();

    useEffect(() => {
        if (!startNode || !endNode) return;

        const routingControl = L.Routing.control({
            waypoints: [
                L.latLng(startNode.lat, startNode.lng),
                L.latLng(endNode.lat, endNode.lng)
            ],
            routeWhileDragging: false,
            addWaypoints: false,
            fitSelectedRoutes: true,
            showAlternatives: false,
            lineOptions: {
                styles: [{ color: '#f59e0b', opacity: 0.8, weight: 6 }]
            },
            createMarker: () => null // Hide default routing markers, we have our own
        }).addTo(map);

        return () => {
            map.removeControl(routingControl);
        };
    }, [map, startNode, endNode]);

    return null;
}
