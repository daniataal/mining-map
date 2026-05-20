/** Ghana + gold commodity scope for GoldBod license verification. */

export function isGhanaCountry(country?: string | null): boolean {
  const key = (country || '').trim().toLowerCase();
  if (!key) return false;
  if (key === 'gh' || key === 'gha' || key === 'ghana' || key === 'republic of ghana') return true;
  return key.includes('ghana');
}

export function isGoldCommodity(commodity?: string | null): boolean {
  const key = (commodity || '').trim().toLowerCase();
  if (!key) return false;
  return (
    key.includes('gold') ||
    key.includes('bullion') ||
    key.includes('precious metal') ||
    key.includes('dore') ||
    key.includes('doré')
  );
}

export function isGhanaGoldEntity(country?: string | null, commodity?: string | null): boolean {
  return isGhanaCountry(country) && isGoldCommodity(commodity);
}
