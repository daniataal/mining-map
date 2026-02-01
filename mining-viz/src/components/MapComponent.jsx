import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, useMap, LayersControl, useMapEvents, Marker, Popup, CircleMarker } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import HeatmapLayer from './HeatmapLayer';

// Fix for default marker icon in React Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom Icons
const createCustomIcon = (color, isHovered, riskStatus = null) => {
    const size = isHovered ? 24 : 12;
    const border = isHovered ? '3px solid white' : '2px solid white';

    let boxShadow = isHovered ? '0 0 10px rgba(0,0,0,0.8)' : '0 0 4px rgba(0,0,0,0.5)';

    if (riskStatus) {
        let haloColor = '#ef4444'; // Red (High Risk/Unverified)
        if (riskStatus === 'fully_verified') haloColor = '#22c55e'; // Green
        else if (riskStatus === 'partially_verified') haloColor = '#eab308'; // Yellow

        // Heavy halo
        boxShadow = `0 0 0 4px ${haloColor}, 0 0 15px ${haloColor}`;
    }

    return new L.DivIcon({
        className: 'custom-marker',
        html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: ${border}; box-shadow: ${boxShadow}; transition: all 0.2s ease;"></div>`,
        iconSize: isHovered ? [28, 28] : [16, 16],
        iconAnchor: isHovered ? [14, 14] : [8, 8],
        popupAnchor: [0, -8]
    });
};

const getMarkerColor = (commodity, userStatus) => {
    if (userStatus === 'good') return '#22c55e';
    if (userStatus === 'bad') return '#ef4444';
    if (userStatus === 'maybe') return '#f59e0b';
    if (!commodity) return '#94a3b8';
    const c = commodity.toLowerCase();
    if (c.includes('gold')) return '#fbbf24';
    if (c.includes('diamond')) return '#60a5fa';
    if (c.includes('bauxite')) return '#f87171';
    if (c.includes('manganese')) return '#a78bfa';
    if (c.includes('lithium')) return '#34d399';
    if (c.includes('iron')) return '#ef4444';
    if (c.includes('salt')) return '#fcd34d';
    return '#94a3b8';
};

// Component to handle map flyTo effects
const MapEffect = ({ selectedItem }) => {
    const map = useMap();
    useEffect(() => {
        if (selectedItem && selectedItem.lat && selectedItem.lng) {
            map.flyTo([selectedItem.lat, selectedItem.lng], 12, {
                duration: 2.0
            });
        }
    }, [selectedItem, map]);
    return null;
};

// Component to track zoom level
const ZoomHandler = ({ setZoom }) => {
    const map = useMapEvents({
        zoomend: () => {
            setZoom(map.getZoom());
        },
    });
    return null;
};

