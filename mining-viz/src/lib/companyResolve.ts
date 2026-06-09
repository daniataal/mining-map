import { useQuery } from '@tanstack/react-query';
import { apiClient } from './api';
import type { MiningLicense } from '../types';

export interface CompanyResolveResult {
  found: boolean;
  company_id?: string | null;
  name?: string;
  country?: string;
  lei?: string | null;
  match_confidence?: string;
  source?: string;
  registry_source?: string;
  source_label?: string;
}

export function companyLeadSourceLabel(source?: string): string {
  switch (source) {
    case 'port_authority_curated':
      return 'Port authority';
    case 'bunker_fuel_suppliers_curated':
      return 'Bunker register';
    case 'gem_gogpt_plants_january_2026':
    case 'gem_gogpt':
      return 'GEM GOGPT';
    case 'gem_goit_oil_ngl_pipelines_march_2025':
    case 'gem_goit':
      return 'GEM GOIT';
    case 'gem_ggit_lng_terminals_september_2025':
    case 'gem_ggit':
      return 'GEM GGIT';
    case 'osm_petroleum':
    case 'osm':
      return 'OSM tag';
    default:
      return source ? source.replace(/_/g, ' ') : 'Open data';
  }
}

export function useCompanyResolve(name: string, country: string, enabled: boolean) {
  return useQuery<CompanyResolveResult>({
    queryKey: ['company-resolve', name, country],
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<CompanyResolveResult>('/api/companies/resolve', {
        signal,
        params: { name, country },
      });
      return data;
    },
    enabled: enabled && name.trim().length >= 2,
    staleTime: 300_000,
  });
}

export function miningLicenseFromCompanyLead(
  name: string,
  country: string,
  source?: string,
): MiningLicense {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lead';
  return {
    id: `company-lead:${slug}`,
    company: name,
    country: country || '',
    sector: 'oil_and_gas',
    status: 'reference',
    source_id: source || 'company_resolve',
    record_origin: 'commercial_lead',
  } as MiningLicense;
}
