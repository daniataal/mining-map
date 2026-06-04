import type { StorageTerminalResponse } from '../types';

export function storageViewportCoverageGapMessage(
  response: StorageTerminalResponse | null | undefined,
): string | null {
  if (!response?.coverage_gap) return null;
  return (
    'No storage terminals in this map area — OpenStreetMap may be incomplete here. ' +
    'Curated hub gap-fill applies at major ports; pan to a known tank farm or check coverage report.'
  );
}
