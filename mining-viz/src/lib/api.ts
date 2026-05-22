import axios, { isCancel } from 'axios';
import { useMemo } from 'react';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import {
  keepPreviousData,
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
  LegalEvent,
  GovProcurementResponse,
  GovProcurementCompaniesResponse,
  MaritimeContextResponse,
  StorageTerminalDetails,
  StorageTerminalResponse,
  PortLogisticsDetails,
  PortLogisticsResponse,
  AgentJobResponse,
  ContactEnrichmentOutput,
  OperatorValidationOutput,
  DealRoom,
  DealRoomRunResponse,
  DealRoomExportPackage,
} from '../types';
import {
  isLicenseBundleCacheFresh,
  licenseBundleModeFromSector,
  readLicenseBundleCache,
  readLicenseBundleCacheSync,
  writeLicenseBundleCache,
  type LicenseBundleMode,
} from './licenseBundleCache';
import {
  LICENSE_COUNTRY_FETCH_HUB,
  licenseViewportBoundsFromGeoJson,
} from './countryBounds';

export {
  clearLicenseBundleCaches,
  LICENSE_BUNDLE_TTL_MS,
  type LicenseBundleMode,
} from './licenseBundleCache';

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

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

let licensesFallbackDataPromise: Promise<MiningLicense[]> | null = null;

async function loadBundledLicenseFallback(): Promise<MiningLicense[]> {
  if (!licensesFallbackDataPromise) {
    licensesFallbackDataPromise = import('../data/licenses.json').then(({ default: bundledLicenses }) =>
      (bundledLicenses as MiningLicense[]).map((item) => ({
        ...item,
        sector: item.sector || 'mining',
        recordOrigin: item.recordOrigin || 'bundled_json',
        sourceId: item.sourceId || 'bundled_json',
        sourceName: item.sourceName || 'Bundled JSON fallback',
        sourceKind: item.sourceKind || 'bundled_json',
        sourceAccess: item.sourceAccess || 'local_fallback',
        coverageState: item.coverageState || 'fallback_only',
        confidenceScore: item.confidenceScore ?? 0.35,
        confidenceNote:
          item.confidenceNote ||
          'Bundled local fallback loaded after the live licenses API failed; verify against official source before deal execution.',
      })),
    );
  }
  return licensesFallbackDataPromise;
}
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

