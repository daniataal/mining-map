import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, useMap, LayersControl } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Marker, Popup, GeoJSON } from 'react-leaflet';

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
const createCustomIcon = (color, isHovered) => {
    const size = isHovered ? 24 : 12;
    const border = isHovered ? '3px solid white' : '2px solid white';
    const boxShadow = isHovered ? '0 0 10px rgba(0,0,0,0.8)' : '0 0 4px rgba(0,0,0,0.5)';

    return new L.DivIcon({
        className: 'custom-marker',
        html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: ${border}; box-shadow: ${boxShadow}; transition: all 0.2s ease;"></div>`,
        iconSize: isHovered ? [28, 28] : [16, 16],
        iconAnchor: isHovered ? [14, 14] : [8, 8],
        popupAnchor: [0, -8]
    });
};

const createClusterCustomIcon = function (cluster) {
    const count = cluster.getChildCount();
    let size = 40;
    if (count > 10) size = 50;
    if (count > 100) size = 60;

    return L.divIcon({
        html: `<div class="custom-cluster-icon" style="width: ${size}px; height: ${size}px;">${count}</div>`,
        className: 'cluster-marker-wrapper', // meaningful styles are in inner div
        iconSize: L.point(size, size, true),
    });
};

const getMarkerColor = (commodity, userStatus) => {
    // User override
    if (userStatus === 'good') return '#22c55e'; // Green-500
    if (userStatus === 'bad') return '#ef4444'; // Red-500
    if (userStatus === 'maybe') return '#f59e0b'; // Amber-500 (Orange)

    if (!commodity) return '#94a3b8';
    const c = commodity.toLowerCase();
    if (c.includes('gold')) return '#fbbf24'; // Amber-400
    if (c.includes('diamond')) return '#60a5fa'; // Blue-400
    if (c.includes('bauxite')) return '#f87171'; // Red-400
    if (c.includes('manganese')) return '#a78bfa'; // Purple-400
    if (c.includes('lithium')) return '#34d399'; // Emerald-400
    if (c.includes('iron')) return '#ef4444'; // Red-500
    if (c.includes('salt')) return '#fcd34d'; // Amber-300
    return '#94a3b8'; // Slate-400
};

// Component to handle map flyTo effects
const MapEffect = ({ selectedItem }) => {
    const map = useMap();
    useEffect(() => {
        if (selectedItem && selectedItem.lat && selectedItem.lng) {
            const currentZoom = map.getZoom();
            const targetZoom = Math.max(currentZoom, 14);
            map.flyTo([selectedItem.lat, selectedItem.lng], targetZoom, {
                duration: 2.0
            });
        }
    }, [selectedItem, map]);
    return null;
};


const MapComponent = ({ processedData, userAnnotations, selectedItem, setSelectedItem, mapCenter, PopupForm, updateAnnotation, deleteLicense, commodities, licenseTypes, isMobile }) => {
    const [geoJsonData, setGeoJsonData] = useState(null);

    useEffect(() => {
        // Fetch simplified world borders
        fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json')
            .then(res => res.json())
            .then(data => setGeoJsonData(data))
            .catch(err => console.error("Failed to load country borders", err));
    }, []);

    const activeCountries = useMemo(() => {
        const countries = new Set(processedData.map(d => d.country ? d.country.toLowerCase() : 'ghana'));
        return Array.from(countries);
    }, [processedData]);

    const filteredGeoJson = useMemo(() => {
        if (!geoJsonData) return null;
        return {
            ...geoJsonData,
            features: geoJsonData.features.filter(f => {
                const name = f.properties.name.toLowerCase();
                // Check exact match or if active country is part of the name (e.g. "Republic of Ghana" match "Ghana")
                // Normalized check:
                return activeCountries.some(ac => name.includes(ac) || ac === 'ghana' && name === 'ghana');
            })
        };
    }, [geoJsonData, activeCountries]);
    return (
        <div className="map-wrapper">
            <MapContainer center={mapCenter} zoom={7} style={{ height: '100%', width: '100%' }}>
                <MapEffect selectedItem={selectedItem} />
                <LayersControl position="topright">
                    <LayersControl.BaseLayer checked name="Dark Matter (Default)">
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                            maxNativeZoom={19}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>

                    <LayersControl.BaseLayer name="Light (Clean)">
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                            maxNativeZoom={19}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>

                    <LayersControl.BaseLayer name="Topographic (Terrain)">
                        <TileLayer
                            attribution='Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
                            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                            maxNativeZoom={17}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>

                    <LayersControl.BaseLayer name="NatGeo (Esri)">
                        <TileLayer
                            attribution='Tiles &copy; Esri &mdash; National Geographic, Esri, DeLorme, NAVTEQ, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, iPC'
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}"
                            maxNativeZoom={16}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>

                    {filteredGeoJson && (
                        <LayersControl.Overlay checked name="Country Borders">
                            <GeoJSON
                                key={activeCountries.join(',')} // Force re-render when countries change
                                data={filteredGeoJson}
                                style={{
                                    className: 'country-border-path',
                                    fillColor: 'transparent',
                                    weight: 2,
                                    color: '#3b82f6',
                                    fillOpacity: 0
                                }}
                            />
                        </LayersControl.Overlay>
                    )}

                    <LayersControl.BaseLayer name="Satellite (Esri)">
                        <TileLayer
                            attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                            maxNativeZoom={19}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>

                    <LayersControl.BaseLayer name="Street Map (Color)">
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            maxNativeZoom={19}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>
                </LayersControl>
                <MarkerClusterGroup
                    chunkedLoading
                    spiderfyOnMaxZoom={true}
                    showCoverageOnHover={false}
                    maxClusterRadius={40}
                    iconCreateFunction={createClusterCustomIcon}
                >
                    {processedData.map((item, idx) => {
                        if (!item.lat || !item.lng) return null;
                        const annotation = userAnnotations[item.id] || {};
                        // If commodity is overridden, use it for color
                        const commodity = annotation.commodity || item.commodity;
                        const color = getMarkerColor(commodity, annotation.status);
                        const isSelected = selectedItem?.id === item.id;

                        return (
                            <Marker
                                key={item.id || idx}
                                position={[item.lat, item.lng]}
                                icon={createCustomIcon(color, isSelected)}
                                eventHandlers={{
                                    click: () => setSelectedItem(item),
                                }}
                            >
                                {!isMobile && (
                                    <Popup offset={[0, -20]} maxWidth={300} minWidth={250}>
                                        <PopupForm
                                            item={item}
                                            annotation={annotation}
                                            updateAnnotation={updateAnnotation}
                                            onDelete={() => deleteLicense(item.id)}
                                            commodities={commodities}
                                            licenseTypes={licenseTypes}
                                        />
                                    </Popup>
                                )}
                            </Marker>
                        );
                    })}
                </MarkerClusterGroup>
            </MapContainer>
        </div>
    );
};

export default MapComponent;
