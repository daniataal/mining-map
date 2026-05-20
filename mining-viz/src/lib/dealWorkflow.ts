/** Canonical 6-stage deal workflow — single source of truth for dossier, Kanban, filters. */

export const DEAL_STAGES = [
  'New',
  'Needs Review',
  'Investigating',
  'Escalated',
  'Approved',
  'Rejected',
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const LIFECYCLE_STEPS: ReadonlyArray<{ id: DealStage; label: string }> = [
  { id: 'New', label: 'New' },
  { id: 'Needs Review', label: 'Needs Review' },
  { id: 'Investigating', label: 'Investigating' },
  { id: 'Escalated', label: 'Escalated' },
  { id: 'Approved', label: 'Approved' },
  { id: 'Rejected', label: 'Rejected' },
];

const LEGACY_STAGE_MAP: Record<string, DealStage> = {
  Contacted: 'Needs Review',
  Diligence: 'Investigating',
  Verified: 'Approved',
  Closed: 'Rejected',
};

export const STAGE_COLORS: Record<DealStage, string> = {
  New: 'bg-slate-500',
  'Needs Review': 'bg-blue-500',
  Investigating: 'bg-amber-500',
  Escalated: 'bg-red-500',
  Approved: 'bg-emerald-500',
  Rejected: 'bg-slate-700',
};

export const STAGE_BADGE_COLORS: Record<DealStage, string> = {
  New: 'bg-slate-500/20 text-slate-400',
  'Needs Review': 'bg-blue-500/20 text-blue-400',
  Investigating: 'bg-amber-500/20 text-amber-400',
  Escalated: 'bg-red-500/20 text-red-400',
  Approved: 'bg-emerald-500/20 text-emerald-400',
  Rejected: 'bg-slate-700/40 text-slate-500',
};

/** DD checklist item ids — when all checked, user may advance to Investigating. */
export const DD_CHECKLIST_IDS = ['dd-license', 'dd-site'] as const;

export function normalizeDealStage(raw: string | undefined | null): DealStage {
  if (!raw?.trim()) return 'New';
  const trimmed = raw.trim();
  if ((DEAL_STAGES as readonly string[]).includes(trimmed)) {
    return trimmed as DealStage;
  }
  return LEGACY_STAGE_MAP[trimmed] ?? 'New';
}

export function dealStageIndex(stage: string | undefined | null): number {
  return DEAL_STAGES.indexOf(normalizeDealStage(stage));
}

export function dealStageAtIndex(index: number): DealStage {
  const i = Math.max(0, Math.min(index, DEAL_STAGES.length - 1));
  return DEAL_STAGES[i];
}

export function advanceDealStage(stage: string | undefined | null): DealStage | null {
  const idx = dealStageIndex(stage);
  if (idx < 0 || idx >= DEAL_STAGES.length - 1) return null;
  return DEAL_STAGES[idx + 1];
}

export function retreatDealStage(stage: string | undefined | null): DealStage | null {
  const idx = dealStageIndex(stage);
  if (idx <= 0) return null;
  return DEAL_STAGES[idx - 1];
}

export function normalizeAnnotationStage<T extends { stage?: string }>(annotation: T): T {
  const normalized = normalizeDealStage(annotation.stage);
  if (annotation.stage === normalized) return annotation;
  return { ...annotation, stage: normalized };
}
