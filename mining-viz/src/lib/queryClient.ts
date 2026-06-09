import { QueryClient } from '@tanstack/react-query';

/** Shared React Query client for the app shell and Leaflet portal popups. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
