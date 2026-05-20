import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../lib/i18n';
import type { MiningLicense } from '../../types';
import type { EsgConservationZone } from '../../lib/esgConservationZones';
import { getEsgZoneIntersection, formatBufferRadiusMeters } from '../../lib/esgConservationZones';
import { BASEMAP_TILES, type BasemapId } from '../../lib/mapBasemaps';
import { apiClient } from '../../lib/api';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { AlertTriangle, ExternalLink, Satellite } from 'lucide-react';

import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

// @ts-expect-error leaflet default icon paths
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: iconRetina,
  iconUrl: icon,
  shadowUrl: iconShadow,
});

interface SatelliteSiteResponse {
  lat?: number | null;
  lng?: number | null;
  company?: string;
  country?: string;
  has_coordinates?: boolean;
  esg_intersection?: {
    name?: string;
    restrictions?: string;
    country?: string;
    zoneType?: string;
    radius?: number;
  } | null;
  links?: { label: string; url: string }[];
  limitations?: string[];
  tile_attribution?: string;
}

function MapRecenter({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], zoom, { animate: false });
  }, [map, lat, lng, zoom]);
  return null;
}

interface SatelliteSitePanelProps {
  item: MiningLicense;
  esgZone?: EsgConservationZone | null;
  isEsgRisk?: boolean;
}

export default function SatelliteSitePanel({ item, esgZone: esgZoneProp, isEsgRisk }: SatelliteSitePanelProps) {
  const { t } = useI18n();
  const [basemap, setBasemap] = useState<BasemapId>('satellite');

  const localEsg = useMemo(
    () => esgZoneProp ?? getEsgZoneIntersection(item.lat, item.lng),
    [esgZoneProp, item.lat, item.lng],
  );

  const { data: siteMeta } = useQuery({
    queryKey: ['satellite-site', item.id],
    queryFn: async () => {
      const { data } = await apiClient.get<SatelliteSiteResponse>(
        `/entities/${encodeURIComponent(item.id)}/satellite-site`,
        { params: { entity_kind: item.entityKind || 'license' } },
      );
      return data;
    },
    enabled: Boolean(item.id),
    staleTime: 60 * 60_000,
  });

  const lat = item.lat;
  const lng = item.lng;
  const hasCoords = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
  const tile = BASEMAP_TILES[basemap];
  const links = siteMeta?.links || [];

  if (!hasCoords) {
    return (
      <Card className="p-10 text-center space-y-4 max-w-lg mx-auto border-dashed border-amber-500/30">
        <Satellite className="h-10 w-10 mx-auto text-slate-400" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t(
            'אין קואורדינטות לרישיון — הוסף lat/lng כדי להציג תצוגת לוויין.',
            'No coordinates on this license — add lat/lng to enable satellite site view.',
          )}
        </p>
        <p className="text-[11px] text-slate-500">
          {item.country} · {item.company}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="rounded-2xl border border-slate-400/30 bg-slate-500/10 px-4 py-3 text-[11px] text-slate-700 dark:text-slate-200">
        {t(
          'תצוגת סינון ויזואלי בלבד — לא תחליף לסיור שטח או ניתוח תמונות מורשה.',
          'Visual screening only — not a substitute for on-site survey or licensed imagery analysis.',
        )}
      </div>

      {(isEsgRisk || localEsg) && localEsg && (
        <Card className="bg-red-500/10 border-red-500/20 rounded-3xl p-5 flex gap-4">
          <AlertTriangle className="h-8 w-8 text-red-500 shrink-0" />
          <div>
            <Badge className="bg-red-500 text-white text-[9px] mb-2">
              {t('הצטלבות שמורת טבע', 'CONSERVATION INTERSECTION')}
            </Badge>
            <h4 className="font-black text-slate-900 dark:text-white uppercase">{localEsg.name}</h4>
            <p className="text-xs text-slate-500 mt-1">{localEsg.restrictions}</p>
            <p className="text-[10px] text-slate-400 mt-1">
              {t('רדיוס', 'Buffer')}: {formatBufferRadiusMeters(localEsg.radius)} · {localEsg.country}
            </p>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {(['satellite', 'topographic'] as BasemapId[]).map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={basemap === id ? 'default' : 'outline'}
            className="text-[9px] font-black uppercase"
            onClick={() => setBasemap(id)}
          >
            {id === 'satellite' ? t('לוויין', 'Satellite') : t('טופוגרפי', 'Topographic')}
          </Button>
        ))}
      </div>

      <div className="rounded-3xl overflow-hidden border border-black/10 dark:border-white/10 h-[min(420px,55vh)] w-full">
        <MapContainer
          center={[lat, lng]}
          zoom={16}
          className="w-full h-full min-h-[320px]"
          zoomControl
          scrollWheelZoom
        >
          <MapRecenter lat={lat} lng={lng} zoom={16} />
          <TileLayer
            url={tile.url}
            attribution={tile.attribution}
            maxZoom={tile.maxZoom}
          />
          <Marker position={[lat, lng]} title={item.company} />
          {localEsg && (
            <Circle
              center={localEsg.center}
              radius={localEsg.radius}
              pathOptions={{
                color: localEsg.color,
                fillColor: localEsg.fillColor,
                fillOpacity: 0.12,
                weight: 2,
              }}
            />
          )}
        </MapContainer>
      </div>

      <p className="text-[9px] text-slate-500 text-center">
        {siteMeta?.tile_attribution || tile.attribution} · {lat.toFixed(5)}, {lng.toFixed(5)}
      </p>

      <Card className="p-4 space-y-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          {t('כלים חיצוניים', 'External tools')}
        </p>
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 px-3 py-2 text-[9px] font-black uppercase hover:bg-black/5 dark:hover:bg-white/5"
            >
              {link.label}
              <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      </Card>

      {(siteMeta?.limitations || []).map((lim) => (
        <p key={lim} className="text-[10px] text-slate-500">
          {lim}
        </p>
      ))}
    </div>
  );
}