// Request interceptor for auth (mining_token from login UI; token alias for legacy scripts)
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('mining_token') || localStorage.getItem('token');
  if (token?.trim()) {
    config.headers.Authorization = `Bearer ${token.trim()}`;
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
/** Map viewport fetch cap (backend clamps to 15000). */
const LICENSE_VIEWPORT_LIMIT = 5000;
/** Single debounce for map pan (MapComponent emits bounds immediately). */
const LICENSE_VIEWPORT_DEBOUNCE_MS = 400;
const LICENSE_VIEWPORT_STALE_MS = 10 * 60_000;

/** Coarsen bbox so tiny pans do not refetch (≈0.25° grid). */
export function quantizeLicenseViewportBounds(
  bounds: LicenseViewportBounds,
): LicenseViewportBounds {
  const step = 0.25;
  const q = (n: number) => Math.round(n / step) * step;
  return {
    south: q(bounds.south),
    west: q(bounds.west),
    north: q(bounds.north),
    east: q(bounds.east),
  };
}
/** Legacy bulk load — prefer useLicensesForMap. */
const LICENSE_BULK_LIMIT = 15_000;
const LICENSE_BUNDLE_STALE_MS = 60 * 60_000;
/** USGS global fallback — excluded from map country fetches (dominates shared SQL limits). */
const LICENSE_MAP_EXCLUDED_COUNTRIES = new Set(['Global']);
/** Always requested for map loads when coverage metadata is available. */
const CSV_PRIORITY_LICENSE_COUNTRIES = ['Ghana', 'South Africa'] as const;

/** OPEC / Persian Gulf — always fetched on the oil & gas map even before world-coverage counts exist. */
const OPEC_GULF_PRIORITY_LICENSE_COUNTRIES = [
  'Saudi Arabia',
  'United Arab Emirates',
  'Kuwait',
  'Qatar',
  'Iran',
  'Iraq',
  'Oman',
  'Bahrain',
  'Libya',
  'Algeria',
  'Nigeria',
  'Venezuela',
] as const;

/** Fallback country list used when world-coverage metadata is unavailable. */
const FALLBACK_LICENSE_FETCH_COUNTRIES: string[] = [
  'Ghana',
  'South Africa',
  'Kenya',
  'Zambia',
  'Nigeria',
  'Tanzania',
  'Angola',
  'Zimbabwe',
  'Mozambique',
  'Namibia',
  'Democratic Republic of the Congo',
  'Algeria',
  'Egypt',
  'Ethiopia',
  'Gabon',
  'Guinea',
  'Liberia',
  'Madagascar',
  'Mali',
  'Mauritania',
  'Morocco',
  'Senegal',
  'Sierra Leone',
  'Sudan',
  'Uganda',
  'Congo',
  'Botswana',
  'United Arab Emirates',
  'Saudi Arabia',
  'Kuwait',
  'Qatar',
  'Iran',
  'Bahrain',
  'Libya',
  'Venezuela',
  'Australia',
  'Canada',
  'Peru',
  'Chile',
  'Brazil',
  'Iraq',
  'Oman',
];

/** Max distinct countries returned by deriveLicenseFetchCountries (all passed in one request). */
const MAX_LICENSE_FETCH_COUNTRIES = 80;


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
  const priorityCountries =
    sector === 'oil_and_gas'
      ? [...OPEC_GULF_PRIORITY_LICENSE_COUNTRIES, ...CSV_PRIORITY_LICENSE_COUNTRIES]
      : [...CSV_PRIORITY_LICENSE_COUNTRIES];

  const rows = worldCoverage?.countries;
  if (rows?.length) {
    const scored: { name: string; w: number }[] = [];
    for (const row of rows) {
      const name = row.country?.trim();
      if (!name || LICENSE_MAP_EXCLUDED_COUNTRIES.has(name)) continue;
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
    const ranked = Array.from(byName.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const name of [...priorityCountries, ...ranked]) {
      if (seen.has(name) || LICENSE_MAP_EXCLUDED_COUNTRIES.has(name)) continue;
      seen.add(name);
      merged.push(name);
      if (merged.length >= MAX_LICENSE_FETCH_COUNTRIES) break;
    }
    if (merged.length) return merged;
  }
  if (sector === 'oil_and_gas') {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const name of [...priorityCountries, ...FALLBACK_LICENSE_FETCH_COUNTRIES]) {
      if (seen.has(name) || LICENSE_MAP_EXCLUDED_COUNTRIES.has(name)) continue;
      seen.add(name);
      merged.push(name);
    }
    return merged;
  }
  return [...FALLBACK_LICENSE_FETCH_COUNTRIES];
}

