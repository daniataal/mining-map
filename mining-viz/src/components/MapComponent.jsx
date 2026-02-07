import { useEffect, useState, useMemo, useRef } from 'react';
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
    const isGold = color === '#FFD700';
    const size = isHovered ? 24 : (isGold ? 14 : 10);
    const border = isHovered ? '2px solid white' : (isGold ? '1px solid rgba(255, 255, 255, 0.9)' : '1px solid rgba(255, 255, 255, 0.7)');

    // Gold gets a special "Pulse" or stronger glow
    let boxShadow;
    if (isGold) {
        boxShadow = isHovered
            ? '0 0 20px rgba(255, 215, 0, 0.8), 0 0 10px rgba(255, 215, 0, 0.6)'
            : '0 0 12px rgba(255, 215, 0, 0.6), 0 0 6px rgba(255, 215, 0, 0.4)';
    } else {
        boxShadow = isHovered
            ? `0 0 15px ${color}`
            : `0 0 8px ${color}`;
    }

    return new L.DivIcon({
        className: 'custom-marker',
        html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: ${border}; box-shadow: ${boxShadow}; transition: all 0.3s ease;"></div>`,
        iconSize: isHovered ? [24, 24] : [size, size],
        iconAnchor: isHovered ? [12, 12] : [size / 2, size / 2],
        popupAnchor: [0, -10]
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

    if (!commodity) return '#64748b'; // Slate-500
    const c = commodity.toLowerCase();

    // GOLD - Premium Glow
    if (c.includes('gold')) return '#FFD700'; // Gold (Real Gold color)

    // Others - Aligned styles (slightly muted to let Gold pop)
    if (c.includes('diamond')) return '#60a5fa'; // Blue
    if (c.includes('bauxite')) return '#f87171'; // Red
    if (c.includes('manganese')) return '#a78bfa'; // Purple
    if (c.includes('lithium')) return '#34d399'; // Emerald
    if (c.includes('iron')) return '#f87171'; // Red
    if (c.includes('salt')) return '#fbbf24'; // Amber

    return '#64748b'; // Slate-500
};

// Component to handle map flyTo effects
const MapEffect = ({ selectedItem }) => {
    const map = useMap();
    useEffect(() => {
        if (selectedItem && selectedItem.lat && selectedItem.lng) {
            const currentZoom = map.getZoom();
            const targetZoom = Math.max(currentZoom, 16);
            map.flyTo([selectedItem.lat, selectedItem.lng], targetZoom, {
                duration: 1.5
            });
        }
    }, [selectedItem, map]);
    return null;
};


const MapComponent = ({ processedData, userAnnotations, selectedItem, setSelectedItem, mapCenter, PopupForm, updateAnnotation, deleteLicense, commodities, licenseTypes, isMobile, handleOpenDossier }) => {
    const [geoJsonData, setGeoJsonData] = useState(null);

    // Effect to handle map resize
    const mapRef = useRef(null);
    useEffect(() => {
        const handleResize = () => {
            if (mapRef.current) {
                mapRef.current.invalidateSize();
            }
        };

        // ResizeObserver for more robust detection of container changes
        const resizeObserver = new ResizeObserver(() => {
            if (mapRef.current) {
                mapRef.current.invalidateSize();
            }
        });

        const mapContainer = document.querySelector('.map-wrapper');
        if (mapContainer) {
            resizeObserver.observe(mapContainer);
        }

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
        };
    }, []);

    useEffect(() => {
        // Fetch simplified world borders
        fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json')
            .then(res => res.json())
            .then(data => setGeoJsonData(data))
            .catch(err => console.error("Failed to load country borders", err));
    }, []);

    const markerRefs = useRef({});

    useEffect(() => {
        if (selectedItem) {
            // Small delay to allow flyTo and unclustering to happen
            const timer = setTimeout(() => {
                const marker = markerRefs.current[selectedItem.id];
                if (marker) {
                    marker.openPopup();
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [selectedItem]);

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
        <div className="map-wrapper" style={{ position: 'relative' }}>
            {processedData.length === 0 && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 1000,
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    padding: '20px 40px',
                    borderRadius: '12px',
                    color: '#94a3b8',
                    textAlign: 'center',
                    border: '1px solid #334155',
                    pointerEvents: 'none' // allow clicking through if needed, though usually empty state means reset filters
                }}>
                    <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🔍</div>
                    <h3 style={{ margin: 0, color: '#f8fafc' }}>No Licenses Found</h3>
                    <p style={{ margin: '5px 0 0 0' }}>Try adjusting your filters</p>
                </div>
            )}
            <MapContainer ref={mapRef} center={mapCenter} zoom={7} style={{ height: '100%', width: '100%' }}>
                <MapEffect selectedItem={selectedItem} />
                <LayersControl position="topright">
                    <LayersControl.BaseLayer checked name="Dark Matter (Default)">
                        <TileLayer
                            attribution=""
                            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                            maxNativeZoom={19}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>

                    <LayersControl.BaseLayer name="Light (Clean)">
                        <TileLayer
                            attribution=""
                            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                            maxNativeZoom={19}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>

                    <LayersControl.BaseLayer name="Topographic (Terrain)">
                        <TileLayer
                            attribution=""
                            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                            maxNativeZoom={17}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>

                    <LayersControl.BaseLayer name="NatGeo (Esri)">
                        <TileLayer
                            attribution=""
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
                            attribution=""
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                            maxNativeZoom={19}
                            maxZoom={25}
                        />
                    </LayersControl.BaseLayer>

                    <LayersControl.BaseLayer name="Street Map (Color)">
                        <TileLayer
                            attribution=""
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
                                ref={(el) => (markerRefs.current[item.id] = el)}
                                eventHandlers={{
                                    click: () => setSelectedItem(item),
                                }}
                            >
                                <Popup
                                    offset={[0, -20]}
                                    maxWidth={300}
                                    minWidth={250}
                                    eventHandlers={{
                                        remove: () => setSelectedItem(null)
                                    }}
                                >
                                    <PopupForm
                                        item={item}
                                        annotation={annotation}
                                        updateAnnotation={updateAnnotation}
                                        onDelete={() => deleteLicense(item.id)}
                                        commodities={commodities}
                                        licenseTypes={licenseTypes}
                                        isMobile={isMobile}
                                        onOpenDossier={() => handleOpenDossier(item)}
                                        isOpen={selectedItem?.id === item.id}
                                    />
                                </Popup>
                            </Marker>
                        );
                    })}
                </MarkerClusterGroup>
            </MapContainer>
        </div>
    );
};

export default MapComponent;
