import type { UserAnnotation } from '../types';
import { normalizeDealStage, type DealStage } from './dealWorkflow';

/** Deal-signal heat map status — green / active supplier marker. */
export const SUPPLIER_DEAL_SIGNAL_STATUS = 'good' as const;

/** Active pipeline stages shown on Suppliers map by default (excludes Rejected). */
export const SUPPLIER_ACTIVE_STAGES: readonly DealStage[] = [
  'Investigating',
  'Escalated',
  'Approved',
] as const;

export function isSupplierDealSignal(annotation: UserAnnotation | undefined): boolean {
  return (annotation?.status || '').toLowerCase() === SUPPLIER_DEAL_SIGNAL_STATUS;
}

export function matchesSuppliersPipeline(
  annotation: UserAnnotation | undefined,
  options: { showAll: boolean },
): boolean {
  if (options.showAll) return true;
  if (!isSupplierDealSignal(annotation)) return false;
  const stage = normalizeDealStage(annotation?.stage);
  if (stage === 'Rejected') return false;
  return (SUPPLIER_ACTIVE_STAGES as readonly string[]).includes(stage);
}

export function countSuppliersPipeline(
  licenseIds: string[],
  userAnnotations: Record<string, UserAnnotation>,
): { active: number; total: number } {
  let active = 0;
  for (const id of licenseIds) {
    if (matchesSuppliersPipeline(userAnnotations[id], { showAll: false })) active += 1;
  }
  return { active, total: licenseIds.length };
}
