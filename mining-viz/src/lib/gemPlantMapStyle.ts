import type { PathOptions } from 'leaflet';

export function gemPlantMarkerStyle(
  fuel: string | undefined,
  status: string | undefined,
  isDark: boolean,
): PathOptions {
  const fuelLower = (fuel || '').toLowerCase();
  const isGas = fuelLower.includes('gas') && !fuelLower.includes('oil');
  const inactive = [
    'proposed',
    'construction',
    'pre-construction',
    'announced',
    'shelved',
    'cancelled',
    'retired',
    'mothballed',
    'idle',
  ].some((s) => (status || '').toLowerCase().includes(s));

  const fill = isGas
    ? isDark
      ? '#c4b5fd'
      : '#7c3aed'
    : isDark
      ? '#fcd34d'
      : '#d97706';

  return {
    color: isDark ? '#1e293b' : '#ffffff',
    fillColor: fill,
    fillOpacity: inactive ? 0.55 : 0.88,
    weight: 1.5,
    radius: inactive ? 5 : 7,
  };
}
