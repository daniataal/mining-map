import { useCallback } from 'react';
import LiveDataSearchBar, { type LiveDataSearchHitClick } from './LiveDataSearchBar';
import type { OilLiveSearchResponse } from '../../api/oilLiveApi';
import type { OilLiveEntityClickPayload } from '../../components/petroleum/OilLiveMapOverlays';

export type LiveDataMapCompanySearchProps = {
  onEntityClick?: (payload: OilLiveEntityClickPayload) => void;
  onMapFlyTo?: (lat: number, lng: number) => void;
  /** Optional fetcher override (tests). */
  searchFn?: (q: string) => Promise<OilLiveSearchResponse>;
  className?: string;
};

/**
 * Map-overlay company search (MAD-44 phase 1). Restricts unified search to
 * `company` type and opens the Live Data entity drawer on selection.
 */
export default function LiveDataMapCompanySearch({
  onEntityClick,
  onMapFlyTo,
  searchFn,
  className = '',
}: LiveDataMapCompanySearchProps) {
  const handleHit = useCallback(
    (hit: LiveDataSearchHitClick) => {
      if (hit.lat != null && hit.lng != null && onMapFlyTo) {
        onMapFlyTo(hit.lat, hit.lng);
      }
      onEntityClick?.({
        entityKind: 'company',
        entityId: hit.id,
        title: hit.title,
        subtitle: hit.subtitle,
      });
    },
    [onEntityClick, onMapFlyTo],
  );

  return (
    <div
      className={`w-[min(100vw-2rem,22rem)] rounded-xl border border-black/10 dark:border-white/10 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md shadow-xl p-2 ${className}`}
      data-testid="live-data-map-company-search"
    >
      <LiveDataSearchBar
        onHitClick={handleHit}
        searchFn={searchFn}
        types={['company']}
        limit={8}
        className="mb-0"
      />
    </div>
  );
}
