import { ExternalLink } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { NearbySupplier } from '../../lib/nearbySuppliers';
import CompanyLeadButton from '../popup/CompanyLeadButton';
import type { MiningLicense } from '../../types';

type Props = {
  suppliers: NearbySupplier[];
  loading?: boolean;
  onOpenDossier?: (item: MiningLicense) => void;
};

export default function NearbySuppliersPanel({ suppliers, loading, onOpenDossier }: Props) {
  const { t } = useI18n();

  if (loading) {
    return (
      <p className="text-[10px] text-slate-400">
        {t('טוען ספקי דלק/בונקר…', 'Loading bunker/fuel suppliers…')}
      </p>
    );
  }

  if (suppliers.length === 0) return null;

  return (
    <div className="pointer-events-auto max-w-[min(360px,calc(100vw-2rem))] rounded-xl border border-cyan-500/25 bg-slate-950/90 px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-cyan-200/90">
        {t('ספקי דלק / בונקר (רשם רשמי)', 'Fuel & bunker suppliers (registry)')}
      </p>
      <ul className="max-h-40 space-y-1.5 overflow-y-auto">
        {suppliers.slice(0, 8).map((supplier) => (
          <li key={supplier.id} className="text-[11px] leading-snug">
            {onOpenDossier ? (
              <CompanyLeadButton
                name={supplier.name}
                country={supplier.country || ''}
                source="bunker_fuel_suppliers_curated"
                sourceLabel={supplier.license_authority || 'Port register'}
                onOpenDossier={onOpenDossier}
                className="text-cyan-100"
              />
            ) : (
              <span className="font-medium text-cyan-100">{supplier.name}</span>
            )}
            <span className="ml-1 text-[9px] text-slate-500">
              {Math.round((supplier.confidence ?? 0) * 100)}%
            </span>
            {supplier.fuels_supplied ? (
              <p className="text-[9px] text-slate-500">
                {t('דלקים', 'Fuels')}: {supplier.fuels_supplied}
              </p>
            ) : supplier.product_types && supplier.product_types.length > 0 ? (
              <p className="text-[9px] text-slate-500">{supplier.product_types.join(' · ')}</p>
            ) : null}
            {supplier.contact_person && (
              <p className="text-[9px] text-slate-400">
                {t('איש קשר', 'Contact')}: {supplier.contact_person}
              </p>
            )}
            {supplier.address && (
              <p className="text-[9px] leading-tight text-slate-500">{supplier.address}</p>
            )}
            {supplier.source_url && (
              <a
                href={supplier.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[9px] text-amber-400/90 hover:text-amber-300"
              >
                <ExternalLink className="h-3 w-3" />
                {t('מקור', 'Source')}
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[8px] leading-relaxed text-slate-500">
        {t(
          'רשימות נמל/רגולטור בלבד — לא טלפונים מומצאים.',
          'Port/regulator lists only — no fabricated phones.',
        )}
      </p>
    </div>
  );
}
