import { useMemo, useState } from 'react';
import { Building2, ExternalLink } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import type { PortAuthorityDirectory, PortAuthorityTenantCategory } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';

const CATEGORY_ORDER: PortAuthorityTenantCategory[] = [
  'tank_storage_and_refineries',
  'bunker_suppliers',
  'shipping_agents',
  'aggregate_exporters',
  'other',
];

interface PortAuthorityDirectoryPanelProps {
  directory: PortAuthorityDirectory;
}

export default function PortAuthorityDirectoryPanel({ directory }: PortAuthorityDirectoryPanelProps) {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState<PortAuthorityTenantCategory | 'all'>('all');

  const tenantsByCategory = useMemo(() => {
    const grouped: Record<string, typeof directory.tenants> = {};
    for (const tenant of directory.tenants) {
      const key = tenant.category || 'other';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(tenant);
    }
    return grouped;
  }, [directory.tenants]);

  const visibleTenants = useMemo(() => {
    if (activeCategory === 'all') return directory.tenants;
    return tenantsByCategory[activeCategory] || [];
  }, [activeCategory, directory.tenants, tenantsByCategory]);

  const categoryTabs = useMemo(() => {
    const tabs: Array<{ id: PortAuthorityTenantCategory | 'all'; label: string; count: number }> = [
      {
        id: 'all',
        label: t('הכל', 'All'),
        count: directory.tenants.length,
      },
    ];
    for (const id of CATEGORY_ORDER) {
      const count = tenantsByCategory[id]?.length ?? 0;
      if (count === 0) continue;
      const label =
        directory.categories?.find((c) => c.id === id)?.label ||
        id.replaceAll('_', ' ');
      tabs.push({ id, label, count });
    }
    return tabs;
  }, [directory, tenantsByCategory, t]);

  return (
    <Card className="bg-amber-500/5 border-amber-500/20 rounded-3xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Building2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h4 className="text-[11px] font-black uppercase tracking-widest text-amber-300">
            {t('לקוחות מרכזיים (רשות הנמל)', 'Major customers (port authority)')}
          </h4>
          <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
            {directory.disclaimer ||
              t(
                'רשימת לקוחות מדף הנמל הציבורי — לא אומתו קיבולת או בעלות.',
                'Public port authority customer list — not verified capacity or ownership.'
              )}
          </p>
          {directory.source_url && (
            <Button
              asChild
              variant="ghost"
              className="h-8 px-0 mt-2 text-[9px] font-black uppercase tracking-widest text-amber-400 hover:text-amber-300"
            >
              <a href={directory.source_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                {directory.port_authority_name || directory.port_name || directory.locode}
              </a>
            </Button>
          )}
        </div>
        <Badge className="bg-amber-500/15 text-amber-200 border-none text-[8px] font-black uppercase shrink-0">
          {directory.stats?.total_tenants ?? directory.tenants.length}{' '}
          {t('גורמים', 'tenants')}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {categoryTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveCategory(tab.id)}
            className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide transition-colors ${
              activeCategory === tab.id
                ? 'bg-amber-500/25 text-amber-100'
                : 'bg-black/20 text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      <ul className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
        {visibleTenants.map((tenant) => (
          <li
            key={`${tenant.category}-${tenant.name}`}
            className="rounded-2xl border border-white/5 bg-black/10 px-3 py-2.5 flex items-start justify-between gap-2"
          >
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-100 truncate">{tenant.name}</p>
              {tenant.role_note && (
                <p className="text-[9px] text-slate-500 mt-0.5">{tenant.role_note}</p>
              )}
              {tenant.curated_storage_external_id && (
                <p className="text-[8px] text-cyan-500/80 mt-1 uppercase tracking-wide">
                  {t('מקושר למסוף אחסון במפה', 'Linked storage hub on map')}
                </p>
              )}
            </div>
            <Badge className="bg-white/5 text-slate-400 border-none text-[7px] font-black uppercase shrink-0 max-w-[120px] truncate">
              {tenant.category_label || tenant.category}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
