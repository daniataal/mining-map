export type DealProductOption = {
  id: string;
  label: string;
  sector: 'oil' | 'gas' | 'mining' | 'agriculture' | 'other';
  units: string[];
  defaultUnit: string;
};

export const DEAL_PRODUCT_OPTIONS: DealProductOption[] = [
  { id: 'crude_oil', label: 'Crude oil', sector: 'oil', units: ['bbl', 'mt'], defaultUnit: 'bbl' },
  { id: 'diesel', label: 'Diesel', sector: 'oil', units: ['bbl', 'mt', 'm3'], defaultUnit: 'bbl' },
  { id: 'gasoline', label: 'Gasoline', sector: 'oil', units: ['bbl', 'mt', 'm3'], defaultUnit: 'bbl' },
  { id: 'jet_fuel', label: 'Jet fuel', sector: 'oil', units: ['bbl', 'mt', 'm3'], defaultUnit: 'bbl' },
  { id: 'fuel_oil', label: 'Fuel oil', sector: 'oil', units: ['bbl', 'mt'], defaultUnit: 'mt' },
  { id: 'lng', label: 'LNG', sector: 'gas', units: ['m3', 'mt', 'MMBtu'], defaultUnit: 'm3' },
  { id: 'lpg', label: 'LPG', sector: 'gas', units: ['mt', 'bbl', 'm3'], defaultUnit: 'mt' },
  { id: 'gold_dore', label: 'Gold dore', sector: 'mining', units: ['kg', 'oz', 't'], defaultUnit: 'kg' },
  { id: 'gold_bars', label: 'Gold bars', sector: 'mining', units: ['kg', 'oz'], defaultUnit: 'kg' },
  { id: 'copper_concentrate', label: 'Copper concentrate', sector: 'mining', units: ['mt', 'dmt'], defaultUnit: 'dmt' },
  { id: 'copper_cathode', label: 'Copper cathode', sector: 'mining', units: ['mt'], defaultUnit: 'mt' },
  { id: 'iron_ore', label: 'Iron ore', sector: 'mining', units: ['mt', 'dmt'], defaultUnit: 'mt' },
  { id: 'coal', label: 'Coal', sector: 'mining', units: ['mt'], defaultUnit: 'mt' },
  { id: 'sugar', label: 'Sugar', sector: 'agriculture', units: ['mt'], defaultUnit: 'mt' },
  { id: 'coffee', label: 'Coffee', sector: 'agriculture', units: ['mt', 'bags'], defaultUnit: 'mt' },
];

export const FALLBACK_DEAL_UNITS = ['mt', 'dmt', 'kg', 'oz', 'bbl', 'm3', 'MMBtu', 'bags'] as const;

function normalize(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function findDealProductOption(product: string | undefined): DealProductOption | undefined {
  const key = normalize(product);
  if (!key) return undefined;
  return DEAL_PRODUCT_OPTIONS.find(
    (option) => option.id === key || normalize(option.label) === key,
  );
}

export function unitsForDealProduct(product: string | undefined): string[] {
  return findDealProductOption(product)?.units ?? [...FALLBACK_DEAL_UNITS];
}

export function defaultUnitForDealProduct(product: string | undefined): string {
  return findDealProductOption(product)?.defaultUnit ?? 'mt';
}

export function unitFitsDealProduct(product: string | undefined, unit: string | undefined): boolean {
  const selectedUnit = String(unit ?? '').trim();
  if (!selectedUnit) return true;
  return unitsForDealProduct(product).includes(selectedUnit);
}
