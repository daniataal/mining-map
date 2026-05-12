import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation, LeadValue } from '../types';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { ScrollArea } from './ui/scroll-area';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { getLicenseRenderKey } from '../lib/licenseRenderKey';

interface KanbanBoardProps {
  processedData: MiningLicense[];
  userAnnotations: Record<string, UserAnnotation>;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  onCardClick: (item: MiningLicense) => void;
  isMobile?: boolean;
}

const STAGES = ['New', 'Contacted', 'Diligence', 'Verified', 'Closed'] as const;
type Stage = typeof STAGES[number];

const STAGE_COLORS: Record<Stage, string> = {
  New: 'bg-slate-500',
  Contacted: 'bg-blue-500',
  Diligence: 'bg-amber-500',
  Verified: 'bg-emerald-500',
  Closed: 'bg-slate-700',
};

const STAGE_BADGE_COLORS: Record<Stage, string> = {
  New: 'bg-slate-500/20 text-slate-400',
  Contacted: 'bg-blue-500/20 text-blue-400',
  Diligence: 'bg-amber-500/20 text-amber-400',
  Verified: 'bg-emerald-500/20 text-emerald-400',
  Closed: 'bg-slate-700/40 text-slate-500',
};

export default function KanbanBoard({
  processedData,
  userAnnotations,
  updateAnnotation,
  onCardClick,
  isMobile,
}: KanbanBoardProps) {
  const { t } = useI18n();
  const [activeStage, setActiveStage] = useState<Stage>('New');

  const getStage = (id: string): Stage =>
    (userAnnotations[id]?.stage as Stage) || 'New';

  const columns = STAGES.reduce((acc, stage) => {
    acc[stage] = processedData.filter(item => getStage(item.id) === stage);
    return acc;
  }, {} as Record<Stage, MiningLicense[]>);

  const advanceStage = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const current = getStage(id);
    const idx = STAGES.indexOf(current);
    if (idx < STAGES.length - 1) {
      updateAnnotation(id, { stage: STAGES[idx + 1] });
    }
  };

  const retreatStage = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const current = getStage(id);
    const idx = STAGES.indexOf(current);
    if (idx > 0) {
      updateAnnotation(id, { stage: STAGES[idx - 1] });
    }
  };

  const renderColumn = (stage: Stage) => (
    <div key={stage} className="flex flex-col h-full min-w-[280px] bg-slate-100/40 dark:bg-slate-900/40 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
      <div className="p-4 flex items-center justify-between border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${STAGE_COLORS[stage]}`} />
          <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
            {t(stage, stage)}
          </h3>
        </div>
        <Badge variant="secondary" className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-none px-2 py-0">
          {columns[stage].length}
        </Badge>
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {columns[stage].map((item, index) => {
            const annotation = userAnnotations[item.id] || {};
            const isGold =
              item.commodity?.toLowerCase().includes('gold') ||
              annotation.commodity?.toLowerCase().includes('gold');
            const currentStage = getStage(item.id);
            const stageIdx = STAGES.indexOf(currentStage);

            return (
              <Card
                key={getLicenseRenderKey(item, index)}
                className={`cursor-pointer border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all hover:shadow-lg hover:-translate-y-1 group
                ${isGold ? 'border-amber-200/50 dark:border-amber-900/30' : ''}`}
                onClick={() => onCardClick(item)}
              >
                <CardContent className="p-4 space-y-3">
                  <h4
                    className={`text-sm font-bold group-hover:text-amber-500 transition-colors ${isGold ? 'text-amber-500 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}
                  >
                    {item.company}
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[9px] border-slate-700 text-slate-500 font-medium">
                      {annotation.commodity || item.commodity}
                    </Badge>
                    {annotation.status === 'good' && (
                      <Badge className="text-[9px] bg-emerald-500/20 text-emerald-500 border-none">GO</Badge>
                    )}
                    {annotation.verification?.siteVisit && (
                      <Badge className="text-[9px] bg-blue-500/20 text-blue-400 border-none">Visited</Badge>
                    )}
                    {annotation.leadValue && (
                      <Badge className={`text-[9px] border-none font-black ${
                        annotation.leadValue === 'high'
                          ? 'bg-emerald-500/20 text-emerald-500'
                          : annotation.leadValue === 'medium'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-slate-500/20 text-slate-400'
                      }`}>
                        {(annotation.leadValue as LeadValue).toUpperCase()}
                      </Badge>
                    )}
                  </div>
                  {/* Stage control row */}
                  <div className="flex items-center justify-between pt-1 border-t border-black/5 dark:border-white/5">
                    <button
                      onClick={e => retreatStage(e, item.id)}
                      disabled={stageIdx === 0}
                      className="p-1 rounded text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors"
                      title="Move to previous stage"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${STAGE_BADGE_COLORS[currentStage]}`}>
                      {currentStage}
                    </span>
                    <button
                      onClick={e => advanceStage(e, item.id)}
                      disabled={stageIdx === STAGES.length - 1}
                      className="p-1 rounded text-slate-600 hover:text-amber-400 disabled:opacity-20 transition-colors"
                      title="Advance to next stage"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {columns[stage].length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-700 opacity-50">
              <div className="text-2xl mb-1">📭</div>
              <p className="text-[10px] uppercase font-bold">{t('ריק', 'Empty')}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="h-full p-4 bg-white dark:bg-slate-950 overflow-hidden">
      {isMobile ? (
        <Tabs value={activeStage} onValueChange={v => setActiveStage(v as Stage)} className="h-full flex flex-col">
          <TabsList className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 h-12">
            {STAGES.map(stage => (
              <TabsTrigger
                key={stage}
                value={stage}
                className="flex-1 text-[10px] font-bold data-[state=active]:bg-amber-500 data-[state=active]:text-slate-950"
              >
                {stage}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex-1 mt-4 overflow-hidden">
            {STAGES.map(stage => (
              <TabsContent key={stage} value={stage} className="h-full m-0">
                {renderColumn(stage)}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      ) : (
        <div className="flex gap-4 h-full overflow-x-auto pb-4 custom-scrollbar">
          {STAGES.map(stage => renderColumn(stage))}
        </div>
      )}
    </div>
  );
}
