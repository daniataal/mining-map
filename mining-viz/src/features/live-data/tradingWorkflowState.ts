import type { OilLiveEntityKind } from './OilLiveEntityDrawer';
import {
  TRADING_WORKFLOW_EMPTY_BY_STEP,
  TRADING_WORKFLOW_STEPS,
  type TradingWorkflowEmptyState,
  type TradingWorkflowStepId,
  type TradingWorkflowStepStatus,
} from './tradingWorkflowConfig';

export interface TradingWorkflowContext {
  entityKind: OilLiveEntityKind;
  entityId: string;
  opportunityId?: string;
  /** True when cargo/opportunity has evidence_chain or source URLs (future wiring). */
  hasEvidence?: boolean;
  /** True when deal pack / economics can load for this entity. */
  hasEconomics?: boolean;
}

export interface TradingWorkflowStepView {
  id: TradingWorkflowStepId;
  status: TradingWorkflowStepStatus;
  empty?: TradingWorkflowEmptyState;
  summaryEn?: string;
  summaryHe?: string;
}

export function deriveTradingWorkflowStepStatus(
  stepId: TradingWorkflowStepId,
  ctx: TradingWorkflowContext,
): TradingWorkflowStepStatus {
  switch (stepId) {
    case 'discover':
      return ctx.entityId ? 'ready' : 'empty';
    case 'verify':
      return ctx.hasEvidence ? 'ready' : 'empty';
    case 'price':
      return ctx.hasEconomics ? 'ready' : 'empty';
    case 'execute':
      return 'empty';
    default:
      return 'empty';
  }
}

export function buildTradingWorkflowSteps(ctx: TradingWorkflowContext): TradingWorkflowStepView[] {
  return TRADING_WORKFLOW_STEPS.map((step) => {
    const status = deriveTradingWorkflowStepStatus(step.id, ctx);
    const base: TradingWorkflowStepView = {
      id: step.id,
      status,
      empty: status === 'empty' ? TRADING_WORKFLOW_EMPTY_BY_STEP[step.id] : undefined,
    };
    if (step.id === 'discover' && status === 'ready') {
      base.summaryEn = `${ctx.entityKind} · ${ctx.entityId}`;
      base.summaryHe = `${ctx.entityKind} · ${ctx.entityId}`;
    }
    if (step.id === 'verify' && status === 'ready') {
      base.summaryEn = 'Evidence linked — open Verify tab in deal pack or MCR detail.';
      base.summaryHe = 'ראיות מקושרות — פתחו אימות בחבילת עסקה או פירוט MCR.';
    }
    if (step.id === 'price' && status === 'ready') {
      base.summaryEn = 'Deal pack economics available for this hypothesis.';
      base.summaryHe = 'כלכלה בחבילת עסקה זמינה להשערה זו.';
    }
    return base;
  });
}

export function tradingWorkflowHasOpportunityContext(ctx: TradingWorkflowContext): boolean {
  return Boolean(ctx.opportunityId) || ctx.entityKind === 'opportunity';
}

export function tradingWorkflowContextFromEntity(input: {
  entityKind: OilLiveEntityKind;
  entityId: string;
  opportunityId?: string;
  hasEvidence?: boolean;
}): TradingWorkflowContext {
  const opportunityId =
    input.opportunityId ?? (input.entityKind === 'opportunity' ? input.entityId : undefined);
  return {
    entityKind: input.entityKind,
    entityId: input.entityId,
    opportunityId,
    hasEvidence: input.hasEvidence,
    hasEconomics: tradingWorkflowHasOpportunityContext({
      entityKind: input.entityKind,
      entityId: input.entityId,
      opportunityId,
    }),
  };
}
