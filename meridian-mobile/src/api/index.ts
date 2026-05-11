import axios, { isAxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import type { MiningLicense } from '../types';

// Construct the API base URL using the REMOTE_HOST environment variable
export const API_BASE = `http://${process.env.EXPO_PUBLIC_REMOTE_HOST}:8000`; 

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 60000, // Increased to 60s to handle large/slow datasets
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(async (config) => {
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

// --- Auth ---
export const login = async (username: string, password: string) => {
  const { data } = await apiClient.post('/auth/login', { username, password });
  return data;
};

// --- Licenses ---
export const getLicenses = async (): Promise<MiningLicense[]> => {
  const { data } = await apiClient.get<MiningLicense[]>('/licenses');
  return data;
};

export const updateLicense = async (id: string, updates: any) => {
  const { data } = await apiClient.put(`/licenses/${id}`, updates);
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
  const { data } = await apiClient.get('/miner-listings');
  return data;
};

// --- Oil ---
export const getOilSummary = async () => {
  const { data } = await apiClient.get('/api/oil/summary');
  return data;
};

// --- Market ---
export const getMarketTicker = async () => {
  const { data } = await apiClient.get('/api/market-ticker');
  return data;
};
