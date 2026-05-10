import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Default to localhost for dev, but should be configurable
export const API_BASE = 'http://localhost:8000'; 

const apiClient = axios.create({
  baseURL: API_BASE,
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

export default apiClient;

// --- Auth ---
export const login = async (username: string, password: string) => {
  const { data } = await apiClient.post('/auth/login', { username, password });
  return data;
};

// --- Licenses ---
export const getLicenses = async () => {
  const { data } = await apiClient.get('/licenses');
  return data;
};

export const updateLicense = async (id: string, updates: any) => {
  const { data } = await apiClient.put(`/licenses/${id}`, updates);
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
