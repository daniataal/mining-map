import { Marker, Tooltip, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { useDealPack } from '../../hooks/use-deal-pack';

const customPinIcon = L.divIcon({
  className: 'custom-deal-pin',
  html: `<div style="width: 16px; height: 16px; background-color: #f59e0b; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(245, 158, 11, 0.8);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export default function DealPackOverlay() {
  const { assets, routes } = useDealPack();

  const customPins = assets.filter(a => a.type === 'custom_pin');

  // Render Routes (connecting assets)
  const renderRoutes = () => {
    return routes.map(route => {
      const source = assets.find(a => a.id === route.sourceId);
      const target = assets.find(a => a.id === route.targetId);
      
      if (!source || !target) return null;
      
      return (
        <Polyline 
          key={route.id}
          positions={[
            [source.lat, source.lng],
            [target.lat, target.lng]
          ]}
          pathOptions={{
            color: '#f59e0b',
            weight: 3,
            dashArray: '5, 10',
            opacity: 0.8
          }}
        >
          <Tooltip>Deal Route</Tooltip>
        </Polyline>
      );
    });
  };

  return (
    <>
      {customPins.map(pin => (
        <Marker
          key={pin.id}
          position={[pin.lat, pin.lng]}
          icon={customPinIcon}
          zIndexOffset={2000}
        >
          <Tooltip direction="top" offset={[0, -10]} opacity={1}>
            <span className="font-bold text-amber-600">{pin.name}</span>
          </Tooltip>
        </Marker>
      ))}
      
      {renderRoutes()}
    </>
  );
}
