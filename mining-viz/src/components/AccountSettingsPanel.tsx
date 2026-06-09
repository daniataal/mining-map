import { LogOut, User } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import ThemeToggle from './ThemeToggle';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  username: string | null;
  onLogout: () => void;
};

export default function AccountSettingsPanel({ isOpen, onClose, username, onLogout }: Props) {
  const { t } = useI18n();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-black/10 bg-white dark:border-white/10 dark:bg-slate-950">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white">
            {t('הגדרות חשבון', 'Account settings')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-black/5 bg-black/[0.02] px-4 py-3 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <User className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {t('מחובר כ', 'Signed in as')}
              </p>
              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                {username || t('משתמש', 'User')}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-black/5 px-4 py-3 dark:border-white/10">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('ערכת נושא', 'Theme')}
            </span>
            <ThemeToggle />
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
            {t(
              'משתמשים רגילים יכולים לחקור מפות, דוסייה וחקירות. ניהול משתמשים, סנכרון נתונים וכלי תפעול זמינים למנהלים בלבד.',
              'Standard users can explore maps, dossiers, and investigations. User management, data sync, and ops tools are admin-only.',
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-center gap-2 font-black uppercase tracking-widest"
            onClick={() => {
              onClose();
              onLogout();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t('התנתק', 'Log out')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