export type UseLicensesResult = {
  data: MiningLicense[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  /** Always 0 or 1 — one bundle request per view mode (no per-country fan-out). */
  stillLoadingCountryCount: number;
  failedCountryQueryCount: number;
  bundleMode: LicenseBundleMode;
};

async function parseLicensesResponse(data: unknown): Promise<MiningLicense[]> {
  if (Array.isArray(data)) return data as MiningLicense[];
  if (data && typeof data === 'object' && 'error' in data) {
    const msg = String((data as { error?: unknown }).error ?? 'Licenses request failed');
    throw new Error(msg);
  }
  console.warn('[licenses] Expected array from /licenses, got:', data);
  return [];
}

async function fetchLicenseBundleFromApi(
  sector: 'mining' | 'oil_and_gas' | undefined,
  signal?: AbortSignal,
): Promise<MiningLicense[]> {
  const { data } = await apiClient.get<unknown>('/licenses', {
    signal,
    timeout: LICENSE_GET_TIMEOUT_MS,
    params: {
      prefer_open_data: true,
      limit: LICENSE_BULK_LIMIT,
      ...(sector ? { sector } : {}),
    },
  });
  return parseLicensesResponse(data);
}

async function fetchLicensesViewportFromApi(
  options: {
    sector?: 'mining' | 'oil_and_gas';
    bounds: LicenseViewportBounds;
    countries?: string[];
    signal?: AbortSignal;
  },
): Promise<MiningLicense[]> {
  const { sector, bounds, countries, signal } = options;
  const params: Record<string, string | number | boolean> = {
    prefer_open_data: true,
    limit: LICENSE_VIEWPORT_LIMIT,
    min_lat: bounds.south,
    max_lat: bounds.north,
    min_lng: bounds.west,
    max_lng: bounds.east,
  };
  if (sector) params.sector = sector;
  if (countries?.length) params.countries = countries.join(',');
  const { data } = await apiClient.get<unknown>('/licenses', {
    signal,
    timeout: 60_000,
    params,
  });
  return parseLicensesResponse(data);
}

/** Viewport-scoped licenses for the map (debounced bbox). Country filters use `countries` param when set. */
export function useLicensesForMap(options: {
  sector?: 'mining' | 'oil_and_gas';
  bounds: LicenseViewportBounds | null;
  filterCountries?: string[];
  /** Country-focus mode: fetch by country border bbox only (no `countries` SQL filter). */
  countryFocusBboxOnly?: boolean;
  enabled: boolean;
}): UseLicensesResult {
  const { sector, bounds, filterCountries = [], countryFocusBboxOnly = false, enabled } = options;
  const debouncedBounds = useDebouncedValue(bounds, LICENSE_VIEWPORT_DEBOUNCE_MS);
  const viewportBounds = useMemo(
    () => (debouncedBounds ? quantizeLicenseViewportBounds(debouncedBounds) : null),
    [debouncedBounds],
  );
  const countriesKey = filterCountries.length ? filterCountries.join('|') : '';
  const countryScoped = filterCountries.length > 0;

  const bordersQuery = useQuery({
    queryKey: ['country-borders', 'license-fetch', countriesKey] as const,
    queryFn: () => getCountryBorders(filterCountries),
    enabled: enabled && countryScoped,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24 * 7,
  });

  const countryFetchBounds = useMemo(() => {
    if (!countryScoped) return null;
    return (
      licenseViewportBoundsFromGeoJson(bordersQuery.data) ?? LICENSE_COUNTRY_FETCH_HUB
    );
  }, [countryScoped, bordersQuery.data]);

  const fetchBounds = countryScoped ? countryFetchBounds : viewportBounds;

  const query = useQuery({
    queryKey: [
      'licenses',
      'viewport',
      sector,
      countriesKey,
      countryFocusBboxOnly ? 'focus-bbox' : 'scoped',
      fetchBounds,
    ] as const,
    staleTime: LICENSE_VIEWPORT_STALE_MS,
    gcTime: LICENSE_VIEWPORT_STALE_MS * 2,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      if (countryScoped && fetchBounds) {
        return fetchLicensesViewportFromApi({
          sector,
          bounds: fetchBounds,
          countries: countryFocusBboxOnly ? undefined : filterCountries,
          signal,
        });
      }
      if (!fetchBounds) return [];
      return fetchLicensesViewportFromApi({ sector, bounds: fetchBounds, signal });
    },
    enabled: enabled && (countryScoped ? fetchBounds != null : viewportBounds != null),
  });

  const stillLoadingCountryCount =
    query.isLoading && !query.data?.length ? 1 : 0;
  const failedCountryQueryCount = query.isError && !query.data?.length ? 1 : 0;

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null,
    stillLoadingCountryCount,
    failedCountryQueryCount,
    bundleMode: licenseBundleModeFromSector(sector),
  };
}

