import { API_BASE } from '../lib/api';

export type CommodityBenchmark = {
  source: string;
  tier: string;
  product?: string;
  country?: string;
  period?: string;
  value?: number | null;
  unit?: string | null;
  disclaimer?: string;
};

export async function getCommodityBenchmarks(
  products = 'crude,diesel,jet,gold',
): Promise<{ benchmarks: CommodityBenchmark[]; disclaimer?: string }> {
  const res = await fetch(
    `${API_BASE}/api/commodity/benchmarks?products=${encodeURIComponent(products)}`,
  );
  if (!res.ok) throw new Error(`benchmarks ${res.status}`);
  return res.json();
}
