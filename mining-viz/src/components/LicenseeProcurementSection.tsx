import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useI18n } from '../lib/i18n';
import type { MiningLicense } from '../types';
import {
  getEuProcurement,
  getGovProcurement,
  type EuProcurementResponse,
} from '../lib/api';
import { describeGovProcurementLoadError } from '../lib/govProcurementErrors';
import type { GovProcurementAward, GovProcurementResponse } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

type LicenseeProcurementSectionProps = {
  item: MiningLicense;
  active: boolean;
  onNavigateToEuProcurement?: (cpvBucket: string) => void;
  onOpenInvestigations?: () => void;
};

function formatGovUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export default function LicenseeProcurementSection({
  item,
  active,
  onNavigateToEuProcurement,
  onOpenInvestigations,
}: LicenseeProcurementSectionProps) {
  const { t } = useI18n();
  const [govSearchQuery, setGovSearchQuery] = useState('');
  const [govFilterCategory, setGovFilterCategory] = useState('all');
  const [govProcurement, setGovProcurement] = useState<GovProcurementResponse | null>(null);
  const [isLoadingGovProcurement, setIsLoadingGovProcurement] = useState(false);
  const [govProcurementError, setGovProcurementError] = useState<string | null>(null);
  const [euProcurement, setEuProcurement] = useState<EuProcurementResponse | null>(null);
  const [isLoadingEuProcurement, setIsLoadingEuProcurement] = useState(false);
  const [euProcurementError, setEuProcurementError] = useState<string | null>(null);
  const [auditedContracts, setAuditedContracts] = useState<string[]>([]);

  useEffect(() => {
    let isCancelled = false;
    if (!active || !item) return () => { isCancelled = true; };

    setIsLoadingGovProcurement(true);
    setGovProcurementError(null);

    getGovProcurement(item.id, item.entityKind || 'license')
      .then((payload) => {
        if (!isCancelled) {
          setGovProcurement(payload);
          if ((payload.warnings?.length ?? 0) > 0 && (payload.awards?.length ?? 0) === 0) {
            setGovProcurementError(null);
          }
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setGovProcurement(null);
          setGovProcurementError(describeGovProcurementLoadError(err));
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingGovProcurement(false);
      });

    return () => { isCancelled = true; };
  }, [active, item.id, item.entityKind]);

  useEffect(() => {
    let isCancelled = false;
    if (!active || !item) return () => { isCancelled = true; };

    setIsLoadingEuProcurement(true);
    setEuProcurementError(null);

    getEuProcurement(item.id, item.entityKind || 'license')
      .then((payload) => {
        if (!isCancelled) setEuProcurement(payload);
      })
      .catch(() => {
        if (!isCancelled) {
          setEuProcurement(null);
          setEuProcurementError('Unable to load EU TED procurement matches.');
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingEuProcurement(false);
      });

    return () => { isCancelled = true; };
  }, [active, item.id, item.entityKind]);

  const govAwards = govProcurement?.awards ?? [];

  const filteredGovContracts = useMemo(() => {
    return govAwards.filter((c: GovProcurementAward) => {
      const matchesSearch =
        c.title.toLowerCase().includes(govSearchQuery.toLowerCase()) ||
        c.agency.toLowerCase().includes(govSearchQuery.toLowerCase()) ||
        c.id.toLowerCase().includes(govSearchQuery.toLowerCase()) ||
        c.commodity.toLowerCase().includes(govSearchQuery.toLowerCase());
      const matchesCategory = govFilterCategory === 'all' || c.category === govFilterCategory;
      return matchesSearch && matchesCategory;
    });
  }, [govAwards, govSearchQuery, govFilterCategory]);

  const govPortfolioPct = govProcurement?.summary?.portfolioByCategoryPct;
  const govTopCategoryLabel = useMemo(() => {
    if (!govPortfolioPct) return null;
    const entries = [
      { key: 'precious' as const, label: 'Precious Metals' },
      { key: 'fuels' as const, label: 'Fossil Fuels' },
      { key: 'strategic' as const, label: 'Strategic Minerals' },
      { key: 'other' as const, label: 'Other Federal' },
    ];
    const top = entries.reduce((best, entry) =>
      (govPortfolioPct[entry.key] ?? 0) > (govPortfolioPct[best.key] ?? 0) ? entry : best,
    );
    const pct = govPortfolioPct[top.key] ?? 0;
    return pct > 0 ? `${top.label}: ${pct}%` : null;
  }, [govPortfolioPct]);

  const hasUsData = (govProcurement?.awards?.length ?? 0) > 0;
  const hasEuData = (euProcurement?.notices?.length ?? 0) > 0;
  const showEmptyState =
    !isLoadingGovProcurement &&
    !isLoadingEuProcurement &&
    !hasUsData &&
    !hasEuData &&
    !govProcurementError;

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed">
        <p className="font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">
          {t('רכש לרישיון זה', 'Procurement for this license')}
        </p>
        <p>
          {t(
            'חוזים ומכרזים שמותאמים לחברת הרישיון — לא דפדוף גלובלי.',
            'Contracts and tenders matched to this licensee only. For global browse, open Investigations.',
          )}
        </p>
        {onOpenInvestigations && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-7 text-[9px] font-black uppercase"
            onClick={onOpenInvestigations}
          >
            {t('חקירות — מכרזים גלובליים', 'Investigations — global tenders')}
          </Button>
        )}
      </div>

      {(govProcurementError || (govProcurement?.warnings?.length ?? 0) > 0) && (
        <motion.div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] text-amber-700 dark:text-amber-300 space-y-1">
          {govProcurementError && <p className="font-bold">{govProcurementError}</p>}
          {govProcurement?.warnings?.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </motion.div>
      )}

      {isLoadingGovProcurement && (
        <p className="text-center text-xs font-bold text-slate-500 py-6">
          {t('טוען נתוני רכש ממשלתי…', 'Loading federal procurement data…')}
        </p>
      )}

      {!isLoadingGovProcurement && hasUsData && (
        <>
          <motion.div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] text-slate-600 dark:text-slate-300">
            <p className="font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">
              {t('מקור', 'Source')}: {govProcurement?.source || 'USAspending.gov'}
              {govProcurement?.dataOrigin
                ? ` (${govProcurement.dataOrigin === 'database' ? t('מסד נתונים', 'database') : t('חי', 'live')})`
                : ''}
            </p>
          </motion.div>

          <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white">
            {t('חוזים פדרליים (ארה״ב)', 'U.S. federal awards')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-slate-900/50 dark:bg-slate-950/50 border-black/10 dark:border-white/10 rounded-3xl p-6 shadow-lg flex flex-col justify-between min-h-[200px]">
              <div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                  {t('פרופיל נמען', 'RECIPIENT MATCH')}
                </span>
                <h4 className="text-md font-black text-slate-900 dark:text-white truncate uppercase">
                  {govProcurement?.recipientProfile?.name || item.company}
                </h4>
                <p className="text-[10px] text-slate-400 font-mono mt-2">
                  UEI: {govProcurement?.recipientProfile?.uei || '—'}
                </p>
              </div>
              <span className="text-[9px] font-black text-slate-500 uppercase mt-3">
                {govProcurement?.recipientProfile?.uei
                  ? t('נמצא ב-USAspending', 'USASPENDING MATCH')
                  : t('אין התאמה', 'NO FEDERAL MATCH')}
              </span>
            </Card>

            <Card className="bg-slate-900/50 dark:bg-slate-950/50 border-black/10 dark:border-white/10 rounded-3xl p-6 shadow-lg md:col-span-2">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">
                    {t('סך תקציב', 'TOTAL FUNDING')}
                  </span>
                  <p className="text-2xl font-black text-slate-900 dark:text-white">
                    {formatGovUsd(govProcurement?.summary?.totalAwardedUsd ?? 0)}
                  </p>
                </div>
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">
                    {t('חוזים פעילים', 'ACTIVE')}
                  </span>
                  <p className="text-2xl font-black text-slate-900 dark:text-white">
                    {govProcurement?.summary?.activeContractCount ?? 0}
                  </p>
                </div>
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">
                    {t('סוכנות', 'TOP AGENCY')}
                  </span>
                  <p className="text-sm font-black text-slate-900 dark:text-white truncate uppercase">
                    {govProcurement?.summary?.topFundingAgency || '—'}
                  </p>
                </div>
              </div>
              {govTopCategoryLabel && (
                <p className="text-[9px] text-amber-500 font-black uppercase mt-4">{govTopCategoryLabel}</p>
              )}
            </Card>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'all', label: 'All' },
                { id: 'precious', label: 'Precious' },
                { id: 'fuels', label: 'Fuels' },
                { id: 'strategic', label: 'Strategic' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setGovFilterCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all
                    ${govFilterCategory === cat.id
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-black/5 dark:bg-white/5 text-slate-500'}`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <Input
              type="text"
              placeholder={t('חיפוש חוזים…', 'Search awards…')}
              value={govSearchQuery}
              onChange={(e) => setGovSearchQuery(e.target.value)}
              className="h-9 w-full md:w-64 text-xs font-semibold bg-black/5 dark:bg-white/5 rounded-xl"
            />
          </div>

          <div className="space-y-4">
            {filteredGovContracts.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-8">
                {t('אין חוזים בתצוגה הנוכחית.', 'No awards match the current filters.')}
              </p>
            ) : (
              filteredGovContracts.map((contract) => (
                <Card
                  key={contract.id}
                  className="p-6 bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 rounded-3xl"
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="font-mono text-[8px]">{contract.id}</Badge>
                        <Badge className="text-[8px]">{contract.commodity.toUpperCase()}</Badge>
                      </div>
                      <h4 className="text-md font-black text-slate-900 dark:text-white uppercase">{contract.title}</h4>
                      <p className="text-[10px] text-slate-500">{contract.agency}</p>
                    </div>
                    <p className="text-xl font-black text-slate-950 dark:text-white shrink-0">
                      {formatGovUsd(contract.value ?? 0)} USD
                    </p>
                  </div>
                  {contract.sourceUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-4 h-8 text-[9px] font-black uppercase"
                      onClick={() => {
                        window.open(contract.sourceUrl!, '_blank', 'noopener,noreferrer');
                        if (!auditedContracts.includes(contract.id)) {
                          setAuditedContracts((prev) => [...prev, contract.id]);
                        }
                      }}
                    >
                      {auditedContracts.includes(contract.id)
                        ? t('נפתח', 'OPENED')
                        : t('פתח ב-USAspending', 'OPEN ON USASPENDING')}
                    </Button>
                  )}
                </Card>
              ))
            )}
          </div>
        </>
      )}

      <motion.div className="border-t border-black/10 dark:border-white/10 pt-8 space-y-4">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white">
          {t('מכרזי EU (TED)', 'EU procurement (TED)')}
        </h3>
        {(euProcurementError || (euProcurement?.warnings?.length ?? 0) > 0) && (
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-[10px] text-sky-700 dark:text-sky-300 space-y-1">
            {euProcurementError && <p className="font-bold">{euProcurementError}</p>}
            {euProcurement?.warnings?.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}
        {isLoadingEuProcurement && (
          <p className="text-center text-xs font-bold text-slate-500 py-4">
            {t('טוען מכרזי EU…', 'Loading EU tenders…')}
          </p>
        )}
        {!isLoadingEuProcurement && !hasEuData && !euProcurementError && (
          <p className="text-center text-xs text-slate-500 py-6 bg-black/5 dark:bg-white/5 rounded-2xl">
            {t('לא נמצאו מכרזי EU תואמים.', 'No matching EU TED notices for this company.')}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3">
          {(euProcurement?.notices ?? []).map((notice) => (
            <Card key={notice.notice_id} className="p-4 bg-black/5 dark:bg-white/5 rounded-2xl">
              <p className="text-sm font-bold text-slate-900 dark:text-white">{notice.title || notice.notice_id}</p>
              {notice.buyer && <p className="text-[10px] text-slate-500 mt-1">{notice.buyer}</p>}
              <motion.div className="flex flex-wrap gap-2 mt-2 items-center">
                {notice.country && (
                  <Badge className="bg-sky-500/10 text-sky-600 border-none text-[8px]">{notice.country}</Badge>
                )}
                {euProcurement?.cpvBucket && onNavigateToEuProcurement && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[8px] font-black uppercase ml-auto"
                    onClick={() => onNavigateToEuProcurement(euProcurement.cpvBucket!)}
                  >
                    {t('חקירות EU', 'EU browse in Investigations')}
                  </Button>
                )}
                {notice.source_url && (
                  <a
                    href={notice.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] font-bold text-amber-600 hover:underline"
                  >
                    TED
                  </a>
                )}
              </motion.div>
            </Card>
          ))}
        </div>
      </motion.div>

      {showEmptyState && (
        <p className="text-center text-sm text-slate-500 py-12 bg-black/5 dark:bg-white/5 rounded-3xl px-6">
          {t(
            'אין חוזים או מכרזים תואמים לרישיון זה.',
            'No U.S. federal awards or EU tenders matched to this licensee.',
          )}
        </p>
      )}
    </div>
  );
}
