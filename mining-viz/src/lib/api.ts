import axios, { isCancel } from 'axios';
import { useMemo, useRef, useEffect } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryFunctionContext,
} from '@tanstack/react-query';
import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';
import {
  MiningLicense,
  User,
  ActivityLog,
  OilSummaryResponse,
  OilTradeFlow,
  AfricaCoverageResponse,
  WorldCoverageResponse,
  WorldCoverageCountry,
  EntityContact,
  EntityRelationship,
  DdReport,
  MaritimeVesselFeedResponse,
  MaritimeViewportBounds,
  MaritimeVesselScope,
  MaritimeContextResponse,
  StorageTerminalDetails,
  StorageTerminalResponse,
  PortLogisticsDetails,
  PortLogisticsResponse,
} from '../types';
import bundledLicenses from '../data/licenses.json';

/** Same base URL for fetch() and axios. 
 *  Empty string means 'same origin', which works because we use Vite proxy in dev 
 *  and Caddy reverse proxy in production. 
 */
export const API_BASE = import.meta.env.VITE_API_BASE || '';

/** Context-aware troubleshooting when GET /licenses fails (network / mixed content / wrong base URL). */
export function describeLicenseFetchFailureContext(): { en: string; he: string } {
  const base =
    typeof window !== 'undefined'
      ? API_BASE || '(same origin — empty base)'
      : '(server render)';
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return {
      en: `Ensure the API process is running and reachable. This page is HTTPS — browsers block non-secure API calls to http:// URLs (mixed content). Current resolved API base: ${base}. Set VITE_API_BASE to your public https:// API URL, put the API behind TLS, or proxy /licenses through the same origin.`,
      he: `ודא שה־API רץ ונגיש. הדף ב־HTTPS — הדפדפן חוסם קריאות ל־http:// (mixed content). בסיס ה־API הנוכחי: ${base}. הגדר VITE_API_BASE לכתובת https תקינה, או TLS ל־API, או פרוקסי ל־/licenses מאותו מקור.`,
    };
  }
  return {
    en: `Ensure the API is running and reachable at ${base} (see Network tab / CORS). If your backend uses another host or port, set VITE_API_BASE before building the web app.`,
    he: `ודא שה־API רץ וזמין ב־${base} (שורת Network / CORS). אם ה־API במארח או פורט אחרים, הגדר VITE_API_BASE לפני בניית האפליקציה.`,
  };
}

const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

const LICENSES_FALLBACK_DATA = (bundledLicenses as MiningLicense[]).map((item) => ({
  ...item,
  sector: item.sector || 'mining',
  recordOrigin: item.recordOrigin || 'bundled_json',
  sourceId: item.sourceId || 'bundled_json',
  sourceName: item.sourceName || 'Bundled JSON fallback',
}));
export type CountryBordersGeoJson = FeatureCollection<Geometry, GeoJsonProperties>;

function canUseBundledLicenseFallback(): boolean {
  const envFallbackFlag =
    typeof process !== 'undefined'
      ? (process as { env?: Record<string, string | undefined> }).env?.VITE_ALLOW_BUNDLED_LICENSE_FALLBACK
      : '';
  const fallbackFlag = String(envFallbackFlag || '').toLowerCase();
  if (fallbackFlag === '1' || fallbackFlag === 'true' || fallbackFlag === 'yes') return true;
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

function isLicensesRequestAborted(error: unknown): boolean {
  if (isCancel(error)) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_CANCELED'
  );
}

