import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

/** oil-live-intel upstream for Vite dev proxy (Docker: oil-live-intel:8095; host dev: localhost:8095). */
const oilIntelProxyTarget =
  process.env.OIL_INTEL_PROXY_TARGET ||
  process.env.VITE_OIL_INTEL_PROXY ||
  'http://localhost:8095';

/** Python backend upstream (Docker: backend:8000; host dev: localhost:8000). */
const backendProxyTarget =
  process.env.BACKEND_PROXY_TARGET ||
  process.env.VITE_BACKEND_PROXY ||
  'http://localhost:8000';

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
    // Caddy serves the UI on :8080 with Host localhost:8080 — allow proxy API calls from that host.
    allowedHosts: ['localhost', '127.0.0.1', 'frontend', 'mining-frontend'],
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
      '/api/maritime/stats': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/maritime\/stats/, '/api/oil-live/maritime/stats'),
      },
      '/api/maritime/context': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/maritime\/context/, '/api/oil-live/maritime/context'),
      },
      '/api/maritime/vessels': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/maritime\/vessels/, '/api/oil-live/vessels/live'),
      },
      '/api/licenses/annotations': {
        target: backendProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/api/licenses': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
        router(req) {
          if ((req.url ?? '').includes('/annotations')) {
            return backendProxyTarget;
          }
          return oilIntelProxyTarget;
        },
        rewrite(path) {
          if (path.includes('/annotations')) {
            return path;
          }
          return path.replace(/^\/api\/licenses/, '/api/oil-live/licenses');
        },
      },
      '/api/oil-live': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
        ws: true,
      },
      '/api/petroleum/osm-tiles': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
        rewrite: (path) =>
          path.replace(/^\/api\/petroleum\/osm-tiles/, '/api/oil-live/map/petroleum-osm/tiles'),
      },
      '/api/petroleum/osm-layers': {
        target: backendProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/licenses': {
        target: oilIntelProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/licenses/, '/api/oil-live/licenses'),
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/api': {
        target: backendProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/auth': {
        target: backendProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/activity': {
        target: backendProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/docs': {
        target: backendProxyTarget,
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/openapi.json': {
        target: backendProxyTarget,
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
          maplibre: ['maplibre-gl', '@maplibre/maplibre-gl-leaflet'],
          markdown: ['react-markdown', 'remark-gfm'],
          motion: ['framer-motion'],
          query: ['@tanstack/react-query', 'axios'],
        },
      },
    },
  },
});
