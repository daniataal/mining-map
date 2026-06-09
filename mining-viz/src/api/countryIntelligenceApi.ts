export type CountryIntelligenceOperator = {
  company: string;
  count: number;
  sector: string;
};

export type CountryIntelligenceTradeSignal = {
  label: string;
  value: string;
  tier: 'evidence' | 'inferred' | 'missing';
};

export type CountryIntelligence = {
  country: string;
  license_counts: {
    mining: number;
    oil_and_gas: number;
    total: number;
    map_visible_count?: number;
    coordinate_valid_count?: number;
    stored_total_count?: number;
    count_explanation?: string;
  };
  port_count: number;
  vessel_count: number | null;
  vessel_coverage_note: string | null;
  top_operators: CountryIntelligenceOperator[];
  trade_signals: CountryIntelligenceTradeSignal[];
  data_tier: string;
  disclaimer: string;
};

export async function fetchCountryIntelligence(country: string): Promise<CountryIntelligence> {
  const res = await fetch(
    `/api/oil-live/intelligence/country/${encodeURIComponent(country)}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body?.error === 'string' ? body.error : `Country intelligence failed (${res.status})`,
    );
  }
  return res.json() as Promise<CountryIntelligence>;
}
