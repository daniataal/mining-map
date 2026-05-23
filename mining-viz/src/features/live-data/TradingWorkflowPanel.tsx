import { CheckCircle2, Circle, CircleDashed, Lock } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { TRADING_WORKFLOW_STEPS } from './tradingWorkflowConfig';
import {
  buildTradingWorkflowSteps,
  type TradingWorkflowContext,
} from './tradingWorkflowState';

export interface TradingWorkflowPanelProps {
  context: TradingWorkflowContext;
}

function StepIcon({ status }: { status: 'empty' | 'ready' | 'blocked' }) {
  if (status === 'ready') {
    return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden />;
  }
  if (status === 'blocked') {
    return <Lock className="w-4 h-4 text-amber-500 shrink-0" aria-hidden />;
  }
  return <CircleDashed className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />;
}

export default function TradingWorkflowPanel({ context }: TradingWorkflowPanelProps) {
  const { t } = useI18n();
  const steps = buildTradingWorkflowSteps(context);

  return (
    <div className="space-y-4" data-testid="trading-workflow-panel">
      <p className="text-[10px] text-slate-500 leading-relaxed">
        {t(
          'תהליך מסחר: גילוי → אימות → תמחור → ביצוע. אין נתוני דמו — רק מצבים ריקים כנים עד חיווט נתונים.',
          'Trading workflow: discover → verify → price → execute. No demo deals — honest empty states until data is wired.',
        )}
      </p>

      <ol className="space-y-3 list-none p-0 m-0">
        {steps.map((stepView, index) => {
          const def = TRADING_WORKFLOW_STEPS.find((s) => s.id === stepView.id)!;
          const isLast = index === steps.length - 1;
          return (
            <li key={stepView.id} className="relative pl-0">
              {!isLast && (
                <span
                  className="absolute left-[7px] top-6 bottom-0 w-px bg-slate-200 dark:bg-white/10"
                  aria-hidden
                />
              )}
              <section
                className="rounded-xl border border-black/5 dark:border-white/10 bg-white/80 dark:bg-white/5 p-3"
                aria-labelledby={`workflow-step-${stepView.id}`}
              >
                <div className="flex items-start gap-2">
                  <StepIcon status={stepView.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        id={`workflow-step-${stepView.id}`}
                        className="text-[10px] font-black uppercase tracking-widest text-sky-600 dark:text-sky-400"
                      >
                        {t(def.labelHe, def.labelEn)}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400">
                        {stepView.status === 'ready'
                          ? t('מוכן', 'ready')
                          : stepView.status === 'blocked'
                            ? t('חסום', 'blocked')
                            : t('ריק', 'empty')}
                      </span>
                    </div>
                    <h3 className="text-[11px] font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                      {t(def.headingHe, def.headingEn)}
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-1">{t(def.descriptionHe, def.descriptionEn)}</p>

                    {stepView.summaryEn && (
                      <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-200 mt-2 font-mono">
                        {t(stepView.summaryHe ?? stepView.summaryEn, stepView.summaryEn)}
                      </p>
                    )}

                    {stepView.empty && (
                      <div
                        className="mt-2 rounded-lg bg-amber-500/5 border border-amber-500/20 px-2.5 py-2"
                        role="status"
                      >
                        <p className="text-[10px] text-amber-900 dark:text-amber-100">
                          {t(stepView.empty.messageHe, stepView.empty.messageEn)}
                        </p>
                        {stepView.empty.actionEn && (
                          <p className="text-[9px] text-amber-700/90 dark:text-amber-200/80 mt-1 flex items-center gap-1">
                            <Circle className="w-2.5 h-2.5 shrink-0" aria-hidden />
                            {t(stepView.empty.actionHe ?? stepView.empty.actionEn, stepView.empty.actionEn)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
