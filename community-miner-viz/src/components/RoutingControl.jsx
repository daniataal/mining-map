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
            show: true, // Show the itinerary panel
            collapsible: true, // Allow collapsing the itinerary
            lineOptions: {
                styles: [
                    { color: '#ffffff', opacity: 0.9, weight: 8 },  // white casing
                    { color: '#8b5cf6', opacity: 1, weight: 5 } // vibrant purple inner line
                ]
            },
            createMarker: () => null // Hide default routing markers, we have our own
        }).addTo(map);

        return () => {
            map.removeControl(routingControl);
        };
    }, [map, startNode, endNode]);

    return null;
}
