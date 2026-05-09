import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
import { Badge } from './ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { ScrollArea } from './ui/scroll-area';

interface KanbanBoardProps {
  processedData: MiningLicense[];
  userAnnotations: Record<string, UserAnnotation>;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  commodities: string[];
  onCardClick: (item: MiningLicense) => void;
  isMobile: boolean;
}

const STAGES = ['New', 'Contacted', 'Diligence', 'Verified', 'Closed'];

export default function KanbanBoard({ processedData, userAnnotations, onCardClick, isMobile }: KanbanBoardProps) {
    const { t } = useI18n();
    const [activeStage, setActiveStage] = useState('New');

    const getStage = (id: string) => userAnnotations[id]?.stage || 'New';

    const columns = STAGES.reduce((acc, stage) => {
        acc[stage] = processedData.filter(item => getStage(item.id) === stage);
        return acc;
    }, {} as Record<string, MiningLicense[]>);

    const getStageColor = (stage: string) => {
        switch (stage) {
            case 'New': return 'bg-slate-500';
            case 'Contacted': return 'bg-blue-500';
            case 'Diligence': return 'bg-amber-500';
            case 'Verified': return 'bg-emerald-500';
            case 'Closed': return 'bg-slate-700';
            default: return 'bg-slate-500';
        }
    };

    const renderColumn = (stage: string) => (
        <div key={stage} className="flex flex-col h-full min-w-[280px] bg-slate-900/40 rounded-xl border border-slate-800/50">
            <div className="p-4 flex items-center justify-between border-b border-slate-800/50">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${getStageColor(stage)}`} />
                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
                        {t(stage, stage)}
                    </h3>
                </div>
                <Badge variant="secondary" className="bg-slate-800 text-slate-400 border-none px-2 py-0">
                    {columns[stage].length}
                </Badge>
            </div>

            <ScrollArea className="flex-1 p-3">
                <div className="space-y-3">
                    {columns[stage].map(item => {
                        const annotation = userAnnotations[item.id] || {};
                        const isGold = item.commodity?.toLowerCase().includes('gold') || annotation.commodity?.toLowerCase().includes('gold');

                        return (
                            <Card 
                                key={item.id}
                                className={`cursor-pointer border-slate-800 bg-slate-900/60 hover:bg-slate-800 transition-all hover:shadow-lg hover:-translate-y-1 group
                                ${isGold ? 'border-amber-900/30' : ''}`}
                                onClick={() => onCardClick(item)}
                            >
                                <CardContent className="p-4 space-y-3">
                                    <h4 className={`text-sm font-bold group-hover:text-amber-500 transition-colors ${isGold ? 'text-amber-400' : 'text-slate-200'}`}>
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
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                    {columns[stage].length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-700 opacity-50">
                            <div className="text-2xl mb-1">📭</div>
                            <p className="text-[10px] uppercase font-bold">{t("ריק", "Empty")}</p>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );

    return (
        <div className="h-full p-4 bg-slate-950 overflow-hidden">
            {isMobile ? (
                <Tabs value={activeStage} onValueChange={setActiveStage} className="h-full flex flex-col">
                    <TabsList className="bg-slate-900 border border-slate-800 p-1 h-12">
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
