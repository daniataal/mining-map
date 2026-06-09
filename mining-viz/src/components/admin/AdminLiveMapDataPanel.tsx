import { useCallback, useEffect, useState } from 'react';
import { Anchor, Database, Fuel, Map, RefreshCw, Ship, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../../lib/i18n';
import {
  fetchLiveMapAdminSnapshot,
  postAdminJob,
  type AdminJobResult,
  type LiveMapAdminSnapshot,
} from '../../lib/adminLiveMapOps';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';

type Props = {
  resolvedAdminToken: string;
  adminHeaders: () => HeadersInit;
};

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-black/5 p-3 dark:border-white/10">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="text-lg font-black text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function JobButton({
  label,
  busy,
  disabled,
  onClick,
  variant = 'outline',
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  variant?: 'outline' | 'default' | 'destructive';
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={disabled || busy}
      onClick={onClick}
      className="text-[9px] font-black uppercase tracking-widest"
    >
      {busy ? '…' : label}
    </Button>
  );
}

export default function AdminLiveMapDataPanel({
  resolvedAdminToken,
  adminHeaders,
}: Props) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<LiveMapAdminSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AdminJobResult | null>(null);
  const [rebuildSyntheticBol, setRebuildSyntheticBol] = useState(true);
  const [geocodeDryRun, setGeocodeDryRun] = useState(true);
  const [geocodeLimit, setGeocodeLimit] = useState('100');

  const tokenReady = Boolean(resolvedAdminToken?.trim());

  const refreshSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    try {
      setSnapshot(await fetchLiveMapAdminSnapshot());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSnapshot(false);
    }
  }, []);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  const runJob = useCallback(
    async (id: string, label: string, path: string, options?: { body?: unknown; query?: Record<string, string> }) => {
      if (!tokenReady) {
        toast.error(t('נדרש Admin API token בלשונית Open Data', 'Set Admin API token on the Open Data tab first.'));
        return;
      }
      setBusyJob(id);
      try {
        const payload = await postAdminJob(path, adminHeaders(), options);
        const result: AdminJobResult = {
          label,
          ok: true,
          at: new Date().toISOString(),
          payload,
        };
        setLastResult(result);
        toast.success(`${label} — ${t('הושלם', 'done')}`);
        await refreshSnapshot();
      } catch (err) {
        const result: AdminJobResult = {
          label,
          ok: false,
          at: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        };
        setLastResult(result);
        toast.error(result.error || label);
      } finally {
        setBusyJob(null);
      }
    },
    [adminHeaders, refreshSnapshot, t, tokenReady],
  );

  const oil = snapshot?.oilLive;
  const maritimeWorker = snapshot?.maritime?.worker as Record<string, unknown> | undefined;
  const maritimeStored = snapshot?.maritime?.stored as Record<string, unknown> | undefined;

  return (
    <div className="h-full space-y-6 overflow-y-auto p-6">
      {!tokenReady && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4 text-sm text-amber-900 dark:text-amber-100">
            {t(
              'רוב פעולות Live & Map דורשות Admin API token — הדביקו אותו בלשונית Open Data.',
              'Most Live & Map jobs need the Admin API token — paste it on the Open Data tab.',
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-black/5 dark:border-white/5">
        <CardHeader className="flex flex-row items-center justify-between border-b border-black/5 pb-4 dark:border-white/5">
          <CardTitle className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
            <Database className="h-4 w-4 text-amber-500" />
            {t('מצב Live & Map', 'Live & map status')}
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loadingSnapshot}
            onClick={() => void refreshSnapshot()}
            className="gap-1 text-[9px] font-black uppercase"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingSnapshot ? 'animate-spin' : ''}`} />
            {t('רענן', 'Refresh')}
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-4 md:grid-cols-4">
          <StatTile label={t('מסופים', 'Terminals')} value={oil?.terminal_count ?? '—'} />
          <StatTile label={t('מטען MCR', 'Cargo MCR')} value={oil?.cargo_record_count ?? '—'} />
          <StatTile
            label={t('מטען ייצור', 'Production cargo')}
            value={oil?.production_cargo_record_count ?? '—'}
          />
          <StatTile label={t('ספינות AIS', 'AIS vessels')} value={oil?.live_vessel_count ?? maritimeStored?.count ?? '—'} />
          <StatTile
            label={t('graph-sync אחרון', 'Last graph-sync')}
            value={
              oil?.last_graph_sync_at
                ? new Date(oil.last_graph_sync_at).toLocaleString()
                : t('מעולם לא', 'Never')
            }
          />
          <StatTile
            label={t('AIS worker', 'AIS worker')}
            value={String(maritimeWorker?.status ?? snapshot?.platform?.maritime_worker?.status ?? '—')}
          />
          <StatTile
            label={t('דמו MCR', 'Demo MCR')}
            value={oil?.demo_cargo_record_count ?? 0}
          />
          <StatTile
            label={t('Go intel', 'Go intel')}
            value={snapshot?.platform?.oil_live_intel?.ok ? t('פעיל', 'OK') : t('בדוק', 'Check')}
          />
        </CardContent>
      </Card>

      <Card className="border-black/5 dark:border-white/5">
        <CardHeader className="border-b border-black/5 pb-4 dark:border-white/5">
          <CardTitle className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
            <Ship className="h-4 w-4 text-sky-500" />
            {t('Oil live graph', 'Oil live graph')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <p className="text-[10px] leading-relaxed text-slate-500">
            {t(
              'ממזג מקורות חינמיים למסחר, מסופים, MCR סינתטי ומסדרונות מפה.',
              'Merges free sources into trade graph, terminals, synthetic MCR, and map corridors.',
            )}
          </p>
          <label className="flex items-center gap-2 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={rebuildSyntheticBol}
              onChange={(e) => setRebuildSyntheticBol(e.target.checked)}
            />
            {t('בנה מחדש synthetic BOL / MCR', 'Rebuild synthetic BOL / MCR')}
          </label>
          <div className="flex flex-wrap gap-2">
            <JobButton
              label={t('הפעל graph-sync', 'Run graph-sync')}
              busy={busyJob === 'graph-sync'}
              disabled={!tokenReady}
              variant="default"
              onClick={() =>
                void runJob('graph-sync', 'Graph-sync', '/api/admin/oil-live/graph-sync', {
                  query: { rebuild_synthetic_bol: rebuildSyntheticBol ? 'true' : 'false' },
                })
              }
            />
            <JobButton
              label={t('העשר אנשי קשר', 'Enrich contacts')}
              busy={busyJob === 'enrich-contacts'}
              disabled={!tokenReady}
              onClick={() =>
                void runJob('enrich-contacts', 'Contact enrichment', '/api/admin/oil-live/enrich-contacts', {
                  query: { limit: '50' },
                })
              }
            />
            <JobButton
              label={t('נקה seed דמו', 'Purge demo seed')}
              busy={busyJob === 'purge-demo'}
              disabled={!tokenReady}
              variant="destructive"
              onClick={() => {
                if (!window.confirm(t('למחוק נתוני דמו מ-MCR ו-port calls?', 'Delete demo MCR and port-call seed data?'))) {
                  return;
                }
                void runJob('purge-demo', 'Purge demo seed', '/api/admin/oil-live/purge-demo-seed');
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-black/5 dark:border-white/5">
        <CardHeader className="border-b border-black/5 pb-4 dark:border-white/5">
          <CardTitle className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
            <Fuel className="h-4 w-4 text-cyan-500" />
            {t('בונקר ותשתיות מפה', 'Bunker & map infrastructure')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-4">
          <JobButton
            label={t('סנכרון בונקר', 'Bunker sync')}
            busy={busyJob === 'bunker'}
            disabled={!tokenReady}
            onClick={() => void runJob('bunker', 'Bunker suppliers', '/api/admin/bunker-fuel-suppliers/sync')}
          />
          <JobButton
            label="OSM petroleum"
            busy={busyJob === 'osm-all'}
            disabled={!tokenReady}
            onClick={() => void runJob('osm-all', 'OSM petroleum', '/api/admin/petroleum-osm/sync')}
          />
          <JobButton
            label={t('OSM מ-gap queue', 'OSM gap queue')}
            busy={busyJob === 'osm-gap'}
            disabled={!tokenReady}
            onClick={() =>
              void runJob('osm-gap', 'OSM gap queue', '/api/admin/petroleum-osm/sync', {
                query: { from_gap_queue: 'true' },
              })
            }
          />
          <JobButton
            label={t('ביקורת אחסון', 'Storage audit')}
            busy={busyJob === 'storage-audit'}
            disabled={!tokenReady}
            onClick={() => void runJob('storage-audit', 'Storage coverage audit', '/api/admin/storage/coverage-audit')}
          />
        </CardContent>
      </Card>

      <Card className="border-black/5 dark:border-white/5">
        <CardHeader className="border-b border-black/5 pb-4 dark:border-white/5">
          <CardTitle className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
            <Map className="h-4 w-4 text-violet-500" />
            GEM ingest
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-4">
          {(
            [
              ['gem-tracker', 'GEM extraction tracker', '/api/admin/gem-extraction-tracker/ingest'],
              ['gem-pipelines', 'GEM oil pipelines', '/api/admin/gem-goit-pipelines/ingest'],
              ['gem-gas-pipes', 'GEM gas pipelines', '/api/admin/gem-ggit-gas-pipelines/ingest'],
              ['gem-plants', 'GEM plants', '/api/admin/gem-gogpt-plants/ingest'],
              ['gem-lng', 'GEM LNG', '/api/admin/gem-ggit-lng/ingest'],
            ] as const
          ).map(([id, label, path]) => (
            <JobButton
              key={id}
              label={label}
              busy={busyJob === id}
              disabled={!tokenReady}
              onClick={() => void runJob(id, label, path)}
            />
          ))}
        </CardContent>
      </Card>

      <Card className="border-black/5 dark:border-white/5">
        <CardHeader className="border-b border-black/5 pb-4 dark:border-white/5">
          <CardTitle className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
            <Anchor className="h-4 w-4 text-emerald-500" />
            {t('רישיונות כרייה לפי מדינה', 'Country mining sync')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-4">
          {(
            [
              ['pl-mining', 'Poland mining', '/api/admin/poland-mining/sync'],
              ['se-mining', 'Sweden mining', '/api/admin/sweden-mining/sync'],
              ['kz-mining', 'Kazakhstan mining', '/api/admin/kazakhstan-mining/sync'],
            ] as const
          ).map(([id, label, path]) => (
            <JobButton
              key={id}
              label={label}
              busy={busyJob === id}
              disabled={!tokenReady}
              onClick={() => void runJob(id, label, path)}
            />
          ))}
        </CardContent>
      </Card>

      <Card className="border-black/5 dark:border-white/5">
        <CardHeader className="border-b border-black/5 pb-4 dark:border-white/5">
          <CardTitle className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
            <Wrench className="h-4 w-4 text-amber-500" />
            {t('גיאוקוד רישיונות', 'License geocode backfill')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[10px] font-semibold">
              <input
                type="checkbox"
                checked={geocodeDryRun}
                onChange={(e) => setGeocodeDryRun(e.target.checked)}
              />
              {t('תצוגה מקדימה (dry-run)', 'Preview (dry-run)')}
            </label>
            <Input
              className="h-8 w-24 text-xs font-mono"
              value={geocodeLimit}
              onChange={(e) => setGeocodeLimit(e.target.value)}
              placeholder="100"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <JobButton
              label={geocodeDryRun ? t('תצוגה מקדימה', 'Preview batch') : t('הרץ backfill', 'Run backfill')}
              busy={busyJob === 'geocode'}
              disabled={!tokenReady}
              variant={geocodeDryRun ? 'outline' : 'default'}
              onClick={() =>
                void runJob('geocode', 'License geocode', '/api/admin/geocode-licenses', {
                  body: {
                    dry_run: geocodeDryRun,
                    limit: parseInt(geocodeLimit, 10) || 100,
                  },
                })
              }
            />
            <JobButton
              label={t('שחזר קואורדינטות', 'Revert geocode')}
              busy={busyJob === 'geocode-revert'}
              disabled={!tokenReady}
              variant="destructive"
              onClick={() => {
                if (!window.confirm(t('לשחזר קואורדינטות מקוריות?', 'Revert geocoded coordinates to originals?'))) {
                  return;
                }
                void runJob('geocode-revert', 'Geocode revert', '/api/admin/geocode-licenses/revert', {
                  body: { limit: 10000 },
                });
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-black/5 dark:border-white/5">
        <CardHeader className="border-b border-black/5 pb-4 dark:border-white/5">
          <CardTitle className="text-xs font-black uppercase tracking-widest">
            {t('Maritime AIS', 'Maritime AIS')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-4 text-[10px] text-slate-600 dark:text-slate-300">
          <p>
            <Badge variant="outline" className="mr-2 text-[8px] uppercase">
              {String(maritimeWorker?.status ?? 'unknown')}
            </Badge>
            {String(maritimeWorker?.source ?? 'AISStream')}
          </p>
          {maritimeWorker?.last_error != null && (
            <p className="text-red-500">{String(maritimeWorker.last_error)}</p>
          )}
          <p className="text-slate-500">
            {t(
              'לכידת AIS מנוהלת על ידי oil-live-intel-worker — אין כפתור הפעלה כאן. השתמשו ב-stats לעקוב אחר כיסוי.',
              'AIS ingest is owned by oil-live-intel-worker — no start button here. Use stats to monitor coverage.',
            )}
          </p>
          {Array.isArray(snapshot?.maritime?.limitations) && snapshot!.maritime!.limitations.length > 0 && (
            <ul className="list-disc pl-4 text-slate-500">
              {(snapshot.maritime!.limitations as string[]).slice(0, 4).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {lastResult && (
        <Card className="border-black/5 dark:border-white/5">
          <CardHeader className="border-b border-black/5 pb-3 dark:border-white/5">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest">
              {lastResult.ok ? t('תוצאה אחרונה', 'Last job result') : t('שגיאה אחרונה', 'Last job error')}:{' '}
              {lastResult.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <pre className="max-h-64 overflow-auto rounded-lg bg-black/5 p-3 text-[10px] font-mono dark:bg-white/5">
              {lastResult.ok
                ? JSON.stringify(lastResult.payload, null, 2)
                : lastResult.error}
            </pre>
          </CardContent>
        </Card>
      )}

      {oil?.graph_sync_steps && oil.graph_sync_steps.length > 0 && (
        <Card className="border-black/5 dark:border-white/5">
          <CardHeader className="border-b border-black/5 pb-3 dark:border-white/5">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest">
              {t('שלבי graph-sync אחרונים', 'Recent graph-sync steps')}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-48 space-y-1 overflow-y-auto pt-3 font-mono text-[10px]">
            {oil.graph_sync_steps.slice(0, 20).map((step) => (
              <div key={step.key} className="flex justify-between gap-2 border-b border-black/5 py-1 dark:border-white/5">
                <span>{step.key}</span>
                <span className={step.status === 'ok' || step.status === 'success' ? 'text-emerald-600' : 'text-amber-600'}>
                  {step.status}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
