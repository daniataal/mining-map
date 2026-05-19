import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useI18n } from '../lib/i18n';
import { API_BASE, getGovProcurementCompanies } from '../lib/api';
import type { GovProcurementCompany } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

const COMMODITY_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'gold', label: 'Gold' },
  { id: 'silver', label: 'Silver' },
  { id: 'copper', label: 'Copper' },
  { id: 'oil', label: 'Oil' },
  { id: 'diesel', label: 'Diesel' },
  { id: 'gas', label: 'Gas' },
  { id: 'manganese', label: 'Mn' },
  { id: 'sulphur', label: 'Sulphur' },
] as const;

type GovProcurementFacetsProps = {
  adminToken?: string;
  authHeaders?: () => Record<string, string>;
};

function formatGovUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export default function GovProcurementFacets({ adminToken, authHeaders }: GovProcurementFacetsProps) {
  const { t } = useI18n();
  const [commodity, setCommodity] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [companies, setCompanies] = useState<GovProcurementCompany[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const base = authHeaders?.() ?? {};
    if (adminToken?.trim()) {
      return { ...base, 'X-Admin-Token': adminToken.trim() };
    }
    return base;
  }, [adminToken, authHeaders]);

  const loadCompanies = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getGovProcurementCompanies({
      commodity: commodity === 'all' ? undefined : commodity,
      matchLicenses: true,
      limit: 80,
    })
      .then((payload) => {
        setCompanies(payload.companies ?? []);
        setWarnings(payload.warnings ?? []);
        setCachedAt(payload.cachedAt ?? null);
      })
      .catch((err: unknown) => {
        setCompanies([]);
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 503) {
          setLoadError(
            t(
              'שירות הרכש עדיין מאתחל — נסה שוב בעוד רגע.',
              'Procurement service is still starting — try again shortly.',
            ),
          );
        } else {
          setLoadError(
            t('לא ניתן לטעון קבלנים פדרליים.', 'Unable to load U.S. federal contractor browse.'),
          );
        }
      })
      .finally(() => setLoading(false));
  }, [commodity, t]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const filteredCompanies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.uei || '').toLowerCase().includes(q) ||
        c.commodities.some((tag) => tag.toLowerCase().includes(q)) ||
        (c.topAgency || '').toLowerCase().includes(q),
    );
  }, [companies, searchQuery]);

  const triggerSync = async () => {
    if (!adminToken?.trim()) return;
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/api/admin/gov-procurement/sync`, {
        method: 'POST',
        headers: headers(),
      });
      await loadCompanies();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 shadow-xl">
      <CardHeader className="flex flex-col gap-3 border-b border-black/5 dark:border-white/5 pb-4">
        <div className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            {t('קבלנים פדרליים (USAspending)', 'U.S. federal contractors (USAspending)')}
          </CardTitle>
          <motion.div className="flex items-center gap-2 flex-wrap">
            <Button type="button" size="sm" variant="outline" onClick={loadCompanies} disabled={loading}>
              {loading ? t('טוען...', 'Loading...') : t('רענן', 'Refresh')}
            </Button>
            {adminToken?.trim() && (
              <Button
                type="button"
                size="sm"
                onClick={triggerSync}
                disabled={syncing}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black uppercase text-[10px]"
              >
                {syncing ? t('מסנכרן...', 'Syncing...') : t('סנכרן USAspending', 'Sync USAspending')}
              </Button>
            )}
          </motion.div>
        </div>
        <p className="text-[10px] text-slate-500 font-semibold leading-relaxed">
          {t(
            'דפדוף גלובלי בחוזים פדרליים לפי סחורה — לא קשור לרישיון ספציפי.',
            'Global browse of commodity-tagged U.S. federal contractors — not tied to a single license.',
          )}
        </p>
        <motion.div className="flex flex-wrap gap-1">
          {COMMODITY_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setCommodity(chip.id)}
              className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all
                ${commodity === chip.id
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-black/5 dark:bg-white/5 text-slate-500'}`}
            >
              {chip.label}
            </button>
          ))}
        </motion.div>
        <Input
          type="text"
          placeholder={t('חיפוש קבלן…', 'Search contractors…')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 text-xs font-semibold bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 rounded-xl"
        />
      </CardHeader>
      <CardContent className="pt-4 space-y-2 max-h-[320px] overflow-y-auto">
        {cachedAt && (
          <p className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">
            {t('מטמון', 'Cached')}: {new Date(cachedAt).toLocaleString()}
          </p>
        )}
        {loadError && <p className="text-[11px] font-bold text-red-500">{loadError}</p>}
        {!loadError &&
          warnings.map((warning) => (
            <p key={warning} className="text-[11px] text-amber-700 dark:text-amber-300">
              {warning}
            </p>
          ))}
        {filteredCompanies.length === 0 && !loading && !loadError && (
          <p className="text-[11px] text-slate-500">
            {t(
              'אין קבלנים במסד עדיין — הסנכרון האוטומטי ימלא נתונים.',
              'No contractors in the database yet — scheduled sync will populate data automatically.',
            )}
          </p>
        )}
        {filteredCompanies.map((company) => (
          <motion.div
            key={company.companyKey || company.name}
            className="rounded-xl border border-black/5 dark:border-white/5 p-3 text-[10px] space-y-1"
          >
            <motion.div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-slate-800 dark:text-slate-200 leading-snug">{company.name}</p>
                <p className="font-mono text-slate-400 text-[9px]">UEI: {company.uei || '—'}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {company.commodities.slice(0, 4).map((tag) => (
                    <Badge key={tag} className="text-[7px] font-black bg-amber-500/10 text-amber-600 border-amber-500/20">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-black text-slate-900 dark:text-white">{formatGovUsd(company.totalAwardedUsd)}</p>
                <p className="text-[8px] text-slate-400 uppercase font-bold">
                  {company.awardCount} awards
                </p>
              </div>
            </motion.div>
            {company.topAward?.sourceUrl && (
              <a
                href={company.topAward.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 dark:text-amber-400 font-bold hover:underline"
              >
                USAspending
              </a>
            )}
          </motion.div>
        ))}
      </CardContent>
    </Card>
  );
}