const MapComponent = ({
    processedData, userAnnotations, selectedItem, setSelectedItem, mapCenter,
    PopupForm, updateAnnotation, deleteLicense, commodities, licenseTypes,
    mapMode = 'operations'
}) => {
    const [zoom, setZoom] = useState(7);

    // Helpers
    const getRiskStatus = (annotation) => {
        const v = annotation.verification || {};
        if (v.siteVisit) return 'fully_verified';
        if (v.govMatch || v.taxClearance) return 'partially_verified';
        return 'unverified';
    };

    const getValue = (item, annotation) => {
        const qty = parseFloat(annotation.quantity || 0);
        const price = parseFloat(annotation.price || 0);
        const val = qty * price;
        return val > 0 ? val : 1000; // Default small value
    };

    // Render Logic per mode
    const renderOperations = () => (
        <MarkerClusterGroup chunkedLoading spiderfyOnMaxZoom={true} showCoverageOnHover={false} maxClusterRadius={40}>
            {processedData.map((item, idx) => {
                if (!item.lat || !item.lng) return null;
                const annotation = userAnnotations[item.id] || {};
                const color = getMarkerColor(annotation.commodity || item.commodity, annotation.status);
                const isSelected = selectedItem?.id === item.id;
                return (
                    <Marker
                        key={item.id || idx}
                        position={[item.lat, item.lng]}
                        icon={createCustomIcon(color, isSelected)}
                        eventHandlers={{ click: () => setSelectedItem(item) }}
                    >
                        <Popup offset={[0, -20]} maxWidth={300} minWidth={250}>
                            <PopupForm item={item} annotation={annotation} updateAnnotation={updateAnnotation} onDelete={() => deleteLicense(item.id)} commodities={commodities} licenseTypes={licenseTypes} />
                        </Popup>
                    </Marker>
                );
            })}
        </MarkerClusterGroup>
    );

    const renderIntelligence = () => {
        if (zoom < 8) {
            // Heatmap
            const points = processedData.map(item => {
                const annotation = userAnnotations[item.id] || {};
                const val = getValue(item, annotation);
                // Normalize intensity roughly. Log scale might be better.
                const intensity = Math.min(val / 100000, 1.0);
                return [item.lat, item.lng, intensity]; // Standard format for leaflet.heat
            }).filter(p => p[0] && p[1]);

            return <HeatmapLayer points={points} options={{ radius: 25, blur: 15, maxZoom: 10 }} />;
        } else {
            // Circles
            return processedData.map((item, idx) => {
                const annotation = userAnnotations[item.id] || {};
                const color = getMarkerColor(annotation.commodity || item.commodity, annotation.status);
                const val = getValue(item, annotation);
                // Radius based on value
                const radius = Math.min(Math.max(Math.sqrt(val) / 10, 5), 50);

                return (
                    <CircleMarker
                        key={item.id || idx}
                        center={[item.lat, item.lng]}
                        radius={radius}
                        pathOptions={{ color: color, fillColor: color, fillOpacity: 0.6 }}
                        eventHandlers={{ click: () => setSelectedItem(item) }}
                    >
                        <Popup offset={[0, -20]} maxWidth={300} minWidth={250}>
                            <PopupForm item={item} annotation={annotation} updateAnnotation={updateAnnotation} onDelete={() => deleteLicense(item.id)} commodities={commodities} licenseTypes={licenseTypes} />
                        </Popup>
                    </CircleMarker>
                )
            });
        }
    };

    const renderRisk = () => {
        return processedData.map((item, idx) => {
            if (!item.lat || !item.lng) return null;
            const annotation = userAnnotations[item.id] || {};
            const color = getMarkerColor(annotation.commodity || item.commodity, annotation.status);
            const isSelected = selectedItem?.id === item.id;
            const riskStatus = getRiskStatus(annotation);

            // Note: No clustering in Risk mode to clearly see individual risks
            return (
                <Marker
                    key={item.id || idx}
                    position={[item.lat, item.lng]}
                    icon={createCustomIcon(color, isSelected, riskStatus)}
                    eventHandlers={{ click: () => setSelectedItem(item) }}
                    opacity={0.9} // Slight dim as requested
                >
                    <Popup offset={[0, -20]} maxWidth={300} minWidth={250}>
                        <PopupForm item={item} annotation={annotation} updateAnnotation={updateAnnotation} onDelete={() => deleteLicense(item.id)} commodities={commodities} licenseTypes={licenseTypes} />
                    </Popup>
                </Marker>
            );
        });
    };

    return (
        <div className="map-wrapper">
            <MapContainer center={mapCenter} zoom={7} style={{ height: '100%', width: '100%' }}>
                <MapEffect selectedItem={selectedItem} />
                <ZoomHandler setZoom={setZoom} />

                <LayersControl position="topright">
                    <LayersControl.BaseLayer checked name="Dark Matter">
                        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="CARTO" />
                    </LayersControl.BaseLayer>
                    <LayersControl.BaseLayer name="Satellite">
                        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Esri" />
                    </LayersControl.BaseLayer>
                    <LayersControl.BaseLayer name="Clean Light">
                        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="CARTO" />
                    </LayersControl.BaseLayer>
                </LayersControl>

                {mapMode === 'operations' && renderOperations()}
                {mapMode === 'intelligence' && renderIntelligence()}
                {mapMode === 'risk' && renderRisk()}

            </MapContainer>
        </div>
    );
};

export default MapComponent;