export const useLicenses = (sector?: 'mining' | 'oil_and_gas'): UseLicensesResult => {
  const bundleMode = licenseBundleModeFromSector(sector);
  const syncCached = useMemo(() => readLicenseBundleCacheSync(bundleMode), [bundleMode]);

  const query = useQuery({
    queryKey: ['licenses', 'bundle', bundleMode] as const,
    staleTime: LICENSE_BUNDLE_STALE_MS,
    gcTime: 2 * LICENSE_BUNDLE_STALE_MS,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (previousData: MiningLicense[] | undefined) => previousData,
    initialData: syncCached?.licenses,
    initialDataUpdatedAt: syncCached?.fetchedAt,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const cached = await readLicenseBundleCache(bundleMode);
      if (cached && isLicenseBundleCacheFresh(cached)) {
        return cached.licenses;
      }

      try {
        const fresh = await fetchLicenseBundleFromApi(sector, signal);
        await writeLicenseBundleCache(bundleMode, fresh);
        return fresh;
      } catch (error) {
        if (isLicensesRequestAborted(error)) {
          throw error;
        }
        if (cached?.licenses.length) {
          return cached.licenses;
        }
        if (sector !== 'oil_and_gas' && canUseBundledLicenseFallback()) {
          console.warn(
            '[useLicenses] /licenses failed; using bundled mining fallback because local fallback is enabled.',
            error,
          );
          const fallbackData = await loadBundledLicenseFallback();
          const base = sector
            ? fallbackData.filter((item) => item.sector === sector)
            : fallbackData;
          await writeLicenseBundleCache(bundleMode, base);
          return base;
        }
        throw error;
      }
    },
  });

  const stillLoadingCountryCount = query.isLoading && !query.data?.length ? 1 : 0;
  const failedCountryQueryCount = query.isError && !query.data?.length ? 1 : 0;

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null,
    stillLoadingCountryCount,
    failedCountryQueryCount,
    bundleMode,
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

export async function runContactEnrichmentAgent(
  entityId: string,
  entityKind = 'license',
): Promise<AgentJobResponse<ContactEnrichmentOutput>> {
  const { data } = await apiClient.post<AgentJobResponse<ContactEnrichmentOutput>>(
    '/api/agents/contact-enrichment',
    {
      entity_id: entityId,
      entity_kind: entityKind,
    },
  );
  return data;
}

export async function runOperatorValidationAgent(
  entityId: string,
  entityKind = 'license',
): Promise<AgentJobResponse<OperatorValidationOutput>> {
  const { data } = await apiClient.post<AgentJobResponse<OperatorValidationOutput>>(
    '/api/agents/operator-validation',
    {
      entity_id: entityId,
      entity_kind: entityKind,
    },
  );
  return data;
}

export async function getAgentJob<TOutput = Record<string, unknown>>(
  jobId: string,
): Promise<AgentJobResponse<TOutput>> {
  const { data } = await apiClient.get<AgentJobResponse<TOutput>>(
    `/api/agents/jobs/${encodeURIComponent(jobId)}`,
  );
  return data;
}

