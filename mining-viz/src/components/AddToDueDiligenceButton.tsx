import { ClipboardCheck, Plus, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';

interface AddToDueDiligenceButtonProps {
  isInQueue: boolean;
  onAdd: () => void;
  onRemove: () => void;
  className?: string;
  compact?: boolean;
}

export default function AddToDueDiligenceButton({
  isInQueue,
  onAdd,
  onRemove,
  className = '',
  compact = false,
}: AddToDueDiligenceButtonProps) {
  const { t } = useI18n();

  if (isInQueue) {
    return (
      <div className={`flex items-center gap-1.5 w-full ${className}`}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={`flex-1 h-9 text-[9px] font-black uppercase tracking-widest border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15 ${compact ? 'h-8' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <ClipboardCheck className="w-3.5 h-3.5 mr-1.5 shrink-0" />
          {t('בתור שלי', 'In your queue')}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title={t('הסר מתור', 'Remove from queue')}
          className={`shrink-0 h-9 w-9 text-slate-500 hover:text-red-500 hover:bg-red-500/10 ${compact ? 'h-8 w-8' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      className={`w-full h-9 text-[9px] font-black uppercase tracking-widest bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-lg shadow-amber-500/20 ${compact ? 'h-8' : ''} ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        onAdd();
      }}
    >
      <Plus className="w-3.5 h-3.5 mr-1.5 shrink-0" />
      {t('הוסף לבדיקת נאותות', 'Add to Due Diligence')}
    </Button>
  );
}
