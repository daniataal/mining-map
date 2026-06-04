import type { PathOptions } from 'leaflet';

/** Map GEM fuel_group to petroleum popup layer id for styling. */
export function gemFuelGroupToPopupLayerId(
  fuelGroup: string | undefined,
): 'oil_pipelines' | 'gas_pipelines' {
  if (fuelGroup === 'gas' || fuelGroup === 'ngl') return 'gas_pipelines';
  return 'oil_pipelines';
}

export function gemPipelineStyle(
  fuelGroup: string | undefined,
  status: string | undefined,
  isDark: boolean,
): PathOptions {
  const isGas = fuelGroup === 'gas' || fuelGroup === 'ngl';
  const inactive = [
    'proposed',
    'construction',
    'shelved',
    'cancelled',
    'retired',
    'idle',
    'mothballed',
  ].includes((status || '').toLowerCase());
  const base: PathOptions = isGas
    ? {
        color: isDark ? '#a78bfa' : '#7c3aed',
        weight: 2.8,
        opacity: 0.9,
        dashArray: inactive ? '8 6' : undefined,
        lineCap: 'round',
      }
    : {
        color: isDark ? '#fbbf24' : '#b45309',
        weight: 3,
        opacity: 0.92,
        dashArray: inactive ? '8 6' : undefined,
        lineCap: 'round',
      };
  return base;
}