function normalizeCountryBordersParam(countries: string[]): string[] {
  return Array.from(
    new Set(
      countries
        .map((country) => country.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

// Request interceptor for auth
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('mining_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Licenses — bulk CSV import ---
export type LicenseImportApiError = { row: number; message: string };

export type BulkImportFileResult =
  | { ok: true; importedCount: number }
  | { ok: false; errors: LicenseImportApiError[] };

/** Multipart upload to POST /licenses/import (field name `file`). */
export async function bulkImportLicensesFile(file: File): Promise<BulkImportFileResult> {
  const form = new FormData();
  form.append('file', file);
  const token = localStorage.getItem('mining_token');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/licenses/import`, {
    method: 'POST',
    headers,
    body: form,
  });

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }

  if (res.ok && data.status === 'success') {
    return { ok: true, importedCount: Number(data.imported_count) || 0 };
  }

  const detail = data.detail as Record<string, unknown> | undefined;
  const fromDetail = detail?.errors as LicenseImportApiError[] | undefined;
  if (Array.isArray(fromDetail) && fromDetail.length > 0) {
    return { ok: false, errors: fromDetail };
  }

  const msg =
    (typeof detail?.message === 'string' && detail.message) ||
    (typeof data.message === 'string' && data.message) ||
    `Import failed (${res.status})`;
  return { ok: false, errors: [{ row: 0, message: msg }] };
}

// --- Licenses ---
/** Viewport for GET /licenses bbox params (south/west/north/east). */
export type LicenseViewportBounds = MaritimeViewportBounds;

const LICENSE_GET_TIMEOUT_MS = 90_000;
// No longer batching — single request covers all countries for a clean one-shot map load.

/** Fallback country list used when world-coverage metadata is unavailable. */
const FALLBACK_LICENSE_FETCH_COUNTRIES: string[] = [
  'Ghana',
  'South Africa',
  'Kenya',
  'United Arab Emirates',
  'Saudi Arabia',
  'Zambia',
  'Nigeria',
  'Tanzania',
  'Australia',
  'Canada',
  'Peru',
  'Chile',
  'Brazil',
  'Iraq',
  'Oman',
];

/** Max distinct countries returned by deriveLicenseFetchCountries (all passed in one request). */
const MAX_LICENSE_FETCH_COUNTRIES = 50;


function countrySectorHasRows(c: WorldCoverageCountry, s: 'mining' | 'oil_and_gas'): boolean {
  const sec = c.sectors?.[s];
  if (!sec) return false;
  return (
    (sec.record_count ?? 0) > 0 ||
    (sec.fallback_record_count ?? 0) > 0 ||
    (sec.global_fallback_record_count ?? 0) > 0
  );
}

function countryRowWeight(row: WorldCoverageCountry, sector: 'mining' | 'oil_and_gas' | undefined): number {
  const pick = (s: 'mining' | 'oil_and_gas') => {
    const sec = row.sectors?.[s];
    if (!sec) return 0;
    return (
      (sec.record_count ?? 0) +
      (sec.fallback_record_count ?? 0) +
      (sec.global_fallback_record_count ?? 0)
    );
  };
  if (!sector) return pick('mining') + pick('oil_and_gas');
  return pick(sector);
}

/**
 * Country names for GET /licenses — from world coverage when available, ordered by
 * approximate row counts (heaviest first), capped to keep the map fast.
 */
export function deriveLicenseFetchCountries(
  sector: 'mining' | 'oil_and_gas' | undefined,
  worldCoverage: WorldCoverageResponse | undefined,
): string[] {
  const rows = worldCoverage?.countries;
  if (rows?.length) {
    const scored: { name: string; w: number }[] = [];
    for (const row of rows) {
      const name = row.country?.trim();
      if (!name) continue;
      if (!sector) {
        if (countrySectorHasRows(row, 'mining') || countrySectorHasRows(row, 'oil_and_gas')) {
          scored.push({ name, w: countryRowWeight(row, undefined) });
        }
      } else if (countrySectorHasRows(row, sector)) {
        scored.push({ name, w: countryRowWeight(row, sector) });
      }
    }
    const byName = new Map<string, number>();
    for (const { name, w } of scored) {
      byName.set(name, Math.max(byName.get(name) ?? 0, w));
    }
    const unique = Array.from(byName.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name)
      .slice(0, MAX_LICENSE_FETCH_COUNTRIES);
    if (unique.length) return unique;
  }
  return [...FALLBACK_LICENSE_FETCH_COUNTRIES];
}

export type UseLicensesResult = {
  data: MiningLicense[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  /** Sub-queries not yet fetched (batched country groups, not individual ISO rows). */
  stillLoadingCountryCount: number;
  failedCountryQueryCount: number;
};

export const useLicenses = (
  sector?: 'mining' | 'oil_and_gas',
  viewportBounds?: LicenseViewportBounds | null,
  countries?: string[],
): UseLicensesResult => {
  const bboxKey =
    viewportBounds &&
    Number.isFinite(viewportBounds.south) &&
    Number.isFinite(viewportBounds.west) &&
    Number.isFinite(viewportBounds.north) &&
    Number.isFinite(viewportBounds.east)
      ? `${viewportBounds.south.toFixed(4)},${viewportBounds.west.toFixed(4)},${viewportBounds.north.toFixed(4)},${viewportBounds.east.toFixed(4)}`
      : 'full';

  // All countries in one sorted, deduplicated string for the query key and param
  const countriesParam = useMemo(() => {
    const list = Array.from(
      new Set(
        (countries?.length ? countries : [])
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));
    return list.join(',');
  }, [countries]);

  const query = useQuery({
    queryKey: ['licenses', sector ?? 'all', bboxKey, countriesParam] as const,
    staleTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (previousData: MiningLicense[] | undefined) => previousData,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      try {
        const useBbox = Boolean(viewportBounds);
        const { data } = await apiClient.get<unknown>('/licenses', {
          signal,
          timeout: LICENSE_GET_TIMEOUT_MS,
          params: {
            prefer_open_data: true,
            limit: 10000,
            ...(countriesParam ? { countries: countriesParam } : {}),
            ...(sector ? { sector } : {}),
            ...(useBbox && viewportBounds
              ? {
                  min_lat: viewportBounds.south,
                  max_lat: viewportBounds.north,
                  min_lng: viewportBounds.west,
                  max_lng: viewportBounds.east,
                }
              : {}),
          },
        });
        if (Array.isArray(data)) return data as MiningLicense[];
        if (data && typeof data === 'object' && 'error' in data) {
          const msg = String((data as { error?: unknown }).error ?? 'Licenses request failed');
          throw new Error(msg);
        }
        console.warn('[useLicenses] Expected array from /licenses, got:', data);
        return [];
      } catch (error) {
        if (isLicensesRequestAborted(error)) {
          throw error;
        }
        if (sector !== 'oil_and_gas' && canUseBundledLicenseFallback()) {
          console.warn(
            '[useLicenses] /licenses failed; using bundled mining fallback because local fallback is enabled.',
            error
          );
          return LICENSES_FALLBACK_DATA.filter((item) =>
            sector ? item.sector === sector : true
          );
        }
        throw error;
      }
    },
  });

  /** Bbox changes should not wipe the map: keep last good rows until new data arrives. */
  const cacheEpoch = `${sector ?? 'all'}::${countriesParam}`;
  const cacheEpochRef = useRef(cacheEpoch);
  const lastStableLicenses = useRef<MiningLicense[]>([]);

  useEffect(() => {
    if (cacheEpochRef.current !== cacheEpoch) {
      cacheEpochRef.current = cacheEpoch;
      lastStableLicenses.current = [];
    }
  }, [cacheEpoch]);

  useEffect(() => {
    if ((query.data?.length ?? 0) > 0) {
      lastStableLicenses.current = query.data!;
    }
  }, [query.data]);

  const displayData =
    (query.data?.length ?? 0) > 0 ? query.data! : lastStableLicenses.current;

  const isLoading = !query.isFetched && displayData.length === 0;
  const isFetching = query.isFetching;
  const error: Error | null =
    displayData.length > 0
      ? null
      : query.error instanceof Error
        ? query.error
        : query.error
          ? new Error(String(query.error))
          : null;

  return {
    data: displayData,
    isLoading,
    isFetching,
    error,
    stillLoadingCountryCount: isLoading ? 1 : 0,
    failedCountryQueryCount: query.isError ? 1 : 0,
  };
};


export async function getEntityContacts(entityId: string, entityKind = 'license'): Promise<EntityContact[]> {
  const { data } = await apiClient.get<EntityContact[]>(
    `/entities/${encodeURIComponent(entityId)}/contacts`,
    {
      params: { entity_kind: entityKind },
    },
  );
  return Array.isArray(data) ? data : [];
}

export async function getEntityRelationships(entityId: string, entityKind = 'license'): Promise<EntityRelationship[]> {
  const { data } = await apiClient.get<EntityRelationship[]>(
    `/entities/${encodeURIComponent(entityId)}/relationships`,
    {
      params: { entity_kind: entityKind },
    },
  );
  return Array.isArray(data) ? data : [];
}

export async function getLatestDdReport(entityId: string, entityKind = 'license'): Promise<DdReport | null> {
  const { data } = await apiClient.get<DdReport | null>(
    `/entities/${encodeURIComponent(entityId)}/dd/latest`,
    {
      params: { entity_kind: entityKind },
    },
  );
  return data && typeof data === 'object' ? data : null;
}

export async function getCountryBorders(countries: string[]): Promise<CountryBordersGeoJson> {
  const normalizedCountries = normalizeCountryBordersParam(countries);
  const { data } = await apiClient.get<CountryBordersGeoJson>('/api/map/country-borders', {
    params: normalizedCountries.length > 0 ? { countries: normalizedCountries.join(',') } : undefined,
  });
  return data;
}

export const useUpdateLicense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<MiningLicense> }) => {
      const { data } = await apiClient.put(`/licenses/${id}`, updates);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['licenses'] });
    },
  });
};

export const useDeleteLicense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete(`/licenses/${id}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['licenses'] });
    },
  });
};