export async function listDealRooms(options: {
  entityId?: string;
  entityKind?: string;
  includeArchived?: boolean;
} = {}): Promise<DealRoom[]> {
  const { data } = await apiClient.get<DealRoom[]>('/api/deal-rooms', {
    params: {
      ...(options.entityId ? { entity_id: options.entityId } : {}),
      ...(options.entityKind ? { entity_kind: options.entityKind } : {}),
      ...(options.includeArchived ? { include_archived: true } : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

export async function createDealRoom(payload: {
  entityId: string;
  entityKind?: string;
  title?: string;
  status?: string;
  routeSnapshot?: Record<string, unknown>;
  notes?: string;
  rfq_quantity?: string;
  rfq_hs_code?: string;
  rfq_incoterm?: string;
  rfq_product?: string;
}): Promise<DealRoom> {
  const { data } = await apiClient.post<DealRoom>('/api/deal-rooms', {
    entity_id: payload.entityId,
    entity_kind: payload.entityKind ?? 'license',
    title: payload.title,
    status: payload.status,
    route_snapshot: payload.routeSnapshot,
    notes: payload.notes,
    rfq_quantity: payload.rfq_quantity,
    rfq_hs_code: payload.rfq_hs_code,
    rfq_incoterm: payload.rfq_incoterm,
    rfq_product: payload.rfq_product,
  });
  return data;
}

export async function updateDealRoom(
  dealRoomId: string,
  payload: {
    title?: string;
    status?: string;
    routeSnapshot?: Record<string, unknown> | null;
    evidence?: Record<string, unknown>;
    notes?: string;
  },
): Promise<DealRoom> {
  const { data } = await apiClient.patch<DealRoom>(
    `/api/deal-rooms/${encodeURIComponent(dealRoomId)}`,
    {
      title: payload.title,
      status: payload.status,
      route_snapshot: payload.routeSnapshot,
      evidence: payload.evidence,
      notes: payload.notes,
    },
  );
  return data;
}

export async function runDealRoomAgents(
  dealRoomId: string,
  options: { agents?: string[]; forceRefresh?: boolean; runSync?: boolean } = {},
): Promise<DealRoomRunResponse> {
  const { data } = await apiClient.post<DealRoomRunResponse>(
    `/api/deal-rooms/${encodeURIComponent(dealRoomId)}/agents/run`,
    {
      agents: options.agents,
      force_refresh: options.forceRefresh,
      run_sync: options.runSync,
    },
  );
  return data;
}

export async function exportDealRoom(
  dealRoomId: string,
  format: 'json' | 'markdown' = 'json',
): Promise<DealRoomExportPackage | string> {
  const { data } = await apiClient.get<DealRoomExportPackage | string>(
    `/api/deal-rooms/${encodeURIComponent(dealRoomId)}/export`,
    {
      params: format === 'markdown' ? { format: 'markdown' } : undefined,
      responseType: format === 'markdown' ? 'text' : 'json',
    },
  );
  return data;
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

/**
 * Fetch persisted litigation / regulatory events for an entity.
 *
 * Set ``refresh: true`` to trigger the backend's live-adapter + stub
 * collector before reading. The AI extraction path runs only during
 * /api/ai/analyze, so this stays cheap to call on every dossier open.
 */
export async function getLegalEvents(
  entityId: string,
  entityKind = 'license',
  options: { refresh?: boolean } = {},
): Promise<LegalEvent[]> {
  const { data } = await apiClient.get<LegalEvent[]>(
    `/entities/${encodeURIComponent(entityId)}/legal-events`,
    {
      params: {
        entity_kind: entityKind,
        ...(options.refresh ? { refresh: true } : {}),
      },
    },
  );
  return Array.isArray(data) ? data : [];
}

/** U.S. federal awards for a licensee (database-backed; optional live USAspending). */
export async function getGovProcurement(
  entityId: string,
  entityKind = 'license',
  options: { live?: boolean } = {},
): Promise<GovProcurementResponse> {
  const { data } = await apiClient.get<GovProcurementResponse>(
    `/entities/${encodeURIComponent(entityId)}/gov-procurement`,
    {
      params: {
        entity_kind: entityKind,
        ...(options.live ? { live: true } : {}),
      },
    },
  );
  if (!data || typeof data !== 'object') {
    return {
      source: 'USAspending.gov',
      sourceUrl: 'https://www.usaspending.gov',
      scope: 'U.S. federal awards',
      limitations: [],
      warnings: ['Unexpected response from gov-procurement endpoint.'],
      summary: {
        totalAwardedUsd: 0,
        activeContractCount: 0,
        awardCount: 0,
        portfolioByCategoryPct: { precious: 0, fuels: 0, strategic: 0, other: 0 },
      },
      awards: [],
    };
  }
  return data;
}

export type EuProcurementNotice = {
  notice_id: string;
  title?: string;
  buyer?: string;
  country?: string;
  cpv?: string;
  award_value?: number;
  published_at?: string;
  source_url?: string;
};

export type EuProcurementResponse = {
  source?: string;
  sourceUrl?: string;
  scope?: string;
  queryCompany?: string;
  countryFilter?: string;
  cpvBucket?: string;
  cpvBucketLabel?: string;
  licenseCommodity?: string;
  limitations?: string[];
  warnings?: string[];
  notices?: EuProcurementNotice[];
  summary?: { notice_count?: number; countries?: string[] };
};

/** EU TED notices matched to a licensee (fuzzy company name). */
export async function getEuProcurement(
  entityId: string,
  entityKind = 'license',
  options: { cpvBucket?: string; limit?: number } = {},
): Promise<EuProcurementResponse> {
  const { data } = await apiClient.get<EuProcurementResponse>(
    `/entities/${encodeURIComponent(entityId)}/eu-procurement`,
    {
      params: {
        entity_kind: entityKind,
        ...(options.cpvBucket ? { cpv_bucket: options.cpvBucket } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
      },
    },
  );
  if (!data || typeof data !== 'object') {
    return {
      source: 'TED (EU procurement)',
      sourceUrl: 'https://ted.europa.eu/',
      limitations: [],
      warnings: ['Unexpected response from eu-procurement endpoint.'],
      notices: [],
      summary: { notice_count: 0, countries: [] },
    };
  }
  return data;
}

/** Browse U.S. federal contractors with commodity-tagged awards (database-backed). */
export async function getGovProcurementCompanies(
  options: {
    commodity?: string;
    refresh?: boolean;
    matchLicenses?: boolean;
    page?: number;
    pageSize?: number;
    limit?: number;
  } = {},
): Promise<GovProcurementCompaniesResponse> {
  const { data } = await apiClient.get<GovProcurementCompaniesResponse>(
    '/gov-procurement/companies',
    {
      params: {
        ...(options.commodity ? { commodity: options.commodity } : {}),
        ...(options.refresh ? { refresh: true } : {}),
        ...(options.matchLicenses ? { match_licenses: true } : {}),
        ...(options.page ? { page: options.page } : {}),
        ...(options.pageSize ? { page_size: options.pageSize } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
      },
    },
  );
  if (!data || typeof data !== 'object') {
    return {
      source: 'USAspending.gov',
      sourceUrl: 'https://www.usaspending.gov',
      scope: 'U.S. federal contracts by commodity',
      limitations: [],
      warnings: ['Unexpected response from gov-procurement companies endpoint.'],
      commodityProfiles: [],
      companies: [],
    };
  }
  return data;
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

export {
  useMaritimeVessels,
  prefetchMaritimeVesselSnapshot,
  fetchMaritimeVesselSnapshot,
  MARITIME_INCLUDE_GULF_DEMO_LOCALSTORAGE_KEY,
  MARITIME_INCLUDE_COASTAL_DEMO_LOCALSTORAGE_KEY,
  readMaritimeIncludeGulfDemoPreference,
  readMaritimeIncludeCoastalDemoPreference,
} from './vessels/useVessels';
export type { MaritimeVesselQueryOptions, MaritimeSnapshotFetchOptions } from './vessels/useVessels';

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

export const useWorldCoverage = (enabled = true, region?: string, country?: string) => {
  return useQuery<WorldCoverageResponse>({
    queryKey: ['world-coverage', region ?? 'all', country ?? ''],
    queryFn: async () => {
      try {
        const params: Record<string, string> = {};
        if (region) params.region = region;
        if (country?.trim()) params.country = country.trim();
        const { data } = await apiClient.get<unknown>('/api/open-data/coverage/world', {
          params: Object.keys(params).length ? params : undefined,
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
