import { useQuery } from '@tanstack/react-query';
import { LayerGroup, Popup, Rectangle } from 'react-leaflet';
import type L from 'leaflet';
import { getOilLiveCoverage, type OilLiveCoverageCell, type OilLiveWatchZone } from '../../api/oilLiveApi';
import OilLiveProvenanceBadge from './OilLiveProvenanceBadge';

const WORLD_BBOX = '-180,-85,180,85';

function coveragePathOptions(quality?: string): L.PathOptions {
  const q = (quality ?? '').toLowerCase();
  if (q.includes('sparse') || q.includes('gap')) {
    return { color: '#f59e0b', weight: 1.2, fillColor: '#f59e0b', fillOpacity: 0.12, dashArray: '4 4' };
  }
  if (q.includes('moderate')) {
    return { color: '#eab308', weight: 1, fillColor: '#eab308', fillOpacity: 0.08 };
  }
  return { color: '#64748b', weight: 0.8, fillColor: '#64748b', fillOpacity: 0.06 };
}

type Props = {
  enabled: boolean;
};

/** Read-only AIS coverage gaps for Global › Risk lens (no Live Data sidebar required). */
export function RiskLensCoverageOverlay({ enabled }: Props) {
  const { data: coverageData } = useQuery({
    queryKey: ['oil-live-coverage', 'risk-lens', WORLD_BBOX] as const,
    queryFn: () =>
      getOilLiveCoverage({
        bbox: WORLD_BBOX,
        freshness_minutes: 180,
      }),
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 120_000 : false,
  });

  if (!enabled) return null;

  return (
    <LayerGroup>
      {(coverageData?.coverage_cells ?? []).map((cell: OilLiveCoverageCell) => (
        <Rectangle
          key={`risk-coverage-${cell.cell_id}`}
          bounds={[
            [cell.min_lat, cell.min_lng],
            [cell.max_lat, cell.max_lng],
          ]}
          pathOptions={coveragePathOptions(cell.coverage_quality)}
          interactive
        >
          <Popup>
            <div className="oil-live-popup-body">
              <OilLiveProvenanceBadge kind="inferred" className="mb-1" />
              <strong>AIS coverage: {cell.coverage_quality.replace(/_/g, ' ')}</strong>
              <p>{cell.vessel_count} vessels observed in this open-data cell</p>
              <p className="oil-live-popup-muted">
                Sparse or empty cells mean a coverage gap, not confirmed vessel absence.
              </p>
            </div>
          </Popup>
        </Rectangle>
      ))}
      {(coverageData?.watch_zones ?? []).map((zone: OilLiveWatchZone) => (
        <Rectangle
          key={`risk-watch-${zone.id}`}
          bounds={[
            [zone.min_lat, zone.min_lng],
            [zone.max_lat, zone.max_lng],
          ]}
          pathOptions={coveragePathOptions(zone.coverage_quality)}
          interactive
        >
          <Popup>
            <div className="oil-live-popup-body">
              <OilLiveProvenanceBadge kind="inferred" className="mb-1" />
              <strong>{zone.name}</strong>
              <p>
                {zone.recent_vessel_count ?? 0} recent open AIS vessels ·{' '}
                {zone.coverage_quality.replace(/_/g, ' ')}
              </p>
              {zone.expected_gap_reason && (
                <p className="oil-live-popup-muted">{zone.expected_gap_reason}</p>
              )}
            </div>
          </Popup>
        </Rectangle>
      ))}
    </LayerGroup>
  );
}

export default RiskLensCoverageOverlay;
