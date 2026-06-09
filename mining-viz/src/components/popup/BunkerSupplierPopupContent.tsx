import { useI18n } from '../../lib/i18n';
import type { NearbySupplier } from '../../lib/nearbySuppliers';
import PetroleumMapPopup from './PetroleumMapPopup';
import BunkerSupplierDetailCard from './BunkerSupplierDetailCard';

type Props = {
  supplier: NearbySupplier;
  onOpenDossier?: () => void;
  onViewInRegistry?: () => void;
};

function formatGeocodeTier(tier?: string): string {
  if (!tier) return '';
  return tier.replace(/_/g, ' ');
}

export default function BunkerSupplierPopupContent({
  supplier,
  onOpenDossier,
  onViewInRegistry,
}: Props) {
  const { t } = useI18n();

  const badges = [
    {
      label: t('ספק בונקר', 'Bunker supplier'),
      className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
    },
    ...(supplier.geocode_tier
      ? [
          {
            label: formatGeocodeTier(supplier.geocode_tier),
            className: 'border-slate-500/30 text-slate-300',
          },
        ]
      : []),
  ];

  const actions = [];
  if (onViewInRegistry) {
    actions.push({
      label: t('צפה ברשם', 'View in registry'),
      onClick: onViewInRegistry,
    });
  }
  if (onOpenDossier) {
    actions.push({
      label: t('פתח תיק', 'Open dossier'),
      onClick: onOpenDossier,
      variant: 'outline' as const,
    });
  }

  const coverageFooter = [
    supplier.license_authority || t('רשם נמל', 'Port register'),
    supplier.geocode_disclaimer,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PetroleumMapPopup
      title={supplier.name}
      subtitle={
        supplier.port_locode
          ? `${supplier.port_locode}${supplier.country ? ` · ${supplier.country}` : ''}`
          : supplier.country
      }
      badges={badges}
      actions={actions}
      coverageFooter={coverageFooter || null}
    >
      <BunkerSupplierDetailCard supplier={supplier} compact />
    </PetroleumMapPopup>
  );
}
