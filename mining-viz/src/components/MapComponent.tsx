import { useEffect, useMemo, useRef } from 'react';
import { useTheme } from 'next-themes';
import { MapContainer, TileLayer, useMap, LayersControl, useMapEvents, Marker, Popup, GeoJSON, ZoomControl, Tooltip } from 'react-leaflet';
// @ts-ignore
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MiningLicense, UserAnnotation } from '../types';
import { useI18n } from '../lib/i18n';
import { applyCollocationJitter } from '../lib/geo';
import COUNTRY_BORDERS from '../data/countryBorders';
import PopupForm from './PopupForm';

// Fix for default marker icon in React Leaflet
// @ts-ignore
import icon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const createCustomIcon = (color: string, isHovered: boolean) => {
    const isGold = color === '#FFD700';
    const size = isHovered ? 24 : (isGold ? 14 : 10);
    const border = isHovered ? '2px solid white' : (isGold ? '1px solid rgba(255, 255, 255, 0.9)' : '1px solid rgba(255, 255, 255, 0.7)');

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
        html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: ${border}; box-shadow: ${boxShadow}; transition: all 0.3s ease; pointer-events: auto; cursor: pointer;"></div>`,
        iconSize: isHovered ? [24, 24] : [size, size],
        iconAnchor: isHovered ? [12, 12] : [size / 2, size / 2],
        popupAnchor: [0, -10]
    });
};

// Applied to the marker root (.leaflet-marker-icon) when an item is the
// active selection. We toggle a class instead of calling setIcon() because
// setIcon replaces the marker's _icon DOM node — and replacing that node
// while a cluster is in spiderfy mode resets every leg back to the centroid,
// which is exactly the bug that made popups fail to open over collocated
// points.
const SELECTED_CLASS = 'is-selected';

const getMarkerColor = (commodity?: string, userStatus?: string) => {
    if (userStatus === 'good') return '#22c55e';
    if (userStatus === 'bad') return '#ef4444';
    if (userStatus === 'maybe') return '#f59e0b';

    if (!commodity) return '#64748b';
    const c = commodity.toLowerCase();
    if (c.includes('gold')) return '#FFD700';
    if (c.includes('diamond')) return '#60a5fa';
    if (c.includes('bauxite')) return '#f87171';
    if (c.includes('manganese')) return '#a78bfa';
    if (c.includes('lithium')) return '#34d399';
    return '#64748b';
};

interface MapComponentProps {
  processedData: MiningLicense[];
  userAnnotations: Record<string, UserAnnotation>;
  selectedItem: MiningLicense | null;
  setSelectedItem: (item: MiningLicense | null) => void;
  mapCenter: [number, number];
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  deleteLicense: (id: string) => void;
  handleOpenDossier: (item: MiningLicense) => void;
  mapFlyTrigger: number;
}

const MapEffect = ({
    selectedItem,
    mapFlyTrigger,
    flyTarget,
}: {
    selectedItem: MiningLicense | null;
    mapFlyTrigger: number;
    // Optional jittered display coords so the camera lands on the marker we
    // actually rendered (matters when the row was nudged due to collocation).
    flyTarget: { lat: number; lng: number } | null;
}) => {
    const map = useMap();
    useEffect(() => {
        if (!selectedItem || mapFlyTrigger <= 0) return;
        const tgt = flyTarget ?? (selectedItem.lat != null && selectedItem.lng != null
            ? { lat: selectedItem.lat, lng: selectedItem.lng }
            : null);
        if (!tgt) return;
        const currentZoom = map.getZoom();
        const targetZoom = Math.max(currentZoom, 16);
        map.flyTo([tgt.lat, tgt.lng], targetZoom, { duration: 1.0 });
    }, [mapFlyTrigger, map, selectedItem, flyTarget]);
    return null;
};

const MapClickHandler = ({ onMapClick }: { onMapClick: () => void }) => {
    useMapEvents({ click: () => onMapClick() });
    return null;
};

