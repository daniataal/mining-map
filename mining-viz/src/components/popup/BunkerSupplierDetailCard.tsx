import { ExternalLink, Mail, Phone } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { NearbySupplier } from '../../lib/nearbySuppliers';

type Props = {
  supplier: NearbySupplier;
  compact?: boolean;
};

function formatGeocodeTier(tier?: string): string {
  if (!tier) return '';
  return tier.replace(/_/g, ' ');
}

function DetailLine({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null;
  return (
    <p className="text-[11px] leading-snug text-slate-300">
      <span className="font-semibold text-slate-500">{label}: </span>
      {value}
    </p>
  );
}

export default function BunkerSupplierDetailCard({ supplier, compact = false }: Props) {
  const { t } = useI18n();
  const subtitle = [
    supplier.port_name || supplier.port_locode,
    supplier.country,
    supplier.license_authority,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div>
        <h3 className={`font-bold text-white ${compact ? 'text-sm' : 'text-base'}`}>
          {supplier.name}
        </h3>
        {subtitle && (
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">{subtitle}</p>
        )}
        {supplier.geocode_tier && (
          <p className="mt-1 inline-block rounded border border-slate-600/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-400">
            {formatGeocodeTier(supplier.geocode_tier)}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <DetailLine label={t('דלקים', 'Fuels')} value={supplier.fuels_supplied} />
        {supplier.product_types && supplier.product_types.length > 0 && (
          <DetailLine
            label={t('מוצרים', 'Products')}
            value={supplier.product_types.join(' · ')}
          />
        )}
        <DetailLine label={t('איש קשר', 'Contact')} value={supplier.contact_person} />
        {supplier.phone && (
          <p className="flex items-center gap-1 text-[11px] text-cyan-100">
            <Phone className="h-3 w-3 shrink-0 text-slate-500" />
            <a href={`tel:${supplier.phone.replace(/\s/g, '')}`} className="hover:underline">
              {supplier.phone}
            </a>
          </p>
        )}
        {supplier.email && (
          <p className="flex items-center gap-1 text-[11px] text-cyan-100">
            <Mail className="h-3 w-3 shrink-0 text-slate-500" />
            <a href={`mailto:${supplier.email}`} className="hover:underline">
              {supplier.email}
            </a>
          </p>
        )}
        <DetailLine label={t('כתובת', 'Address')} value={supplier.address} />
        {supplier.website && (
          <a
            href={supplier.website.startsWith('http') ? supplier.website : `https://${supplier.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            <ExternalLink className="h-3 w-3" />
            {t('אתר', 'Website')}
          </a>
        )}
        {supplier.source_url && (
          <a
            href={supplier.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 inline-flex items-center gap-0.5 text-[10px] text-amber-400 hover:text-amber-300"
          >
            <ExternalLink className="h-3 w-3" />
            {t('מקור רשמי', 'Official source')}
          </a>
        )}
      </div>

      {(supplier.geocode_disclaimer || supplier.confidence != null) && (
        <p className="text-[9px] leading-relaxed text-slate-500">
          {[
            supplier.confidence != null
              ? `${t('ביטחון', 'Confidence')}: ${Math.round(supplier.confidence * 100)}%`
              : null,
            supplier.geocode_disclaimer,
            t(
              'רשם נמל/רגולטור — אמת רישיון לפני עסקה.',
              'Port/regulator register — verify licence before execution.',
            ),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
