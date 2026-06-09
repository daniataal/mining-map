import type { McrTierCount, OilLiveSyncStatus } from '../../api/oilLiveApi';

export type LiveDataSyncBannerKind =
  | 'loading'
  | 'unreachable'
  | 'demo_only'
  | 'degraded'
  | 'empty'
  | 'ok';

export type LiveDataSyncTierLine = {
  key: string;
  labelEn: string;
  labelHe: string;
  count: number | null;
  lastSyncLabel: string | null;
  stale?: boolean;
};

const DEMO_TIER_KEYS = new Set(['demo', 'seed', 'seed_port_calls']);

export function fmtLedgerCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function formatRelativeSyncAge(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return iso;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return '<1h';
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function sumMcrTiers(tiers: McrTierCount[] | undefined, match: (tier: string) => boolean): number {
  if (!tiers?.length) return 0;
  return tiers.reduce((sum, row) => (match(row.bol_tier) ? sum + row.count : sum), 0);
}

function isDemoTier(tier: string): boolean {
  const t = tier.trim().toLowerCase();
  return DEMO_TIER_KEYS.has(t) || t.includes('demo') || t.includes('seed');
}

export function mcrCountForTiers(
  tiers: McrTierCount[] | undefined,
  match: (tier: string) => boolean,
): number {
  return sumMcrTiers(tiers, match);
}

export function buildLiveDataSyncTierLines(sync: OilLiveSyncStatus): LiveDataSyncTierLine[] {
  const syntheticMcr = mcrCountForTiers(sync.mcr_by_tier, (t) => {
    const tier = t.trim().toLowerCase();
    return tier === 'synthetic' || tier === 'inferred';
  });
  const liveMcr = mcrCountForTiers(sync.mcr_by_tier, (t) => t.trim().toLowerCase() === 'live');
  const historicMcr = mcrCountForTiers(sync.mcr_by_tier, (t) => {
    const tier = t.trim().toLowerCase();
    return tier === 'historic' || tier === 'customs_open';
  });
  const macroMcr = mcrCountForTiers(sync.mcr_by_tier, (t) => t.trim().toLowerCase() === 'macro');

  const macroFlows = sync.oil_trade_flow_count ?? 0;
  const macroLast =
    formatRelativeSyncAge(sync.last_comtrade_sync_at) ??
    formatRelativeSyncAge(sync.last_eurostat_sync_at) ??
    formatRelativeSyncAge(sync.last_jodi_sync_at);

  const macroStale =
    (sync.last_comtrade_sync_status != null && sync.last_comtrade_sync_status !== 'ok') ||
    (sync.last_eurostat_sync_status != null && sync.last_eurostat_sync_status !== 'ok') ||
    (sync.last_jodi_sync_status != null && sync.last_jodi_sync_status !== 'ok');

  const customsOpenManifests = mcrCountForTiers(sync.manifest_by_tier, (t) => {
    const tier = t.trim().toLowerCase();
    return tier === 'customs_open' || tier === 'user_upload';
  });

  return [
    {
      key: 'live_ais',
      labelEn: 'Live AIS',
      labelHe: 'AIS חי',
      count: sync.live_vessel_count ?? null,
      lastSyncLabel: formatRelativeSyncAge(sync.last_vessel_observation_at),
      stale: (sync.live_vessel_count ?? 0) === 0,
    },
    {
      key: 'infrastructure',
      labelEn: 'Infrastructure (OSM)',
      labelHe: 'תשתית (OSM)',
      count: sync.terminal_count ?? null,
      lastSyncLabel: formatRelativeSyncAge(sync.last_graph_sync_at),
      stale: (sync.terminal_count ?? 0) === 0,
    },
    {
      key: 'production_mcr',
      labelEn: 'MCR (non-demo, incl. synthetic)',
      labelHe: 'MCR (לא דמו)',
      count:
        sync.production_cargo_record_count != null
          ? sync.production_cargo_record_count
          : syntheticMcr || sync.cargo_record_count || null,
      lastSyncLabel:
        formatRelativeSyncAge(sync.last_cargo_at) ?? formatRelativeSyncAge(sync.last_graph_sync_at),
      stale: (sync.production_cargo_record_count ?? sync.cargo_record_count ?? 0) === 0,
    },
    {
      key: 'customs_open',
      labelEn: 'Customs (open manifests)',
      labelHe: 'מכס פתוח',
      count:
        customsOpenManifests > 0
          ? customsOpenManifests
          : sync.trade_manifest_row_count != null && sync.trade_manifest_row_count > 0
            ? sync.trade_manifest_row_count
            : null,
      lastSyncLabel: formatRelativeSyncAge(sync.last_graph_sync_at),
      stale: (customsOpenManifests || sync.trade_manifest_row_count || 0) === 0,
    },
    {
      key: 'macro',
      labelEn: 'Macro trade',
      labelHe: 'מסחר מאקרו',
      count: macroFlows > 0 ? macroFlows : macroMcr || null,
      lastSyncLabel: macroLast,
      stale: macroFlows === 0 && macroStale,
    },
    {
      key: 'eia_historic',
      labelEn: 'EIA historic',
      labelHe: 'היסטורי EIA',
      count: sync.eia_historic_import_count ?? (historicMcr || null),
      lastSyncLabel: formatRelativeSyncAge(sync.last_graph_sync_at),
      stale: (sync.eia_historic_import_count ?? 0) === 0,
    },
    {
      key: 'live_mcr',
      labelEn: 'Live MCR',
      labelHe: 'MCR חי',
      count: liveMcr || sync.live_ais_port_call_count || null,
      lastSyncLabel: formatRelativeSyncAge(sync.last_vessel_observation_at),
      stale: (sync.live_ais_port_call_count ?? 0) === 0 && liveMcr === 0,
    },
  ].filter((line) => line.count != null || line.lastSyncLabel != null);
}

export function resolveLiveDataSyncBannerKind(
  sync: OilLiveSyncStatus | undefined,
  options: { unreachable: boolean; pending: boolean },
): LiveDataSyncBannerKind {
  if (options.pending) return 'loading';
  if (options.unreachable || !sync) return 'unreachable';

  const demoPort = sync.demo_port_call_count ?? 0;
  const demoCargo = sync.demo_cargo_record_count ?? 0;
  const demoMcr = mcrCountForTiers(sync.mcr_by_tier, isDemoTier);
  const demoTotal = demoPort + demoCargo + demoMcr;

  const productionSignals =
    (sync.live_vessel_count ?? 0) +
    (sync.production_cargo_record_count ?? sync.cargo_record_count ?? 0) +
    (sync.trade_manifest_row_count ?? 0) +
    (sync.terminal_count ?? 0) +
    (sync.oil_trade_flow_count ?? 0) +
    (sync.eia_historic_import_count ?? 0) +
    (sync.live_ais_port_call_count ?? 0);

  if (demoTotal > 0 && productionSignals === 0) return 'demo_only';

  const degraded =
    (sync.live_vessel_count ?? 0) === 0 ||
    (sync.production_cargo_record_count ?? sync.cargo_record_count ?? 0) === 0 ||
    (sync.terminal_count ?? 0) === 0;

  if (productionSignals === 0) return 'empty';
  if (degraded) return 'degraded';
  return 'ok';
}

export function liveDataSyncKindChipLabel(
  kind: LiveDataSyncBannerKind,
): { en: string; he: string } {
  switch (kind) {
    case 'loading':
      return { en: 'Loading…', he: 'טוען…' };
    case 'unreachable':
      return { en: 'Unreachable', he: 'לא נגיש' };
    case 'demo_only':
      return { en: 'Demo only', he: 'דמו בלבד' };
    case 'empty':
      return { en: 'Ledger empty', he: 'מאגר ריק' };
    case 'degraded':
      return { en: 'Sparse coverage', he: 'כיסוי דליל' };
    default:
      return { en: 'Data healthy', he: 'נתונים תקינים' };
  }
}

export type LiveDataSyncKindTone = 'ok' | 'warn' | 'bad' | 'neutral';

export function liveDataSyncKindTone(kind: LiveDataSyncBannerKind): LiveDataSyncKindTone {
  if (kind === 'unreachable' || kind === 'demo_only') return 'bad';
  if (kind === 'empty' || kind === 'degraded') return 'warn';
  if (kind === 'loading') return 'neutral';
  return 'ok';
}

export function shouldShowLiveDataWarningBanner(kind: LiveDataSyncBannerKind): boolean {
  return kind === 'unreachable' || kind === 'demo_only' || kind === 'empty';
}

export function liveDataSyncBannerMessage(
  kind: LiveDataSyncBannerKind,
): { en: string; he: string } | null {
  switch (kind) {
    case 'loading':
      return { en: 'Loading sync status…', he: 'טוען סטטוס סנכרון…' };
    case 'unreachable':
      return {
        en: 'Cannot reach oil-live-intel sync-status — check :8095 / Caddy :8080.',
        he: 'לא ניתן להגיע ל-sync-status — בדקו :8095 / Caddy :8080.',
      };
    case 'demo_only':
      return {
        en: 'Only demo/seed rows in ledger — production ingest disabled or not run.',
        he: 'רק שורות דמו/seed במאגר — ingest ייצורי כבוי או לא הורץ.',
      };
    case 'empty':
      return {
        en: 'Ledger empty — run graph-sync and oil-live-intel-worker.',
        he: 'מאגר ריק — הריצו graph-sync ו-oil-live-intel-worker.',
      };
    case 'degraded':
      return {
        en: 'Sparse coverage — some tiers empty or stale; counts below are honest.',
        he: 'כיסוי דליל — חלק מהשכבות ריקות; הספירות למטה כנות.',
      };
    default:
      return null;
  }
}
