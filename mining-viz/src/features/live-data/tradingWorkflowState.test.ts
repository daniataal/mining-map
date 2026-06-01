import { describe, expect, it } from 'vitest';
import {
  buildTradingWorkflowSteps,
  deriveTradingWorkflowStepStatus,
  tradingWorkflowContextFromEntity,
} from './tradingWorkflowState';

describe('tradingWorkflowState', () => {
  it('discover is ready when entity id is set', () => {
    expect(
      deriveTradingWorkflowStepStatus('discover', {
        entityKind: 'terminal',
        entityId: 't1',
      }),
    ).toBe('ready');
    expect(
      deriveTradingWorkflowStepStatus('discover', {
        entityKind: 'terminal',
        entityId: '',
      }),
    ).toBe('empty');
  });

  it('execute stays empty in stub (no fake deals)', () => {
    expect(
      deriveTradingWorkflowStepStatus('execute', {
        entityKind: 'opportunity',
        entityId: 'o1',
        opportunityId: 'o1',
        hasEconomics: true,
      }),
    ).toBe('empty');
  });

  it('price ready only when opportunity context exists', () => {
    const ctx = tradingWorkflowContextFromEntity({
      entityKind: 'opportunity',
      entityId: 'opp-1',
    });
    expect(deriveTradingWorkflowStepStatus('price', ctx)).toBe('ready');
    expect(
      deriveTradingWorkflowStepStatus('price', {
        entityKind: 'vessel',
        entityId: '123',
      }),
    ).toBe('empty');
  });

  it('buildTradingWorkflowSteps returns four MAD-46 sections', () => {
    const steps = buildTradingWorkflowSteps({
      entityKind: 'company',
      entityId: 'c1',
    });
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.id)).toEqual(['discover', 'verify', 'price', 'execute']);
    expect(steps[0]?.status).toBe('ready');
    expect(steps[3]?.status).toBe('empty');
  });
});
