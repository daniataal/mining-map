import axios, { isAxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';
import type { MiningLicense } from '../types';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Omit Bearer token (login + routes the backend treats as public reads). */
    skipAuth?: boolean;
  }
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeApiBase(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  const withProtocol = /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `http://${trimmedValue}`;
  return trimTrailingSlashes(withProtocol);
}

function resolveApiBase(): string {
  const explicitApiBase = process.env.EXPO_PUBLIC_API_BASE?.trim();
  if (explicitApiBase) {
    return normalizeApiBase(explicitApiBase);
  }

  const legacyRemoteHost = process.env.EXPO_PUBLIC_REMOTE_HOST?.trim();
  if (legacyRemoteHost) {
    return normalizeApiBase(legacyRemoteHost);
  }

  throw new Error(
    'Missing mobile API configuration. Set EXPO_PUBLIC_API_BASE (preferred) or EXPO_PUBLIC_REMOTE_HOST in meridian-mobile/.env.',
  );
}

// Prefer a full explicit API base so mobile relies on env config instead of source fallbacks.
export const API_BASE = resolveApiBase();

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 60000, // Increased to 60s to handle large/slow datasets
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(async (config) => {
  if (config.skipAuth) return config;
  const token = await SecureStore.getItemAsync('mining_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Add a response interceptor to handle 401 Unauthorized errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Clear the invalid token so the app redirects to LoginScreen on next mount/reload
      await SecureStore.deleteItemAsync('mining_token');
    }
    return Promise.reject(error);
  }
);

export default apiClient;

export type CountryBordersGeoJson = FeatureCollection<Geometry, GeoJsonProperties>;

export function getApiErrorMessage(error: unknown, fallbackMessage = 'Request failed'): string {
  if (isAxiosError(error)) {
    const responseData = error.response?.data as
      | string
      | { detail?: unknown; message?: unknown }
      | undefined;

    if (typeof responseData === 'string' && responseData.trim()) {
      return responseData;
    }

    if (responseData && typeof responseData === 'object') {
      if (typeof responseData.detail === 'string' && responseData.detail.trim()) {
        return responseData.detail;
      }
      if (typeof responseData.message === 'string' && responseData.message.trim()) {
        return responseData.message;
      }
      if (
        responseData.detail &&
        typeof responseData.detail === 'object' &&
        'message' in responseData.detail &&
        typeof responseData.detail.message === 'string' &&
        responseData.detail.message.trim()
      ) {
        return responseData.detail.message;
      }
    }

    if (!error.response) {
      return `Could not reach the Meridian backend at ${API_BASE}. Check device connectivity and Android cleartext settings.`;
    }

    if (error.code === 'ECONNABORTED') {
      return `Connection to ${API_BASE} timed out.`;
    }
  }

  return error instanceof Error && error.message ? error.message : fallbackMessage;
}

function normalizeCountryBordersResponse(data: CountryBordersGeoJson | string): CountryBordersGeoJson {
  if (typeof data === 'string') {
    return JSON.parse(data) as CountryBordersGeoJson;
  }
  return data;
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

// --- Auth ---
export const login = async (username: string, password: string) => {
  const { data } = await apiClient.post('/auth/login', { username, password }, { skipAuth: true });
  return data;
};

// --- Licenses ---
export const getLicenses = async (): Promise<MiningLicense[]> => {
  const { data } = await apiClient.get<MiningLicense[]>('/licenses', { skipAuth: true });
  return data;
};

export const getCountryBorders = async (countries: string[]): Promise<CountryBordersGeoJson> => {
  const normalizedCountries = normalizeCountryBordersParam(countries);
  const { data } = await apiClient.get<CountryBordersGeoJson | string>('/api/map/country-borders', {
    skipAuth: true,
    params: normalizedCountries.length > 0 ? { countries: normalizedCountries.join(',') } : undefined,
  });
  return normalizeCountryBordersResponse(data);
};

export const updateLicense = async (id: string, updates: any) => {
  const { data } = await apiClient.put(`/licenses/${id}`, updates);
  return data;
};

export const deleteLicense = async (id: string) => {
  const { data } = await apiClient.delete<{ status: string; deleted_id: string }>(`/licenses/${id}`);
  return data;
};

export type LicenseImportRowError = { row: number; message: string };

/** Paste the same CSV as the web template (header row + data). */
export async function importLicensesCsvText(csv: string): Promise<{ importedCount: number }> {
  try {
    const { data } = await apiClient.post<{ status: string; imported_count: number }>('/licenses/import-text', {
      csv,
    });
    if (data.status !== 'success') {
      throw new Error('Unexpected import response');
    }
    return { importedCount: data.imported_count };
  } catch (err: unknown) {
    if (isAxiosError(err) && err.response?.status === 422) {
      const detail = err.response.data?.detail as { errors?: LicenseImportRowError[] } | undefined;
      const rows = detail?.errors;
      if (Array.isArray(rows) && rows.length > 0) {
        const msg = rows.map((r) => (r.row > 0 ? `Line ${r.row}: ${r.message}` : r.message)).join('\n');
        throw new Error(msg);
      }
    }
    if (isAxiosError(err)) {
      const d = err.response?.data as { detail?: { message?: string } | string } | undefined;
      if (typeof d?.detail === 'object' && d.detail?.message) {
        throw new Error(String(d.detail.message));
      }
      if (typeof d?.detail === 'string') {
        throw new Error(d.detail);
      }
    }
    throw err instanceof Error ? err : new Error('Import failed');
  }
}

// --- Miner Listings (Trade Deals) ---
export const getMinerListings = async () => {
  const { data } = await apiClient.get('/miner-listings', { skipAuth: true });
  return data;
};

// --- Oil ---
export const getOilSummary = async () => {
  const { data } = await apiClient.get('/api/oil/summary', { skipAuth: true });
  return data;
};

// --- Market ---
export const getMarketTicker = async () => {
  const { data } = await apiClient.get('/api/market-ticker', { skipAuth: true });
  return data;
};
