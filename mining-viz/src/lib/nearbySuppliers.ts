import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import type { PetroleumViewportBounds } from '../lib/petroleumViewportBounds';

export type NearbySupplier = {
  id: string;
  name: string;
  country?: string;
  company_type?: string;
  website?: string | null;
  confidence?: number;
  port_locode?: string;
  port_name?: string;
  product_types?: string[];
  fuels_supplied?: string;
  contact_person?: string;
  address?: string;
  license_authority?: string;
  source_url?: string;
  enrichment_tier?: string;
  lat?: number;
  lng?: number;
  geocode_tier?: string;
  geocode_disclaimer?: string;
};

export function useNearbySuppliers(
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  locode?: string | null,
  limit = 30,
) {
  return useQuery<{ suppliers: NearbySupplier[]; limitations?: string[] }>({
    queryKey: ['suppliers-nearby', bbox, locode, limit],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<{ suppliers: NearbySupplier[]; limitations?: string[] }>(
        '/api/suppliers/nearby',
        {
          signal,
          params: locode
            ? { locode, limit }
            : bbox
              ? {
                  south: bbox.south,
                  west: bbox.west,
                  north: bbox.north,
                  east: bbox.east,
                  limit,
                }
              : { limit },
        },
      );
      return data;
    },
    enabled: enabled && Boolean(locode || bbox),
    staleTime: locode ? 3_600_000 : 120_000,
    refetchOnWindowFocus: false,
  });
}
