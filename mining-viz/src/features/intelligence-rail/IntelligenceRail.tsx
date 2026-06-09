import { LucidePanelRightClose, LucideSparkles } from 'lucide-react';
import type { MiningLicense } from '../../types';
import { useI18n } from '../../lib/i18n';
import type { NearbySupplier } from '../../lib/nearbySuppliers';
import BunkerSupplierDetailCard from '../../components/popup/BunkerSupplierDetailCard';
import { CountryIntelligencePanel } from './CountryIntelligencePanel';
import { CountrySanctionsSection } from './CountrySanctionsSection';

export type IntelligenceSelection =
  | { type: 'country'; country: string }
  | { type: 'cluster'; label: string; count: number }
  | { type: 'license'; item: MiningLicense }
  | { type: 'bunker_supplier'; supplier: NearbySupplier }
  | { type: 'workspace_entity'; entityId: string; displayName: string }
  | null;

type Props = {
  selection: IntelligenceSelection;
  onClose: () => void;
  onViewAssets?: (country: string) => void;
  onFindSuppliers?: (country: string) => void;
  onBuildDealPack?: (country: string) => void;
  onOpenLicenseList?: () => void;
};

export function IntelligenceRail({
  selection,
  onClose,
  onViewAssets,
  onFindSuppliers,
  onBuildDealPack,
  onOpenLicenseList,
}: Props) {
  const { t } = useI18n();

  return (
    <aside className="shrink-0 flex h-full min-h-0 w-[28rem] flex-col border-l border-black/10 bg-stone-100/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95">
        <div className="shrink-0 flex items-center justify-between px-4 py-4 border-b border-black/5 dark:border-white/5">
          <div className="flex items-center gap-2">
            <LucideSparkles className="w-5 h-5 text-amber-500" />
            <h2 className="text-sm font-black uppercase tracking-widest">
              {t('מסילת מודיעין', 'Intelligence')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-slate-500"
            aria-label={t('סגור', 'Close')}
          >
            <LucidePanelRightClose className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!selection && (
            <div className="text-center py-12 px-4">
              <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
                {t(
                  'בחר מדינה או נכס כדי לראות מודיעין',
                  'Select a country or asset to see intelligence',
                )}
              </p>
              <p className="text-xs text-slate-500 mt-2">
                {t(
                  'לחץ על בועת מדינה, רישיון או כלי שיט במפה',
                  'Click a country bubble, license, or vessel on the map',
                )}
              </p>
            </div>
          )}

          {selection?.type === 'country' && (
            <>
              <CountryIntelligencePanel
                country={selection.country}
                onViewAssets={onViewAssets}
                onFindSuppliers={onFindSuppliers}
                onBuildDealPack={onBuildDealPack}
              />
              <div className="mt-4">
                <CountrySanctionsSection country={selection.country} />
              </div>
            </>
          )}

          {selection?.type === 'cluster' && (
            <div className="space-y-3">
              <h3 className="text-lg font-black">{selection.label}</h3>
              <p className="text-sm text-slate-500">
                {selection.count.toLocaleString()} {t('רישיונות באשכול', 'licenses in cluster')}
              </p>
              <p className="text-xs text-slate-400">
                {t('התקרב לפרטים או לחץ שוב לזום', 'Zoom in for detail or click again to drill')}
              </p>
              {onOpenLicenseList && (
                <button
                  type="button"
                  onClick={onOpenLicenseList}
                  className="mt-2 w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-200 hover:bg-amber-500/20"
                >
                  {t('פתח רשימה בסרגל', 'Open list in sidebar')}
                </button>
              )}
            </div>
          )}

          {selection?.type === 'license' && (
            <div className="space-y-2">
              <h3 className="text-lg font-black truncate">{selection.item.company}</h3>
              <p className="text-xs text-slate-500 uppercase tracking-widest">
                {selection.item.country} · {selection.item.commodity ?? selection.item.sector}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('פתח תיק מלא לפרטי DD', 'Open full dossier for DD detail')}
              </p>
            </div>
          )}

          {selection?.type === 'bunker_supplier' && (
            <BunkerSupplierDetailCard supplier={selection.supplier} />
          )}

          {selection?.type === 'workspace_entity' && (
            <div className="space-y-2">
              <h3 className="text-lg font-black truncate">{selection.displayName}</h3>
              <p className="text-xs text-slate-500">
                {t('ישות בשרשרת אספקה', 'Supply chain workspace entity')}
              </p>
            </div>
          )}
        </div>
    </aside>
  );
}
