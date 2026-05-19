import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useI18n } from '../lib/i18n';
import type { DealRoom, MiningLicense, UserAnnotation } from '../types';
import type { DdQueueEntry } from '../lib/dueDiligenceQueue';
import DueDiligencePanel from './DueDiligencePanel';
import DealRoomsListPanel from './DealRoomsListPanel';
import EuProcurementFacets from './EuProcurementFacets';

export type InvestigationsSubTab = 'due_diligence' | 'deal_rooms';

interface InvestigationsPanelProps {
  subTab: InvestigationsSubTab;
  onSubTabChange: (tab: InvestigationsSubTab) => void;
  allLicenses: MiningLicense[];
  queue: DdQueueEntry[];
  queueIds: Set<string>;
  notesById: Record<string, string>;
  userAnnotations: Record<string, UserAnnotation>;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  updateNote: (id: string, note: string) => void;
  onRemoveFromQueue: (id: string) => void;
  onCardClick: (item: MiningLicense) => void;
  onOpenMap?: () => void;
  isMobile?: boolean;
  dealRooms: DealRoom[];
  dealRoomsLoading?: boolean;
  highlightedDealRoomId?: string | null;
  onHighlightedDealRoomConsumed?: () => void;
  onDealRoomChange: (room: DealRoom) => void;
  onRefreshDealRooms: () => void;
}

export default function InvestigationsPanel({
  subTab,
  onSubTabChange,
  allLicenses,
  queue,
  queueIds,
  notesById,
  userAnnotations,
  updateAnnotation,
  updateNote,
  onRemoveFromQueue,
  onCardClick,
  onOpenMap,
  isMobile,
  dealRooms,
  dealRoomsLoading,
  highlightedDealRoomId,
  onHighlightedDealRoomConsumed,
  onDealRoomChange,
  onRefreshDealRooms,
}: InvestigationsPanelProps) {
  const { t } = useI18n();
  const [internalTab, setInternalTab] = useState<InvestigationsSubTab>(subTab);

  useEffect(() => {
    setInternalTab(subTab);
  }, [subTab]);

  const activeTab = internalTab;

  function selectTab(tab: InvestigationsSubTab) {
    setInternalTab(tab);
    onSubTabChange(tab);
  }

  return (
    <div className="flex flex-col h-full min-h-0 pt-20 sm:pt-24 bg-white dark:bg-slate-950">
      <div className="shrink-0 px-2 sm:px-4 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h1 className="text-lg sm:text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
            {t('חקירות', 'Investigations')}
          </h1>
          <div className="flex rounded-xl border border-black/10 dark:border-white/10 p-0.5 bg-black/[0.03] dark:bg-white/[0.03]">
            <button
              type="button"
              onClick={() => selectTab('due_diligence')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                activeTab === 'due_diligence'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {t('בדיקת נאותות', 'Due Diligence')}
              {queue.length > 0 && (
                <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-slate-950/20 dark:bg-white/20 text-[9px] font-black px-1">
                  {queue.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => selectTab('deal_rooms')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                activeTab === 'deal_rooms'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {t('חדרי עסקאות', 'Deal Rooms')}
              {dealRooms.length > 0 && (
                <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-slate-950/20 dark:bg-white/20 text-[9px] font-black px-1">
                  {dealRooms.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'due_diligence' ? (
          <motion.div className="h-full flex flex-col min-h-0">
            <motion.div className="flex-1 min-h-0 overflow-hidden">
              <DueDiligencePanel
                allLicenses={allLicenses}
                queue={queue}
                queueIds={queueIds}
                notesById={notesById}
                userAnnotations={userAnnotations}
                updateAnnotation={updateAnnotation}
                updateNote={updateNote}
                onRemoveFromQueue={onRemoveFromQueue}
                onCardClick={onCardClick}
                onOpenMap={onOpenMap}
                isMobile={isMobile}
                embedded
              />
            </motion.div>
            <motion.div className="shrink-0 p-4 border-t border-black/5 dark:border-white/5 max-h-[40vh] overflow-y-auto">
              <EuProcurementFacets />
            </motion.div>
          </motion.div>
        ) : (
          <DealRoomsListPanel
            rooms={dealRooms}
            allLicenses={allLicenses}
            isLoading={dealRoomsLoading}
            highlightedRoomId={highlightedDealRoomId}
            onHighlightedRoomConsumed={onHighlightedDealRoomConsumed}
            onRoomChange={onDealRoomChange}
            onRefresh={onRefreshDealRooms}
            onOpenEntity={onCardClick}
          />
        )}
      </div>
    </div>
  );
}
