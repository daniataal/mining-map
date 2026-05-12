import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { MapContainer, TileLayer, useMap, LayersControl, useMapEvents, Marker, Popup, GeoJSON, ZoomControl, Tooltip, CircleMarker } from 'react-leaflet';
// @ts-ignore
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MiningLicense, UserAnnotation, MaritimeVessel } from '../types';
import { getCountryBorders, useMaritimeVessels } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { applyCollocationJitter } from '../lib/geo';
import { getLicenseRenderKey } from '../lib/licenseRenderKey';
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
const PORTS_MAP_RENDER_LIMIT = 3000;

const getMarkerColor = (
  commodity?: string,
  userStatus?: string,
  sector?: string,
  entitySubtype?: string | null
) => {
    if (userStatus === 'good' || userStatus === 'Approved') return '#22c55e';
    if (userStatus === 'bad' || userStatus === 'Rejected') return '#ef4444';
    if (userStatus === 'maybe' || userStatus === 'Needs Review' || userStatus === 'Investigating') return '#f59e0b';
    if (userStatus === 'Escalated') return '#ef4444';

    if (entitySubtype === 'tank_farm') return '#f97316';
    if (entitySubtype === 'storage_terminal') return '#06b6d4';

    if (sector) {
      const s = sector.toLowerCase();
      if (s === 'oil_and_gas' || s === 'oil') return '#000000';
      if (s === 'suppliers' || s === 'logistics') return '#6366f1';
      if (s === 'ports') return '#0ea5e9';
    }

    if (!commodity) return '#64748b';
    const c = commodity.toLowerCase();
    if (c.includes('gold')) return '#FFD700';
    if (c.includes('diamond')) return '#60a5fa';
    if (c.includes('bauxite')) return '#f87171';
    if (c.includes('manganese')) return '#a78bfa';
    if (c.includes('lithium')) return '#34d399';
    if (c.includes('oil') || c.includes('petroleum')) return '#000000';
    if (c.includes('gas')) return '#94a3b8';
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
  viewModeKey: string;
  selectedMaritimeVessel: MaritimeVessel | null;
  onSelectMaritimeVessel: (vessel: MaritimeVessel | null) => void;
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

const DataBoundsEffect = ({
    data,
    selectedItem,
    viewModeKey,
}: {
    data: Array<MiningLicense & { _displayLat?: number | null; _displayLng?: number | null }>;
    selectedItem: MiningLicense | null;
    viewModeKey: string;
}) => {
    const map = useMap();
    const lastSignatureRef = useRef<string>('');

    useEffect(() => {
        if (selectedItem) return;
        const coords = data
            .filter((item) => item._displayLat != null && item._displayLng != null)
            .map((item) => [item._displayLat as number, item._displayLng as number] as [number, number]);
        if (coords.length === 0) return;

        const first = coords[0];
        const last = coords[coords.length - 1];
        const signature = `${viewModeKey}:${coords.length}:${first[0].toFixed(3)}:${first[1].toFixed(3)}:${last[0].toFixed(3)}:${last[1].toFixed(3)}`;
        if (lastSignatureRef.current === signature) return;
        lastSignatureRef.current = signature;

        if (coords.length === 1) {
            map.setView(coords[0], Math.max(map.getZoom(), 6), { animate: true });
            return;
        }

        map.fitBounds(L.latLngBounds(coords).pad(0.18), {
            animate: true,
            maxZoom: 6,
        });
    }, [data, map, selectedItem, viewModeKey]);

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
  mapFlyTrigger,
  viewModeKey,
  selectedMaritimeVessel,
  onSelectMaritimeVessel,
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
    const mapDisplayData = useMemo(() => {
        if (viewModeKey !== 'ports' || displayData.length <= PORTS_MAP_RENDER_LIMIT) {
            return displayData;
        }
        const capped = displayData.slice(0, PORTS_MAP_RENDER_LIMIT);
        if (!selectedItem) return capped;
        const selected = displayData.find((item) => item.id === selectedItem.id);
        if (!selected || capped.some((item) => item.id === selected.id)) {
            return capped;
        }
        return [selected, ...capped.slice(0, PORTS_MAP_RENDER_LIMIT - 1)];
    }, [displayData, selectedItem, viewModeKey]);
    const maritimeEnabled = viewModeKey === 'oil_and_gas';
    const { data: maritimeFeed, isLoading: isMaritimeLoading } = useMaritimeVessels(maritimeEnabled, 18);
    const maritimeVessels = maritimeFeed?.vessels ?? [];

    const flyTarget = useMemo(() => {
        if (!selectedItem) return null;
        const j = mapDisplayData.find(d => d.id === selectedItem.id) || displayData.find(d => d.id === selectedItem.id);
        if (!j || j._displayLat == null || j._displayLng == null) return null;
        return { lat: j._displayLat, lng: j._displayLng };
    }, [selectedItem, displayData, mapDisplayData]);

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

    const borderCountries = useMemo(() => {
        const countries = new Set(processedData.map(d => d.country ? d.country.toLowerCase() : 'ghana'));
        return Array.from(countries).sort((a, b) => a.localeCompare(b));
    }, [processedData]);

    const { data: filteredGeoJson } = useQuery({
        queryKey: ['country-borders', borderCountries],
        queryFn: () => getCountryBorders(borderCountries),
        enabled: borderCountries.length > 0,
        staleTime: 1000 * 60 * 60 * 24,
        gcTime: 1000 * 60 * 60 * 24 * 7,
        placeholderData: (previousData) => previousData,
    });

    return (
        <div className="w-full h-full relative bg-slate-100 dark:bg-slate-900">
            {processedData.length === 0 && maritimeVessels.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-100/60 dark:bg-slate-900/60 backdrop-blur-sm">
                    <div className="text-4xl mb-2">🔍</div>
                    <h3 className="text-lg font-bold">{t("לא נמצאו נכסים", "No assets found")}</h3>
                    <p className="text-sm text-slate-400">{t("נסה לשנות את המסננים או להפעיל מחדש את שכבת האחסון", "Try adjusting filters or reloading the storage layer")}</p>
                </div>
            )}
            {maritimeEnabled && (
                <div className="absolute left-4 bottom-4 z-[950] max-w-[320px] rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl px-4 py-3 shadow-2xl">
                    <p className="text-[9px] font-black uppercase tracking-widest text-cyan-500">
                        {t('מעקב ימי', 'Maritime Watch')}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">
                        {isMaritimeLoading
                            ? t('טוען שכבת כלי שיט...', 'Loading vessel layer...')
                            : maritimeFeed?.live_positions_enabled
                                ? t(`AISStream · ${maritimeVessels.length} כלי שיט`, `AISStream · ${maritimeVessels.length} vessels`)
                                : t(
                                    'AIS חי לא מוגדר. מודיעין ימי בתיק קיים, שכבת כלי שיט תופעל כשמוגדר AISSTREAM_API_KEY.',
                                    'Live AIS is not configured. Maritime dossier context still works; vessel markers appear once AISSTREAM_API_KEY is set.'
                                  )}
                    </p>
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
                <MapClickHandler onMapClick={() => {
                    setSelectedItem(null);
                    onSelectMaritimeVessel(null);
                }} />
                <MapEffect selectedItem={selectedItem} mapFlyTrigger={mapFlyTrigger} flyTarget={flyTarget} />
                <DataBoundsEffect data={mapDisplayData} selectedItem={selectedItem} viewModeKey={viewModeKey} />
                {viewModeKey === 'ports' && processedData.length > mapDisplayData.length && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-slate-950/85 text-slate-100 border border-cyan-500/20 rounded-2xl px-4 py-2 shadow-2xl backdrop-blur-xl">
                        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300 text-center">
                            {t('מפה מוגבלת לביצועים', 'Map limited for performance')}
                        </p>
                        <p className="text-[10px] text-slate-400 text-center">
                            {t(
                                'מוצגים רק 3000 הצמתים הראשונים אחרי סינון. השתמש בחיפוש/מדינה כדי לצמצם.',
                                'Showing only the first 3000 filtered nodes. Use search or country filters to narrow.'
                            )}
                        </p>
                    </div>
                )}
                
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
                                key={borderCountries.join(',')}
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
                    {mapDisplayData.map((item, index) => {
                        if (item._displayLat == null || item._displayLng == null) return null;
                        const annotation = userAnnotations[item.id] || {};
                        const color = getMarkerColor(annotation.commodity || item.commodity, annotation.status, item.sector, item.entitySubtype);

                        return (
                            <Marker
                                key={getLicenseRenderKey(item, index)}
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
                                        onSelectMaritimeVessel(null);
                                        setSelectedItem(item);
                                    },
                                }}
                            >
                                <Tooltip direction="top" offset={[0, -20]} opacity={1}>
                                    <div className="bg-slate-950 border border-white/20 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md">
                                        <span className="text-[10px] font-black uppercase text-white tracking-widest">{item.company}</span>
                                        {item.entitySubtype && (
                                          <p className="text-[8px] text-cyan-300 uppercase tracking-widest">
                                            {item.entitySubtype.replaceAll('_', ' ')}
                                          </p>
                                        )}
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
                {maritimeEnabled && maritimeVessels.map((vessel) => (
                    <CircleMarker
                        key={vessel.id}
                        center={[vessel.lat, vessel.lng]}
                        radius={selectedMaritimeVessel?.id === vessel.id ? 8 : 5}
                        pathOptions={{
                            color: '#22d3ee',
                            weight: selectedMaritimeVessel?.id === vessel.id ? 2 : 1,
                            fillColor: '#22d3ee',
                            fillOpacity: selectedMaritimeVessel?.id === vessel.id ? 0.9 : 0.7,
                        }}
                        eventHandlers={{
                            click: (e) => {
                                L.DomEvent.stopPropagation(e);
                                setSelectedItem(null);
                                onSelectMaritimeVessel(vessel);
                            },
                        }}
                    >
                        <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                            <div className="bg-slate-950 border border-cyan-500/20 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md">
                                <span className="text-[10px] font-black uppercase text-cyan-300 tracking-widest">
                                    {vessel.vessel_name}
                                </span>
                                <p className="text-[9px] text-slate-400">
                                    {[vessel.ship_type_label, vessel.nearest_port?.name].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                        </Tooltip>
                    </CircleMarker>
                ))}
            </MapContainer>
        </div>
    );
}
