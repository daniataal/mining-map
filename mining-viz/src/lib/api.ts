import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MiningLicense, User, ActivityLog, OilSummaryResponse, OilTradeFlow } from '../types';

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
