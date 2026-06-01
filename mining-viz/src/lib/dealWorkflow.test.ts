import { describe, it, expect } from 'vitest';
import {
  DEAL_STAGES,
  normalizeDealStage,
  dealStageIndex,
  dealStageAtIndex,
  advanceDealStage,
  retreatDealStage,
  normalizeAnnotationStage,
  checklistStageWarning,
  APPROVED_STAGE_MIN_CHECKLIST_PCT,
} from './dealWorkflow';

describe('dealWorkflow', () => {
  it('keeps canonical stages', () => {
    expect(normalizeDealStage('Investigating')).toBe('Investigating');
    expect(DEAL_STAGES).toHaveLength(6);
  });

  it('maps legacy CRM stages', () => {
    expect(normalizeDealStage('Contacted')).toBe('Needs Review');
    expect(normalizeDealStage('Diligence')).toBe('Investigating');
    expect(normalizeDealStage('Verified')).toBe('Approved');
    expect(normalizeDealStage('Closed')).toBe('Rejected');
  });

  it('defaults unknown to New', () => {
    expect(normalizeDealStage(undefined)).toBe('New');
    expect(normalizeDealStage('')).toBe('New');
    expect(normalizeDealStage('bogus')).toBe('New');
  });

  it('dealStageIndex and dealStageAtIndex are in bounds', () => {
    expect(dealStageIndex('Approved')).toBe(4);
    expect(dealStageAtIndex(99)).toBe('Rejected');
    expect(dealStageAtIndex(-1)).toBe('New');
  });

  it('advance and retreat stages', () => {
    expect(advanceDealStage('New')).toBe('Needs Review');
    expect(advanceDealStage('Rejected')).toBeNull();
    expect(retreatDealStage('Investigating')).toBe('Needs Review');
    expect(retreatDealStage('New')).toBeNull();
  });

  it('normalizeAnnotationStage updates legacy stage', () => {
    expect(normalizeAnnotationStage({ stage: 'Diligence' })).toEqual({
      stage: 'Investigating',
    });
    expect(normalizeAnnotationStage({ stage: 'New' })).toEqual({ stage: 'New' });
  });

  it('warns on Approved with low checklist completion', () => {
    expect(checklistStageWarning('Approved', APPROVED_STAGE_MIN_CHECKLIST_PCT - 1)).toContain('Checklist');
    expect(checklistStageWarning('Approved', 100)).toBeNull();
  });
});
