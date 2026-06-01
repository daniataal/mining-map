import type { UserAnnotation } from '../types';
import { normalizeDealStage, type DealStage } from './dealWorkflow';

/** Deal-signal heat map status — green / active supplier marker. */
export const SUPPLIER_DEAL_SIGNAL_STATUS = 'good' as const;

/** Stages that remain visible on Suppliers map once Deal signal is green (Rejected is excluded). */
export const SUPPLIER_ACTIVE_STAGES: readonly DealStage[] = [
  'New',
  'Needs Review',
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
  return stage !== 'Rejected';
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
