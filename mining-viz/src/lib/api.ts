import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MiningLicense, User, ActivityLog } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || 
  (window.location.protocol === 'https:' ? '' : `http://${window.location.hostname}:8000`);

const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for auth
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('mining_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Licenses ---
export const useLicenses = () => {
  return useQuery<MiningLicense[]>({
    queryKey: ['licenses'],
    queryFn: async () => {
      const { data } = await apiClient.get('/licenses');
      return data;
    },
  });
};

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
