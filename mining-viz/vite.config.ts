import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

/** oil-live-intel upstream for Vite dev proxy (Docker: oil-live-intel:8095; host dev: localhost:8095). */
const oilIntelProxyTarget =
  process.env.OIL_INTEL_PROXY_TARGET ||
  process.env.VITE_OIL_INTEL_PROXY ||
  'http://localhost:8095';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api/oil-live/ws': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        ws: true,
      },
      '/api/map/country-borders': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/map\/country-borders/, '/api/oil-live/map/country-borders'),
      },
      '/api/oil-live': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
        ws: true,
      },
      '/licenses': {
        target: 'http://backend:8000',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/auth': {
        target: 'http://backend:8000',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/activity': {
        target: 'http://backend:8000',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/docs': {
        target: 'http://backend:8000',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/openapi.json': {
        target: 'http://backend:8000',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          map: ['leaflet', 'react-leaflet', 'react-leaflet-cluster'],
          markdown: ['react-markdown', 'remark-gfm'],
          motion: ['framer-motion'],
          query: ['@tanstack/react-query', 'axios'],
        },
      },
    },
  },
});