export default function MapComponent({
  processedData,
  userAnnotations,
  selectedItem,
  setSelectedItem,
  mapCenter,
  updateAnnotation,
  deleteLicense,
  handleOpenDossier,
  mapFlyTrigger
}: MapComponentProps) {
    const { t } = useI18n();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme !== 'light';
    const mapRef = useRef<L.Map | null>(null);
    const markerRefs = useRef<Record<string, L.Marker>>({});
    const prevSelectedIdRef = useRef<string | null>(null);

    // Jitter rows that share exact coordinates so each marker has a unique
    // anchor for spiderfy + popup. See lib/geo.ts for the rationale.
    const displayData = useMemo(() => applyCollocationJitter(processedData), [processedData]);

    const flyTarget = useMemo(() => {
        if (!selectedItem) return null;
        const j = displayData.find(d => d.id === selectedItem.id);
        if (!j || j._displayLat == null || j._displayLng == null) return null;
        return { lat: j._displayLat, lng: j._displayLng };
    }, [selectedItem, displayData]);

    // Selection-driven side effects:
    //   - toggle a CSS class on the previous & next markers (no setIcon swap
    //     because that would replace the marker DOM node and collapse any
    //     active spiderfy);
    //   - open the popup. For sidebar-driven selection we wait one tick so
    //     the camera flyTo can start; for marker clicks the popup is already
    //     opened synchronously inside the click handler below, so the
    //     openPopup call here is a harmless no-op.
    useEffect(() => {
        const prevId = prevSelectedIdRef.current;
        if (prevId && prevId !== selectedItem?.id) {
            const prevMarker = markerRefs.current[prevId];
            const el = prevMarker?.getElement();
            if (el) el.classList.remove(SELECTED_CLASS);
        }

        if (!selectedItem) {
            prevSelectedIdRef.current = null;
            return;
        }

        const marker = markerRefs.current[selectedItem.id];
        const el = marker?.getElement();
        if (el) el.classList.add(SELECTED_CLASS);
        if (marker && !marker.isPopupOpen?.()) {
            // Defer openPopup so flyTo (from the sidebar path) and any
            // pending cluster animation can settle. If the popup is already
            // open from a synchronous marker-click handler this is a no-op.
            const handle = setTimeout(() => {
                if (markerRefs.current[selectedItem.id] === marker) marker.openPopup();
            }, 60);
            prevSelectedIdRef.current = selectedItem.id;
            return () => clearTimeout(handle);
        }
        prevSelectedIdRef.current = selectedItem.id;
    }, [selectedItem?.id]);

    const activeCountries = useMemo(() => {
        const countries = new Set(processedData.map(d => d.country ? d.country.toLowerCase() : 'ghana'));
        return Array.from(countries);
    }, [processedData]);

    const filteredGeoJson = useMemo(() => {
        return {
            ...COUNTRY_BORDERS,
            features: COUNTRY_BORDERS.features.filter((f) => {
                // datasets/geo-countries (Natural Earth 1:10m) uses "ADMIN"; older
                // johan dataset used "name" — support both so a source swap doesn't break filtering.
                const properties = f.properties ?? {};
                const name = String(properties.ADMIN ?? properties.name ?? '').toLowerCase();
                return activeCountries.some(ac => name.includes(ac) || (ac === 'ghana' && name === 'ghana'));
            })
        };
    }, [activeCountries]);

    return (
        <div className="w-full h-full relative bg-slate-100 dark:bg-slate-900">
            {processedData.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-100/60 dark:bg-slate-900/60 backdrop-blur-sm">
                    <div className="text-4xl mb-2">🔍</div>
                    <h3 className="text-lg font-bold">{t("לא נמצאו רישיונות", "No Licenses Found")}</h3>
                    <p className="text-sm text-slate-400">{t("נסה לשנות את המסננים", "Try adjusting your filters")}</p>
                </div>
            )}
            <MapContainer 
              center={mapCenter} 
              zoom={7} 
              className="w-full h-full"
              zoomControl={false}
              // @ts-ignore
              ref={mapRef}
            >
                <ZoomControl position="bottomleft" />
                <MapClickHandler onMapClick={() => setSelectedItem(null)} />
                <MapEffect selectedItem={selectedItem} mapFlyTrigger={mapFlyTrigger} flyTarget={flyTarget} />
                
                {/* key forces remount when theme changes so `checked` re-applies */}
                <LayersControl key={resolvedTheme ?? 'dark'} position="bottomright">
                    <LayersControl.BaseLayer checked={isDark} name={t("כהה", "Dark")}>
                        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                    </LayersControl.BaseLayer>
                    <LayersControl.BaseLayer checked={!isDark} name={t("בהיר", "Light")}>
                        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
                    </LayersControl.BaseLayer>
                    <LayersControl.BaseLayer name={t("לוויין", "Satellite")}>
                        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                    </LayersControl.BaseLayer>
                    <LayersControl.BaseLayer name={t("טופוגרפי", "Topographic")}>
                        <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" />
                    </LayersControl.BaseLayer>

                    {filteredGeoJson && (
                        <LayersControl.Overlay checked name={t("גבולות מדינות", "Country Borders")}>
                            <GeoJSON 
                                key={activeCountries.join(',')}
                                data={filteredGeoJson} 
                                style={{ 
                                  fillColor: '#06b6d4', 
                                  weight: 1, 
                                  color: '#06b6d4', 
                                  fillOpacity: 0.02,
                                  opacity: 0.5,
                                  lineCap: 'round'
                                }} 
                            />
                        </LayersControl.Overlay>
                    )}
                </LayersControl>

                {/* spiderLegPolylineOptions interactive:false prevents spider-leg polylines from
                    eating clicks meant for the spiderfied markers beneath them.
                    showCoverageOnHover:false removes the coverage polygon overlay that can
                    also intercept pointer events in dense areas. */}
                <MarkerClusterGroup
                    showCoverageOnHover={false}
                    spiderLegPolylineOptions={{ weight: 1.5, color: '#64748b', opacity: 0.5, interactive: false }}
                >
                    {displayData.map((item) => {
                        if (item._displayLat == null || item._displayLng == null) return null;
                        const annotation = userAnnotations[item.id] || {};
                        const color = getMarkerColor(annotation.commodity || item.commodity, annotation.status);

                        return (
                            <Marker
                                key={item.id}
                                position={[item._displayLat, item._displayLng]}
                                icon={createCustomIcon(color, false)}
                                ref={(el) => {
                                    if (!el) return;
                                    markerRefs.current[item.id] = el;
                                    // Re-apply the selected class after a re-mount (the
                                    // ref callback fires every time the marker DOM is
                                    // rebuilt, e.g. after spiderfy/unspiderfy).
                                    if (selectedItem?.id === item.id) {
                                        const root = el.getElement();
                                        if (root) root.classList.add(SELECTED_CLASS);
                                    }
                                }}
                                eventHandlers={{
                                    click: (e) => {
                                        // Stop propagation so the map-level click handler
                                        // (MapClickHandler → setSelectedItem(null)) does not
                                        // fire in the same event cycle and cancel the selection
                                        // that we are about to set.
                                        L.DomEvent.stopPropagation(e);
                                        // Open the popup *synchronously* while the marker
                                        // is still in its spiderfied position. Waiting for
                                        // a state-driven setTimeout (the previous
                                        // implementation) let leaflet.markercluster
                                        // un-spiderfy the stack first, which is why
                                        // collocated/duplicate-coord points appeared to
                                        // ignore clicks.
                                        e.target.openPopup();
                                        setSelectedItem(item);
                                    },
                                }}
                            >
                                <Tooltip direction="top" offset={[0, -20]} opacity={1}>
                                    <div className="bg-slate-950 border border-white/20 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md">
                                        <span className="text-[10px] font-black uppercase text-white tracking-widest">{item.company}</span>
                                        {item._wasJittered && (
                                          <span className="ml-1 text-[8px] font-bold text-amber-400">≈ approx ({item._collocatedCount})</span>
                                        )}
                                    </div>
                                </Tooltip>
                                <Popup className="custom-popup" minWidth={300}>
                                    <PopupForm 
                                      item={item}
                                      annotation={annotation}
                                      updateAnnotation={updateAnnotation}
                                      onDelete={() => deleteLicense(item.id)}
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
}
