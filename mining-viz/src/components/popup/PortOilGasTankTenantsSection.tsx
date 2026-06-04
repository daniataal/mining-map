import { useMemo } from 'react';
import { Building2, ExternalLink } from 'lucide-react';
import { usePortAuthorityDirectory } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { resolvePortLocode } from '../../lib/portLocode';
import type { MiningLicense, PortAuthorityTenantCategory } from '../../types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

const TANK_CATEGORIES: PortAuthorityTenantCategory[] = [
  'tank_storage_and_refineries',
  'other',
];

interface PortOilGasTankTenantsSectionProps {
  item: MiningLicense;
}

export default function PortOilGasTankTenantsSection({ item }: PortOilGasTankTenantsSectionProps) {
  const { t } = useI18n();
  const locode = resolvePortLocode(item);
  const { data: directory, isLoading } = usePortAuthorityDirectory(locode ?? undefined, Boolean(locode));

  const tankTenants = useMemo(() => {
    if (!directory?.tenants?.length) return [];
    return directory.tenants.filter((tenant) =>
      TANK_CATEGORIES.includes(tenant.category as PortAuthorityTenantCategory),
    );
  }, [directory?.tenants]);

  if (!locode) return null;
  if (isLoading) {
    return (
      <p className="mt-4 text-[10px] text-slate-500">
        {t('טוען מפעילי מיכלים…', 'Loading tank operators…')}
      </p>
    );
  }
  if (!directory || tankTenants.length === 0) return null;

  return (
    <section className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-300">
            {t('מפעילי מיכלים ואחסון (רשות הנמל)', 'Tank & storage operators (port authority)')}
          </h4>
          <p className="text-[9px] text-slate-500 mt-1 leading-relaxed">
            {directory.disclaimer ||
              t(
                'רשימת לקוחות מדף הנמל — לא אומתו קיבולת או בעלות לכל מיכל.',
                'Public port customer list — per-tank capacity/ownership not verified.',
              )}
          </p>
          {directory.source_url && (
            <Button
              asChild
              variant="ghost"
              className="h-7 px-0 mt-1 text-[9px] font-bold uppercase text-amber-400 hover:text-amber-300"
            >
              <a href={directory.source_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3 h-3 mr-1" />
                {directory.port_authority_name || locode}
              </a>
            </Button>
          )}
        </div>
        <Badge className="bg-amber-500/15 text-amber-200 border-none text-[8px] font-black uppercase shrink-0">
          {tankTenants.length}
        </Badge>
      </div>
      <ul className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
        {tankTenants.map((tenant) => (
          <li
            key={`${tenant.category}-${tenant.name}`}
            className="rounded-lg border border-white/5 bg-black/10 px-2.5 py-2"
          >
            <p className="text-[11px] font-semibold text-slate-100">{tenant.name}</p>
            {(tenant.storage_operator || tenant.capacity_text) && (
              <p className="text-[9px] text-slate-400 mt-0.5 leading-snug">
                {tenant.storage_operator && (
                  <span>
                    {t('מפעיל', 'Operator')}: {tenant.storage_operator}
                  </span>
                )}
                {tenant.storage_operator && tenant.capacity_text ? ' · ' : null}
                {tenant.capacity_text && (
                  <span>
                    {t('קיבולת', 'Capacity')}: {tenant.capacity_text}
                  </span>
                )}
              </p>
            )}
            {tenant.role_note && (
              <p className="text-[9px] text-slate-500 mt-0.5">{tenant.role_note}</p>
            )}
            {tenant.curated_storage_external_id && (
              <p className="text-[8px] text-cyan-500/80 mt-1 uppercase tracking-wide">
                {t('סמן במפת אחסון Oil & Gas', 'Pin on Oil & Gas storage map')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
