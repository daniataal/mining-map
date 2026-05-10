import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Construct the API base URL using the REMOTE_HOST environment variable
export const API_BASE = `http://${process.env.EXPO_PUBLIC_REMOTE_HOST}:8000`; 

console.log('--- API_BASE DEBUG ---');
console.log('Value:', API_BASE);
console.log('REMOTE_HOST Env:', process.env.EXPO_PUBLIC_REMOTE_HOST);
console.log('-----------------------');

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 10000, // Add a timeout to prevent infinite hang
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
