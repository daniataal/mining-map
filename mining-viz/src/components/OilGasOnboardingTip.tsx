import { Droplets, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';

const STORAGE_KEY = 'mining-map:oil-gas-onboarding-dismissed';

export default function OilGasOnboardingTip({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    if (typeof window === 'undefined') return;
    setVisible(window.localStorage.getItem(STORAGE_KEY) !== '1');
  }, [active]);

  if (!visible) return null;

  const dismiss = () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  return (
    <div className="shrink-0 mx-3 mt-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-950 dark:text-amber-50 shadow-lg">
      <div className="flex items-start gap-3">
        <Droplets className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="font-black uppercase tracking-widest text-[9px] text-amber-700 dark:text-amber-200">
            {t('מדריך נפט וגז', 'Oil & gas quick start')}
          </p>
          <ul className="list-disc ps-4 space-y-1 font-semibold leading-snug">
            <li>
              {t(
                'הפעילו שכבת כלי שיט (AIS). אם המפרץ נראה ריק, הריצו maritime-worker ובדקו סטטוס סנכרון ב־Maritime Watch.',
                'Enable the vessel (AIS) layer. If the Gulf looks empty, run maritime-worker and check sync status in Maritime Watch.',
              )}
            </li>
            <li>
              {t(
                'במפה: שכבות מפעלי זיקוק + אזורי ESG; צינורות Mapbox דורשים MAPBOX_ACCESS_TOKEN בשרת.',
                'Map layers: refineries + ESG zones; Mapbox pipelines need MAPBOX_ACCESS_TOKEN on the backend.',
              )}
            </li>
            <li>
              {t(
                'מתכנן מסלול דורש API חי — ודאו שה-backend רץ.',
                'Route planner needs a live API — ensure the backend is running.',
              )}
            </li>
          </ul>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 opacity-70 hover:opacity-100"
          aria-label={t('סגור', 'Dismiss')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
