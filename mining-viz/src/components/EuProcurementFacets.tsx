import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useI18n } from '../lib/i18n';
import { API_BASE } from '../lib/api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type EuNotice = {
  notice_id: string;
  title?: string;
  buyer?: string;
  country?: string;
  cpv?: string;
  source_url?: string;
  published_at?: string;
};

type CpvBucket = { id: string; label: string };

type EuProcurementFacetsProps = {
  adminToken?: string;
  authHeaders?: () => Record<string, string>;
};

export default function EuProcurementFacets({ adminToken, authHeaders }: EuProcurementFacetsProps) {
  const { t } = useI18n();
  const [cpvBucket, setCpvBucket] = useState<string>('all');
  const [buckets, setBuckets] = useState<CpvBucket[]>([]);
  const [notices, setNotices] = useState<EuNotice[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const headers = useCallback((): Record<string, string> => {
    const base = authHeaders?.() ?? {};
    if (adminToken?.trim()) {
      return { ...base, 'X-Admin-Token': adminToken.trim() };
    }
    return base;
  }, [adminToken, authHeaders]);

  useEffect(() => {
    fetch(`${API_BASE}/api/eu-procurement/cpv-buckets`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.buckets)) {
          setBuckets(data.buckets.map((b: { id: string; label: string }) => ({ id: b.id, label: b.label })));
        }
      })
      .catch(() => setBuckets([]));
  }, []);

  const loadNotices = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '30' });
    if (cpvBucket !== 'all') params.set('cpv_bucket', cpvBucket);
    fetch(`${API_BASE}/api/eu-procurement/notices?${params}`)
      .then((r) => r.json())
      .then((data) => setNotices(Array.isArray(data?.notices) ? data.notices : []))
      .catch(() => setNotices([]))
      .finally(() => setLoading(false));
  }, [cpvBucket]);

  useEffect(() => {
    loadNotices();
  }, [loadNotices]);

  const triggerSync = async () => {
    if (!adminToken?.trim()) return;
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/api/admin/eu-procurement/sync`, {
        method: 'POST',
        headers: headers(),
      });
      await loadNotices();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 shadow-xl">
      <CardHeader className="flex flex-row items-center justify-between border-b border-black/5 dark:border-white/5 pb-4 gap-3 flex-wrap">
        <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
          {t('מכרזי EU (TED)', 'EU procurement (TED)')}
        </CardTitle>
        <motion.div className="flex items-center gap-2 flex-wrap">
          <Select value={cpvBucket} onValueChange={setCpvBucket}>
            <SelectTrigger className="h-8 w-[180px] text-[10px] font-bold">
              <SelectValue placeholder={t('סחורה CPV', 'CPV bucket')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('הכל', 'All buckets')}</SelectItem>
              {buckets.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" onClick={loadNotices} disabled={loading}>
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
              {syncing ? t('מסנכרן...', 'Syncing...') : t('סנכרן TED', 'Sync TED')}
            </Button>
          )}
        </motion.div>
      </CardHeader>
      <CardContent className="pt-4 space-y-2 max-h-[320px] overflow-y-auto">
        {notices.length === 0 && !loading && (
          <p className="text-[11px] text-slate-500">
            {t('אין מכרזים — הרץ סנכרון TED', 'No notices — run TED sync (admin token).')}
          </p>
        )}
        {notices.map((n) => (
          <motion.div
            key={n.notice_id}
            className="rounded-xl border border-black/5 dark:border-white/5 p-3 text-[10px] space-y-1"
          >
            <motion.div className="flex items-start justify-between gap-2">
              <p className="font-bold text-slate-800 dark:text-slate-200 leading-snug">{n.title || n.notice_id}</p>
              {n.country && (
                <Badge className="shrink-0 bg-sky-500/10 text-sky-600 border-none text-[8px]">{n.country}</Badge>
              )}
            </motion.div>
            {n.buyer && <p className="text-slate-500">{n.buyer}</p>}
            {n.cpv && <p className="font-mono text-slate-400">CPV {n.cpv}</p>}
            {n.source_url && (
              <a
                href={n.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 dark:text-amber-400 font-bold hover:underline"
              >
                TED
              </a>
            )}
          </motion.div>
        ))}
      </CardContent>
    </Card>
  );
}
