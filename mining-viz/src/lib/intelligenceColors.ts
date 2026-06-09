/** Canonical sector colors for intelligence map layers (dark-map safe). */

export const INTELLIGENCE_COLORS = {
  oilGas: '#f59e0b',
  mining: '#8b5cf6',
  ports: '#06b6d4',
  vessels: '#14b8a6',
  supplierGood: '#22c55e',
  risk: '#ef4444',
  investigations: '#8b5cf6',
  clusterBase: '#3b82f6',
  clusterHotspot: '#06b6d4',
  borderDefault: '#06b6d4',
  borderFocus: '#f59e0b',
} as const;

export type IntelligenceSectorKey = keyof typeof INTELLIGENCE_COLORS;

export function sectorColorForEntityType(entityType: string): string {
  const t = entityType.toLowerCase();
  if (t.includes('supplier') || t.includes('buyer')) return INTELLIGENCE_COLORS.supplierGood;
  if (t.includes('port')) return INTELLIGENCE_COLORS.ports;
  if (t.includes('vessel') || t.includes('tanker')) return INTELLIGENCE_COLORS.vessels;
  if (t.includes('oil') || t.includes('gas') || t.includes('petroleum')) return INTELLIGENCE_COLORS.oilGas;
  if (t.includes('mine') || t.includes('mining')) return INTELLIGENCE_COLORS.mining;
  return INTELLIGENCE_COLORS.clusterBase;
}