// --- Activity Logs ---
export const useActivityLogs = (limit = 100) => {
  return useQuery<ActivityLog[]>({
    queryKey: ['activity-logs', limit],
    queryFn: async () => {
      const { data } = await apiClient.get(`/activity/logs?limit=${limit}`);
      return data;
    },
  });
};

export const useLogActivity = () => {
  return useMutation({
    mutationFn: async (log: Omit<ActivityLog, 'id' | 'timestamp'>) => {
      const { data } = await apiClient.post('/activity/log', log);
      return data;
    },
  });
};

// --- Auth ---
export const login = async (username: string, password: string) => {
  const { data } = await apiClient.post('/auth/login', { username, password });
  return data;
};

/**
 * Requires an admin JWT. Pass `bearerToken` from app state when available so the header
 * matches the logged-in session even if localStorage is out of sync.
 */
export async function deleteAuthUser(userId: string, bearerToken?: string | null): Promise<void> {
  const t = (bearerToken?.trim() || localStorage.getItem('mining_token') || '').trim();
  if (!t) {
    throw new Error('Not authenticated — log in again, then retry delete.');
  }
  await apiClient.delete(`/auth/users/${userId}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
}

// ─── Oil / Petroleum ──────────────────────────────────────────────────────────
// TODO: Agent A — implement GET /api/oil/summary returning OilSummaryResponse.
// Expected shape: { flows: OilTradeFlow[], source: string, data_as_of: string, limitations: string[] }
// Suggested backend sources: UN Comtrade HS 2709/2710/2711 aggregated by reporter,
// or EIA international exports dataset.

const OIL_STUB_FLOWS: OilTradeFlow[] = [
  { country: 'Saudi Arabia',       iso2: 'SA', lat: 23.9,   lng: 45.1,   export_value_usd: 326_000_000_000, import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 1  },
  { country: 'Russia',             iso2: 'RU', lat: 61.5,   lng: 90.4,   export_value_usd: 260_000_000_000, import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 2  },
  { country: 'Norway',             iso2: 'NO', lat: 60.5,   lng: 8.5,    export_value_usd: 170_000_000_000, import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2022, rank: 3  },
  { country: 'United Arab Emirates', iso2: 'AE', lat: 23.4, lng: 53.8,  export_value_usd: 152_000_000_000, import_value_usd: null,             top_hs_code: '2710', top_hs_description: 'Petroleum oils, not crude', category: 'refined', year: 2023, rank: 4  },
  { country: 'United States',      iso2: 'US', lat: 37.1,   lng: -95.7,  export_value_usd: 135_000_000_000, import_value_usd: 200_000_000_000,  top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 5  },
  { country: 'Iraq',               iso2: 'IQ', lat: 33.2,   lng: 43.7,   export_value_usd: 115_000_000_000, import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 6  },
  { country: 'Canada',             iso2: 'CA', lat: 56.1,   lng: -106.3, export_value_usd: 100_000_000_000, import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 7  },
  { country: 'Kuwait',             iso2: 'KW', lat: 29.3,   lng: 47.5,   export_value_usd: 87_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 8  },
  { country: 'Qatar',              iso2: 'QA', lat: 25.4,   lng: 51.2,   export_value_usd: 81_000_000_000,  import_value_usd: null,             top_hs_code: '2711', top_hs_description: 'Petroleum gases',            category: 'gas',     year: 2023, rank: 9  },
  { country: 'Kazakhstan',         iso2: 'KZ', lat: 48.0,   lng: 66.9,   export_value_usd: 48_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 10 },
  { country: 'Iran',               iso2: 'IR', lat: 32.4,   lng: 53.7,   export_value_usd: 50_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2022, rank: 11 },
  { country: 'Nigeria',            iso2: 'NG', lat: 9.1,    lng: 8.7,    export_value_usd: 45_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 12 },
  { country: 'Libya',              iso2: 'LY', lat: 26.3,   lng: 17.2,   export_value_usd: 38_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 13 },
  { country: 'Algeria',            iso2: 'DZ', lat: 28.0,   lng: 2.6,    export_value_usd: 32_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 14 },
  { country: 'Angola',             iso2: 'AO', lat: -11.2,  lng: 17.9,   export_value_usd: 34_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 15 },
  { country: 'Brazil',             iso2: 'BR', lat: -14.2,  lng: -51.9,  export_value_usd: 30_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 16 },
  { country: 'Oman',               iso2: 'OM', lat: 21.5,   lng: 55.9,   export_value_usd: 28_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 17 },
  { country: 'Mexico',             iso2: 'MX', lat: 23.6,   lng: -102.5, export_value_usd: 20_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 18 },
  { country: 'Ecuador',            iso2: 'EC', lat: -1.8,   lng: -78.2,  export_value_usd: 11_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 19 },
  { country: 'Venezuela',          iso2: 'VE', lat: 6.4,    lng: -66.6,  export_value_usd: 8_000_000_000,   import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2022, rank: 20 },
  { country: 'Ghana',              iso2: 'GH', lat: 7.9,    lng: -1.0,   export_value_usd: 5_000_000_000,   import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 21 },
  { country: 'Equatorial Guinea',  iso2: 'GQ', lat: 1.7,    lng: 10.3,   export_value_usd: 4_000_000_000,   import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 22 },
  { country: 'Gabon',              iso2: 'GA', lat: -0.8,   lng: 11.6,   export_value_usd: 5_500_000_000,   import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 23 },
  { country: 'Trinidad and Tobago',iso2: 'TT', lat: 10.7,   lng: -61.2,  export_value_usd: 6_000_000_000,   import_value_usd: null,             top_hs_code: '2711', top_hs_description: 'Petroleum gases',            category: 'gas',     year: 2023, rank: 24 },
  { country: 'Azerbaijan',         iso2: 'AZ', lat: 40.1,   lng: 47.6,   export_value_usd: 15_000_000_000,  import_value_usd: null,             top_hs_code: '2709', top_hs_description: 'Petroleum oils, crude',     category: 'crude',   year: 2023, rank: 25 },
  { country: 'Turkmenistan',       iso2: 'TM', lat: 38.9,   lng: 59.6,   export_value_usd: 8_000_000_000,   import_value_usd: null,             top_hs_code: '2711', top_hs_description: 'Petroleum gases',            category: 'gas',     year: 2022, rank: 26 },
  { country: 'Malaysia',           iso2: 'MY', lat: 4.2,    lng: 108.0,  export_value_usd: 18_000_000_000,  import_value_usd: null,             top_hs_code: '2711', top_hs_description: 'Petroleum gases',            category: 'gas',     year: 2023, rank: 27 },
  { country: 'Indonesia',          iso2: 'ID', lat: -0.8,   lng: 113.9,  export_value_usd: 7_000_000_000,   import_value_usd: null,             top_hs_code: '2711', top_hs_description: 'Petroleum gases',            category: 'gas',     year: 2023, rank: 28 },
  { country: 'Australia',          iso2: 'AU', lat: -25.3,  lng: 133.8,  export_value_usd: 62_000_000_000,  import_value_usd: null,             top_hs_code: '2711', top_hs_description: 'Petroleum gases',            category: 'gas',     year: 2023, rank: 29 },
  { country: 'Netherlands',        iso2: 'NL', lat: 52.1,   lng: 5.3,    export_value_usd: 55_000_000_000,  import_value_usd: 48_000_000_000,   top_hs_code: '2710', top_hs_description: 'Petroleum oils, not crude', category: 'refined', year: 2023, rank: 30 },
  { country: 'Singapore',          iso2: 'SG', lat: 1.4,    lng: 103.8,  export_value_usd: 72_000_000_000,  import_value_usd: 58_000_000_000,   top_hs_code: '2710', top_hs_description: 'Petroleum oils, not crude', category: 'refined', year: 2023, rank: 31 },
];

const OIL_STUB_DATA: OilSummaryResponse = {
  flows: OIL_STUB_FLOWS,
  source: 'Stub (UN Comtrade HS 2709/2710/2711 — approximate 2022-2023)',
  data_as_of: '2023 (stub)',
  limitations: [
    'Data is approximate and for illustrative purposes. Implement /api/oil/summary for live UN Comtrade data.',
    'HS 2709 = crude petroleum; 2710 = refined products; 2711 = petroleum gases (LNG/LPG).',
    'Export values do not include re-exports. Source: estimated from UN Comtrade / EIA.',
  ],
};

/** Lat/lng for map markers — built from stub; extend as new exporters appear in DB. */
const ISO2_TO_COORD: Record<string, { lat: number; lng: number }> = Object.fromEntries(
  OIL_STUB_FLOWS.map((f) => [f.iso2.toUpperCase(), { lat: f.lat, lng: f.lng }])
);

const HS_TO_CATEGORY: Record<string, OilTradeFlow['category']> = {
  '2709': 'crude',
  '2710': 'refined',
  '2711': 'gas',
};

function dominantHsForCountry(
  iso2: string,
  breakdown: Record<string, { exporters?: { reporter_iso2?: string; trade_value_usd?: number }[] }>
): { category: OilTradeFlow['category']; code: string; desc: string } {
  const u = iso2.toUpperCase();
  let best: { hs: string; val: number } | null = null;
  for (const hs of ['2709', '2710', '2711']) {
    const rows = breakdown[hs]?.exporters ?? [];
    const row = rows.find((r) => (r.reporter_iso2 || '').toUpperCase() === u);
    const val = Number(row?.trade_value_usd) || 0;
    if (val > (best?.val ?? 0)) best = { hs, val };
  }
  if (best) {
    const cat = HS_TO_CATEGORY[best.hs] ?? 'other';
    const desc =
      best.hs === '2709'
        ? 'Petroleum oils, crude'
        : best.hs === '2710'
          ? 'Petroleum oils, not crude'
          : 'Petroleum gases';
    return { category: cat, code: best.hs, desc };
  }
  return { category: 'other', code: '2709', desc: 'Petroleum (aggregated)' };
}

/**
 * Backend `/api/oil/summary` returns `top_exporters_by_value` + `breakdown_by_hs`.
 * Older code expected `flows` — normalize so the map always receives markers.
 */
function normalizeOilSummaryResponse(raw: Record<string, unknown>): OilSummaryResponse {
  const lim = raw.limitations;
  const limitations = Array.isArray(lim) ? (lim as string[]) : [];

  if (Array.isArray(raw.flows) && raw.flows.length > 0) {
    return {
      flows: raw.flows as OilTradeFlow[],
      source: (raw.source as string) || (raw.provenance as string) || 'API',
      data_as_of: (raw.data_as_of as string) || String(raw.year ?? ''),
      limitations,
    };
  }

  const tops = raw.top_exporters_by_value;
  if (!Array.isArray(tops) || tops.length === 0) {
    return { flows: [], source: '', data_as_of: '', limitations };
  }

  const breakdown = (raw.breakdown_by_hs || {}) as Record<
    string,
    { exporters?: { reporter_iso2?: string; trade_value_usd?: number }[] }
  >;
  const year = Number(raw.year) || 2022;
  const flows: OilTradeFlow[] = tops.map((row: Record<string, unknown>, i: number) => {
    const iso2 = String(row.reporter_iso2 || '').toUpperCase() || 'XX';
    const coord = ISO2_TO_COORD[iso2] ?? { lat: 20, lng: 10 };
    const { category, code, desc } = dominantHsForCountry(iso2, breakdown);
    return {
      country: String(row.reporter ?? ''),
      iso2,
      lat: coord.lat,
      lng: coord.lng,
      export_value_usd: row.total_value_usd != null ? Number(row.total_value_usd) : null,
      import_value_usd: null,
      top_hs_code: code,
      top_hs_description: desc,
      category,
      year,
      rank: i + 1,
    };
  });

  return {
    flows,
    source: (raw.provenance as string) || 'UN Comtrade (aggregated via backend)',
    data_as_of: String(year),
    limitations: limitations.length
      ? limitations
      : ['Country-level exports only. Run `python backend/ingest_oil_trades.py` if the map is empty.'],
  };
}

export const useOilSummary = (enabled = true) => {
  return useQuery<OilSummaryResponse>({
    queryKey: ['oil-summary'],
    queryFn: async () => {
      try {
        const { data } = await apiClient.get<Record<string, unknown>>('/api/oil/summary');
        if (data?.error) return OIL_STUB_DATA;
        const normalized = normalizeOilSummaryResponse(data);
        if (!normalized.flows.length) return OIL_STUB_DATA;
        return normalized;
      } catch {
        return OIL_STUB_DATA;
      }
    },
    enabled,
    staleTime: 5 * 60_000,
  });
};

export interface MaritimeContextQuery {
  company?: string;
  country?: string;
  commodity?: string;
  lat?: number;
  lng?: number;
  vessel_name?: string;
  mmsi?: string;
  imo?: string;
  destination?: string;
}

export interface MaritimeVesselQueryOptions {
  enabled?: boolean;
  maxVessels?: number;
  captureWindowSeconds?: number;
  scope?: MaritimeVesselScope;
  offset?: number;
  bbox?: MaritimeViewportBounds | null;
}

export const useMaritimeVessels = ({
  enabled = true,
  maxVessels = 60,
  captureWindowSeconds = 10,
  scope = 'oil_tankers',
  offset = 0,
  bbox = null,
}: MaritimeVesselQueryOptions = {}) => {
  return useQuery<MaritimeVesselFeedResponse>({
    queryKey: ['maritime-vessels', scope, maxVessels, captureWindowSeconds, offset, bbox],
    queryFn: async () => {
      const { data } = await apiClient.get<MaritimeVesselFeedResponse>('/api/maritime/vessels', {
        params: {
          max_vessels: maxVessels,
          capture_window_seconds: captureWindowSeconds,
          scope,
          offset,
          ...(bbox ?? {}),
        },
      });
      return data;
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 90_000 : false,
    placeholderData: (previousData) => previousData,
  });
};

export const useMaritimeContext = (params: MaritimeContextQuery, enabled = true) => {
  const hasUsefulQuery =
    Boolean(params.company?.trim()) ||
    Boolean(params.country?.trim()) ||
    Boolean(params.vessel_name?.trim()) ||
    Boolean(params.mmsi?.trim()) ||
    Boolean(params.imo?.trim());

  return useQuery<MaritimeContextResponse>({
    queryKey: ['maritime-context', params],
    queryFn: async () => {
      const { data } = await apiClient.get<MaritimeContextResponse>('/api/maritime/context', {
        params,
      });
      return data;
    },
    enabled: enabled && hasUsefulQuery,
    staleTime: 2 * 60_000,
  });
};

export const useStorageTerminals = (enabled = true) => {
  return useQuery<StorageTerminalResponse>({
    queryKey: ['storage-terminals'],
    queryFn: async () => {
      const { data } = await apiClient.get<StorageTerminalResponse>('/api/storage/terminals');
      return data;
    },
    enabled,
    staleTime: 30 * 60_000,
  });
};

export const useStorageTerminalDetails = (terminalId?: string, enabled = true) => {
  return useQuery<StorageTerminalDetails>({
    queryKey: ['storage-terminal-detail', terminalId],
    queryFn: async () => {
      const { data } = await apiClient.get<StorageTerminalDetails>(
        `/api/storage/terminals/${encodeURIComponent(terminalId || '')}`
      );
      return data;
    },
    enabled: enabled && Boolean(terminalId),
    staleTime: 30 * 60_000,
  });
};

export const usePortLogisticsEntities = (enabled = true) => {
  return useQuery<PortLogisticsResponse>({
    queryKey: ['port-logistics-entities'],
    queryFn: async () => {
      const { data } = await apiClient.get<PortLogisticsResponse>('/api/logistics/ports');
      return data;
    },
    enabled,
    staleTime: 30 * 60_000,
  });
};

export const usePortLogisticsDetails = (entityId?: string, enabled = true) => {
  return useQuery<PortLogisticsDetails>({
    queryKey: ['port-logistics-detail', entityId],
    queryFn: async () => {
      const { data } = await apiClient.get<PortLogisticsDetails>(
        `/api/logistics/ports/${encodeURIComponent(entityId || '')}`
      );
      return data;
    },
    enabled: enabled && Boolean(entityId),
    staleTime: 15 * 60_000,
  });
};

export const useAfricaCoverage = (enabled = true) => {
  return useQuery<AfricaCoverageResponse>({
    queryKey: ['africa-coverage'],
    queryFn: async () => {
      const { data } = await apiClient.get<AfricaCoverageResponse>('/api/open-data/coverage/africa');
      return data;
    },
    enabled,
    staleTime: 15 * 60_000,
  });
};

const EMPTY_COVERAGE_SUMMARY: Record<string, number> = {};
const EMPTY_WORLD_COVERAGE: WorldCoverageResponse = {
  generated_at: '',
  summary: {
    mining: EMPTY_COVERAGE_SUMMARY,
    oil_and_gas: EMPTY_COVERAGE_SUMMARY,
  },
  regional_summary: {},
  region_filter: null,
  countries: [],
  sources: [],
};

function isWorldCoverageResponse(value: unknown): value is WorldCoverageResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<WorldCoverageResponse>;
  return (
    Boolean(data.summary) &&
    typeof data.summary === 'object' &&
    typeof data.summary?.mining === 'object' &&
    typeof data.summary?.oil_and_gas === 'object' &&
    Array.isArray(data.countries) &&
    Array.isArray(data.sources)
  );
}

export const useWorldCoverage = (enabled = true, region?: string) => {
  return useQuery<WorldCoverageResponse>({
    queryKey: ['world-coverage', region ?? 'all'],
    queryFn: async () => {
      try {
        const { data } = await apiClient.get<unknown>('/api/open-data/coverage/world', {
          params: region ? { region } : undefined,
        });
        if (isWorldCoverageResponse(data)) return data;
        console.warn('[useWorldCoverage] Invalid coverage payload; falling back to empty coverage.', data);
        return EMPTY_WORLD_COVERAGE;
      } catch (error) {
        console.warn('[useWorldCoverage] Coverage request failed; falling back to empty coverage.', error);
        return EMPTY_WORLD_COVERAGE;
      }
    },
    enabled,
    staleTime: 15 * 60_000,
  });
};
