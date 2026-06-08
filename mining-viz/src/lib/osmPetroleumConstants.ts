import type { PathOptions } from 'leaflet';
import type { OsmPetroleumLayerId } from './osmPetroleumLayers';

export const OSM_MAP_LAYER_IDS: OsmPetroleumLayerId[] = [
  'pipelines',
  'refineries',
  'storage_terminals',
];

export const OSM_LABELS: Record<OsmPetroleumLayerId, [string, string]> = {
  pipelines: ['צינורות נפט/גז OSM', 'Oil/gas pipelines — OpenStreetMap'],
  refineries: ['זיקוק OSM (קהילה)', 'Refineries — OpenStreetMap (community)'],
  storage_terminals: ['מאגרי אחסון OSM', 'Tank storage — OpenStreetMap'],
};

export const OSM_STYLE: Record<OsmPetroleumLayerId, PathOptions> = {
  pipelines: {
    color: '#fbbf24',
    weight: 3,
    opacity: 0.9,
    dashArray: '5 4',
    lineCap: 'round',
  },
  refineries: { color: '#fed7aa', weight: 1.8, fillColor: '#f97316', fillOpacity: 0.94 },
  storage_terminals: { color: '#0e7490', weight: 0.8, fillColor: '#22d3ee', fillOpacity: 0.42 },
};

export const OSM_WATER_PIPELINE_STYLE: PathOptions = {
  color: '#0891b2',
  weight: 2.5,
  opacity: 0.8,
  dashArray: '2 6',
  lineCap: 'round',
};

export const OIL_GAS_PIPELINE_LABELS = {
  oil_pipelines: ['צינורות נפט', 'Oil pipelines'] as [string, string],
  gas_pipelines: ['צינורות גז', 'Gas pipelines'] as [string, string],
};
