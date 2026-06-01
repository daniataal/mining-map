import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../lib/i18n';
import {
  getIntelligenceCards,
  getOilCompanies,
  getOilOpportunities,
  getOilOpportunityEconomics,
  saveOilOpportunityEconomics,
  getOilCompanyContacts,
  addOilCompanyContact,
  draftOilOutreach,
  getCargoRecords,
  getOilTerminals,
  getOilLiveSyncStatus,
  getOilLiveSourceHealth,
  enrichOilLiveContactsBatch,
  type OilContact,
  type OilDealEconomics,
  getOilWatchlists,
  deleteOilWatchlist,
  getOilAlerts,
  markOilAlertRead,
  markAllOilAlertsRead,
  assignOilAlert,
  type OilWatchlistItem,
  type OilAlert,
  connectOilLiveWebSocket,
  type OilOpportunity,
  type OilIntelligenceCard,
  type OilCompany,
  type MeridianCargoRecord,
  type OilLiveSourceHealth,
} from '../../api/oilLiveApi';
import { runContactEnrichmentAgent } from '../../lib/api';
import { toast } from 'sonner';
import {
  Radio,
  Building2,
  Ship,
  AlertTriangle,
  Bell,
  Package,
  Loader2,
  Download,
  CircleHelp,
  Search,
  Route,
  ExternalLink,
} from 'lucide-react';
import OilLiveProvenanceBadge from './OilLiveProvenanceBadge';
import GraphSyncEmptyCta from './GraphSyncEmptyCta';
import TradeManifestUploadPanel from './TradeManifestUploadPanel';
import CustomsOpenTierBadge from './CustomsOpenTierBadge';
import LiveDataCrisisDeskPanel from './LiveDataCrisisDeskPanel';
import LiveDataSearchBar, { type LiveDataSearchHitClick } from './LiveDataSearchBar';
import { dedupeOpportunities } from './dedupeOpportunities';
import { downloadCsv } from '../../lib/csvExport';
import {
  isOnWatchlist,
  opportunityWatchTarget,
  saveCompanyToSuppliers,
  terminalMatchesSearch,
  watchOpportunity,
} from './liveDataWorkflow';
import { usePlatformHealth } from '../../lib/platformHealth';
import { resolveLiveAisBanner } from './liveAisBanner';
import { coverageViewVsDbNote } from './coverageHealthNote';
import { firstVerifyUrl } from '../../lib/verifySourceUrl';
import CollapsibleSection from '../../components/ui/CollapsibleSection';
import { getTradeManifests } from '../../api/oilLiveApi';
import { canShowSeedDataToggle } from './liveDataDevFeatures';
import { buildRoutePlannerHintsFromOpportunity } from './liveDataRoutePrefill';
import {
  LIVE_DATA_LENS_COPY,
  LIVE_DATA_LENS_ORDER,
  type LiveDataLensMode,
} from './liveDataMapDefaults';

const DISCLAIMER_EN =
  'Inferred from public/free data only. Not a confirmed private transaction, buyer, seller, or cargo grade.';
const DISCLAIMER_HE = 'מסקנות מנתונים ציבוריים בלבד — לא עסקה, קונה, מוכר או סוג מוצר מאומתים.';

const BODY = 'text-sm leading-relaxed text-slate-800 dark:text-slate-200';
const MUTED = 'text-sm leading-relaxed text-slate-700 dark:text-slate-300';
const LABEL = 'text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400';
const CARD =
  'rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 shadow-sm';
const OPP_CARD =
  'rounded-xl border border-emerald-600/35 bg-emerald-50 dark:bg-slate-900 p-4 shadow-sm';
const BTN =
  'min-h-[36px] px-3 py-2 rounded-lg text-xs font-bold uppercase transition-colors';
const TAB_ACTIVE = 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900';
const TAB_IDLE =
  'bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 text-slate-600 dark:text-slate-300';

function ExpandableBulletList({
  items,
  limit = 3,
  className = MUTED,
}: {
  items: string[];
  limit?: number;
  className?: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const showAll = expanded || items.length <= limit;
  const visible = showAll ? items : items.slice(0, limit);
  return (
    <div>
      <ul className={`${className} list-disc pl-5 space-y-1`}>
        {visible.map((line, i) => (
          <li key={i} className={showAll ? '' : 'line-clamp-2'}>
            {line}
          </li>
        ))}
      </ul>
      {items.length > limit && (
        <button
          type="button"
          className="mt-1.5 text-xs font-bold text-sky-600 dark:text-sky-400"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? t('הצג פחות', 'Show less')
            : t(`הצג עוד (${items.length - limit})`, `Show more (${items.length - limit})`)}
        </button>
      )}
    </div>
  );
}

function percent(value: number | undefined, fallback = 0): number {
  return Math.round(((value ?? fallback) || 0) * 100);
}

function actionLabel(action: unknown): string {
  if (action && typeof action === 'object') {
    const label = (action as { label?: unknown }).label;
    if (typeof label === 'string' && label.trim()) return label;
  }
  return '';
}

function hintLabel(hint: unknown): string {
  if (!hint || typeof hint !== 'object') return '';
  const rec = hint as Record<string, unknown>;
  const role = typeof rec.role === 'string' ? rec.role : '';
  const name = typeof rec.name === 'string' ? rec.name : '';
  const country = typeof rec.country === 'string' ? rec.country : '';
  if (role && name) return `${role}: ${name}${country ? ` · ${country}` : ''}`;
  return [name, country].filter(Boolean).join(' · ');
}

type Tab = 'feed' | 'companies' | 'opportunities' | 'cargo' | 'alerts';

export type LiveDataIntelPanelProps = {
  productFilter: string;
  onProductFilterChange: (value: string) => void;
  terminalSearch: string;
  onTerminalSearchChange: (value: string) => void;
  coverageStats?: {
    terminals: number;
    vessels: number;
    opportunities: number;
    corridors: number;
  } | null;
  onOpenOpportunity?: (opportunityId: string, title?: string) => void;
  onOpenCargoRecord?: (record: MeridianCargoRecord) => void;
  onOpenCompanyDossier?: (companyId: string) => void;
  onOpenRoutePlanner?: (hints: Record<string, unknown>) => void;
  liveDataLens?: LiveDataLensMode;
  onLiveDataLensChange?: (lens: LiveDataLensMode) => void;
  /**
   * Dispatched when a user clicks a hit in the Elasticsearch-backed search
   * dropdown. The parent app reuses this for the existing entity-drawer
   * open flow (cargo → cargo drawer, terminal → terminal drawer, etc.).
   * When absent, the search bar falls back to the per-kind callbacks
   * above (cargo → onOpenCargoRecord, company → onOpenCompanyDossier).
   */
  onOpenLiveEntity?: (entity: {
    entityKind: 'cargo' | 'company' | 'terminal' | 'vessel' | 'manifest';
    entityId: string;
    title?: string;
    subtitle?: string;
  }) => void;
  /** Fly map to search hit coordinates before opening drawer. */
  onMapFlyTo?: (lat: number, lng: number) => void;
};

export default function LiveDataIntelPanel({
  productFilter,
  onProductFilterChange,
  terminalSearch,
  onTerminalSearchChange,
  coverageStats,
  onOpenOpportunity,
  onOpenCargoRecord,
  onOpenCompanyDossier,
  onOpenRoutePlanner,
  liveDataLens = 'deal',
  onLiveDataLensChange,
  onOpenLiveEntity,
  onMapFlyTo,
}: LiveDataIntelPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('opportunities');
  const [selectedCard, setSelectedCard] = useState<OilIntelligenceCard | null>(null);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [companyContacts, setCompanyContacts] = useState<Record<string, OilContact[]>>({});
  const [newContact, setNewContact] = useState({ type: 'phone', value: '' });
  const [expandedOpp, setExpandedOpp] = useState<string | null>(null);
  const [oppEconomics, setOppEconomics] = useState<Record<string, OilDealEconomics>>({});
  const [assignee, setAssignee] = useState('');
  const [cargoCountry, setCargoCountry] = useState('');
  const [cargoMinConfidence, setCargoMinConfidence] = useState('0.5');
  const [includeSeedData, setIncludeSeedData] = useState(false);
  const [cargoExporting, setCargoExporting] = useState(false);
  const [oppExporting, setOppExporting] = useState(false);
  const [watchingOppId, setWatchingOppId] = useState<string | null>(null);
  const [enrichContactsLoading, setEnrichContactsLoading] = useState(false);
  const [companyRoleFilter, setCompanyRoleFilter] = useState('');
  const [companyCountryFilter, setCompanyCountryFilter] = useState('');
  const [companyOffset, setCompanyOffset] = useState(0);
  const companyPageSize = 40;
  const [liveDataHelpOpen, setLiveDataHelpOpen] = useState(false);
  const [aisLive, setAisLive] = useState(false);
  const aisLiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dealSheet, setDealSheet] = useState({
    volume_bbl: '',
    buy_price_usd_per_bbl: '',
    sell_price_usd_per_bbl: '',
    freight_usd: '',
    storage_usd: '',
    other_costs_usd: '',
  });

  const queryClient = useQueryClient();
  const activeLensCopy = LIVE_DATA_LENS_COPY[liveDataLens];

  const { data: watchlistsData } = useQuery({
    queryKey: ['oil-live-watchlists'],
    queryFn: async () => (await getOilWatchlists()).watchlists,
    staleTime: 30_000,
  });

  const { data: alertsData, refetch: refetchAlerts } = useQuery({
    queryKey: ['oil-live-alerts'],
    queryFn: async () => (await getOilAlerts(false)).alerts,
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const unreadCount = (alertsData ?? []).filter((a) => !a.read_at).length;

  const { data: sourceHealthData } = useQuery({
    queryKey: ['oil-live-source-health'],
    queryFn: getOilLiveSourceHealth,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  useEffect(() => {
    const disconnect = connectOilLiveWebSocket((msg) => {
      if (msg.type === 'vessel_position') {
        setAisLive(true);
        if (aisLiveTimerRef.current) clearTimeout(aisLiveTimerRef.current);
        aisLiveTimerRef.current = setTimeout(() => setAisLive(false), 90_000);
        void queryClient.invalidateQueries({ queryKey: ['oil-live-map'] });
      }
      if (msg.type === 'intelligence_card_created') {
        void queryClient.invalidateQueries({ queryKey: ['oil-live-map'] });
        void queryClient.invalidateQueries({ queryKey: ['oil-live-intelligence'] });
      }
      if (msg.type === 'oil_alert') {
        void refetchAlerts();
        toast.info(t('התראה חדשה', 'New watchlist alert'));
      }
    });
    return () => {
      disconnect();
      if (aisLiveTimerRef.current) clearTimeout(aisLiveTimerRef.current);
    };
  }, [queryClient, refetchAlerts, t]);

  const { data: cardsData, isLoading } = useQuery({
    queryKey: ['oil-live-intelligence'],
    queryFn: async () => (await getIntelligenceCards()).cards,
    staleTime: 30_000,
  });

  const { data: opportunitiesData } = useQuery({
    queryKey: ['oil-live-opportunities', 0.55, productFilter],
    queryFn: async () =>
      (
        await getOilOpportunities(0.55, {
          commodity: productFilter === 'all' ? undefined : productFilter,
          min_deal_score: 0.45,
          limit: 80,
        })
      ).opportunities,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  const { data: companiesData } = useQuery({
    queryKey: ['oil-live-companies', productFilter, companyRoleFilter, companyCountryFilter, companyOffset, tab],
    queryFn: async () =>
      getOilCompanies({
        supplier_status: tab === 'companies' ? undefined : 'candidate',
        min_confidence: 0.5,
        role: companyRoleFilter.trim() || undefined,
        country: companyCountryFilter.trim() || undefined,
        limit: companyPageSize,
        offset: companyOffset,
      }),
    staleTime: 30_000,
  });

  const { data: terminalsIndex } = useQuery({
    queryKey: ['oil-live-terminals-index'],
    queryFn: async () => (await getOilTerminals()).terminals,
    staleTime: 120_000,
  });

  const {
    data: syncStatus,
    isError: syncStatusError,
    error: syncStatusErr,
    isPending: syncStatusPending,
  } = useQuery({
    queryKey: ['oil-live-sync-status'],
    queryFn: getOilLiveSyncStatus,
    staleTime: 45_000,
    refetchInterval: 120_000,
  });

  const syncStatusUnreachable = syncStatusError && !syncStatus;
  const syncStatusErrorMessage =
    syncStatusErr instanceof Error ? syncStatusErr.message : syncStatusErr ? String(syncStatusErr) : null;

  const cargoMinConfNum = parseFloat(cargoMinConfidence) || 0.5;
  const { data: cargoHealth } = useQuery({
    queryKey: ['oil-live-cargo-health', productFilter, includeSeedData],
    queryFn: () =>
      getCargoRecords({
        commodity: productFilter === 'all' ? undefined : productFilter,
        min_confidence: 0.5,
        exclude_seed: !includeSeedData,
        limit: 8,
      }),
    staleTime: 60_000,
  });
  const { data: cargoLedger, isLoading: cargoLoading } = useQuery({
    queryKey: ['oil-live-cargo-ledger', productFilter, cargoCountry, cargoMinConfNum, includeSeedData],
    queryFn: () =>
      getCargoRecords({
        commodity: productFilter === 'all' ? undefined : productFilter,
        country: cargoCountry.trim() || undefined,
        min_confidence: cargoMinConfNum,
        exclude_seed: !includeSeedData,
        limit: 60,
      }),
    enabled: tab === 'cargo',
    staleTime: 45_000,
  });

  const cards = cardsData ?? [];
  const companies = companiesData?.companies ?? [];
  const companiesTotal = companiesData?.total ?? companies.length;
  const opportunities = useMemo(
    () => dedupeOpportunities(opportunitiesData ?? [], 40, { excludeDemo: true }),
    [opportunitiesData],
  );
  const maritimeSourceHealth = useMemo<OilLiveSourceHealth[]>(
    () => (sourceHealthData?.sources ?? []).slice(0, 5),
    [sourceHealthData?.sources],
  );

  const { data: platformHealth } = usePlatformHealth(true);

  const liveAisBanner = useMemo(
    () =>
      resolveLiveAisBanner(syncStatus, {
        vesselsInView: coverageStats?.vessels ?? 0,
        platformHealth,
      }),
    [syncStatus, coverageStats?.vessels, platformHealth],
  );

  const terminalSearchMatches = useMemo(() => {
    const q = terminalSearch.trim();
    if (!q || !terminalsIndex?.length) return [];
    return terminalsIndex.filter((t) => terminalMatchesSearch(t, q)).slice(0, 8);
  }, [terminalsIndex, terminalSearch]);

  const filteredCards = useMemo(() => {
    if (productFilter === 'all') return cards;
    return cards.filter((c) => (c.product_family_inferred || '').includes(productFilter));
  }, [cards, productFilter]);

  const coverageViewNote = useMemo(() => {
    const dbVessels = syncStatus?.vessel_observation_count;
    const dbTerminals = syncStatus?.terminal_count ?? terminalsIndex?.length;
    if (typeof dbVessels !== 'number' || typeof dbTerminals !== 'number') return null;
    return coverageViewVsDbNote({
      inView: {
        terminals: coverageStats?.terminals ?? 0,
        vessels: coverageStats?.vessels ?? 0,
        corridors: coverageStats?.corridors ?? 0,
        opportunities: coverageStats?.opportunities ?? 0,
      },
      db: { vesselObservations: dbVessels, terminals: dbTerminals },
    });
  }, [syncStatus, terminalsIndex?.length, coverageStats]);

  const coverageInView = [
    { key: 'terminals', label: t('מסופים', 'Terminals'), value: coverageStats?.terminals ?? 0 },
    { key: 'vessels', label: t('מכליות', 'Tankers'), value: coverageStats?.vessels ?? 0 },
    {
      key: 'opportunities',
      label: t('רדאר עסקאות', 'Deal Radar'),
      value: coverageStats?.opportunities ?? 0,
    },
    {
      key: 'corridors',
      label: t('מסדרונות', 'Corridors'),
      value: coverageStats?.corridors ?? 0,
    },
  ] as const;

  const dbCountFallback = syncStatusUnreachable
    ? '—'
    : syncStatusPending
      ? '…'
      : '—';

  const coverageDatabase = [
    {
      key: 'vessel-observations',
      label: t('תצפיות כלי שיט', 'Vessel observations'),
      value: syncStatus?.vessel_observation_count ?? dbCountFallback,
    },
    {
      key: 'terminals-db',
      label: t('מסופים', 'Terminals'),
      value: syncStatus?.terminal_count ?? terminalsIndex?.length ?? dbCountFallback,
    },
    {
      key: 'port-calls',
      label: t('קריאות נמל', 'Port calls'),
      value: syncStatus?.port_call_count ?? dbCountFallback,
    },
    {
      key: 'cargo',
      label: t('מטען סינתטי', 'Synthetic cargo'),
      value: syncStatus?.cargo_record_count ?? dbCountFallback,
    },
    {
      key: 'macro-flows',
      label: t('זרימות מאקרו', 'Macro flows'),
      value: syncStatus?.oil_trade_flow_count ?? dbCountFallback,
    },
    {
      key: 'eurostat-macro',
      label: t('Eurostat (EU)', 'Eurostat (EU)'),
      value: syncStatus?.eurostat_trade_flow_count ?? dbCountFallback,
    },
    {
      key: 'jodi-macro',
      label: t('JODI (ספק/ביקוש)', 'JODI snapshots'),
      value: syncStatus?.jodi_snapshot_count ?? dbCountFallback,
    },
    {
      key: 'eia-historic',
      label: t('היסטורי EIA', 'EIA historic'),
      value: syncStatus?.eia_historic_import_count ?? dbCountFallback,
    },
    {
      key: 'coverage-gaps',
      label: t('אזורי חוסר AIS', 'AIS gap zones'),
      value: syncStatus?.coverage_gap_watch_zone_count ?? dbCountFallback,
    },
    {
      key: 'manifests',
      label: t('מניפסט פתוח (UK/מאקרו)', 'Open manifests (UK/macro)'),
      value: syncStatus?.trade_manifest_row_count ?? dbCountFallback,
    },
  ] as const;

  const customsOpenManifestCount = useMemo(() => {
    const tiers = syncStatus?.manifest_by_tier ?? [];
    const row = tiers.find((t) => t.bol_tier?.trim().toLowerCase() === 'customs_open');
    return row?.count ?? 0;
  }, [syncStatus?.manifest_by_tier]);

  const globalCoverageBanner = useMemo(() => {
    if (!syncStatus || syncStatusUnreachable) return null;
    const tiers = (syncStatus.mcr_by_tier ?? [])
      .map((t) => `${t.bol_tier}:${t.count}`)
      .join(' · ');
    const comtrade = syncStatus.last_comtrade_sync_at
      ? new Date(syncStatus.last_comtrade_sync_at).toLocaleDateString()
      : null;
    const eurostat = syncStatus.last_eurostat_sync_at
      ? new Date(syncStatus.last_eurostat_sync_at).toLocaleDateString()
      : null;
    const jodi = syncStatus.last_jodi_sync_at
      ? new Date(syncStatus.last_jodi_sync_at).toLocaleDateString()
      : null;
    const macroSources = (syncStatus.oil_trade_flows_by_source ?? [])
      .slice(0, 4)
      .map((s) => `${s.data_source}:${s.count}`)
      .join(' · ');
    return { tiers, comtrade, eurostat, jodi, macroSources };
  }, [syncStatus, syncStatusUnreachable]);

  const lastCargoSyncLabel = useMemo(() => {
    const ts =
      syncStatus?.last_cargo_at ??
      cargoHealth?.cargo_records?.[0]?.created_at ??
      cargoHealth?.cargo_records?.[0]?.event_date;
    if (!ts) return null;
    const diff = Date.now() - new Date(ts).getTime();
    if (!Number.isFinite(diff) || diff < 0) return ts;
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 1) return t('לפני פחות משעה', '<1h ago');
    if (hours < 48) return t(`לפני ${hours} שעות`, `${hours}h ago`);
    const days = Math.floor(hours / 24);
    return t(`לפני ${days} ימים`, `${days}d ago`);
  }, [syncStatus?.last_cargo_at, cargoHealth?.cargo_records, t]);

  const lastGraphSyncLabel = useMemo(() => {
    const ts = syncStatus?.last_graph_sync_at;
    if (!ts) return null;
    const diff = Date.now() - new Date(ts).getTime();
    if (!Number.isFinite(diff) || diff < 0) return ts;
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 1) return t('לפני פחות משעה', '<1h ago');
    if (hours < 48) return t(`לפני ${hours} שעות`, `${hours}h ago`);
    const days = Math.floor(hours / 24);
    return t(`לפני ${days} ימים`, `${days}d ago`);
  }, [syncStatus?.last_graph_sync_at, t]);

  async function handleBatchEnrichContacts() {
    setEnrichContactsLoading(true);
    try {
      const result = await enrichOilLiveContactsBatch(20);
      if (result.status === 'error') {
        toast.error(result.message ?? t('העשרת אנשי קשר נכשלה', 'Contact enrichment failed'));
        return;
      }
      toast.success(
        t(
          `הושלם: ${result.enriched ?? 0} מועשרים · ${result.candidates ?? 0} מועמדים · ${result.skipped ?? 0} דולגו`,
          `Done: ${result.enriched ?? 0} enriched · ${result.candidates ?? 0} candidates · ${result.skipped ?? 0} skipped`,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ['oil-live-companies'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('העשרת אנשי קשר נכשלה', 'Contact enrichment failed'));
    } finally {
      setEnrichContactsLoading(false);
    }
  }

  function openCargoRecord(record: MeridianCargoRecord) {
    if (onOpenCargoRecord) {
      onOpenCargoRecord(record);
      return;
    }
    toast.info(t('פתחו את המגירה מהמפה', 'Open the drawer from the map'));
  }

  function formatVolumeBand(r: MeridianCargoRecord): string {
    const unit = r.volume_unit ?? 'bbl';
    if (r.volume_low != null && r.volume_high != null) {
      return `${Math.round(r.volume_low).toLocaleString()}–${Math.round(r.volume_high).toLocaleString()} ${unit}`;
    }
    if (r.volume_best_estimate != null) {
      return `~${Math.round(r.volume_best_estimate).toLocaleString()} ${unit}`;
    }
    return '—';
  }

  async function exportCargoCsv() {
    setCargoExporting(true);
    try {
      const data = await getCargoRecords({
        commodity: productFilter === 'all' ? undefined : productFilter,
        country: cargoCountry.trim() || undefined,
        min_confidence: cargoMinConfNum,
        exclude_seed: !includeSeedData,
        limit: 5000,
      });
      const records = data.cargo_records ?? [];
      if (records.length === 0) {
        toast.info(t('אין רשומות לייצוא', 'No cargo records to export'));
        return;
      }
      const headers = [
        'id',
        'synthetic_bol_id',
        'commodity_family',
        'confidence',
        'triangulation_score',
        'bol_tier',
        'shipper_name',
        'consignee_name',
        'vessel_name',
        'mmsi',
        'load_port_name',
        'load_country',
        'discharge_hint',
        'discharge_country',
        'volume_best_estimate',
        'volume_unit',
        'event_date',
        'recipe',
      ];
      const rows = records.map((r) => [
        r.id,
        r.synthetic_bol_id ?? '',
        r.commodity_family ?? '',
        r.confidence != null ? String(r.confidence) : '',
        r.triangulation_score != null ? String(r.triangulation_score) : '',
        r.bol_tier ?? '',
        r.shipper_name ?? '',
        r.consignee_name ?? '',
        r.vessel_name ?? '',
        r.mmsi != null ? String(r.mmsi) : '',
        r.load_port_name ?? '',
        r.load_country ?? '',
        r.discharge_hint ?? '',
        r.discharge_country ?? '',
        r.volume_best_estimate != null ? String(r.volume_best_estimate) : '',
        r.volume_unit ?? '',
        r.event_date ?? '',
        r.recipe ?? '',
      ]);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`meridian-cargo-records-${stamp}.csv`, headers, rows);
      toast.success(t('יוצא CSV', 'CSV exported'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setCargoExporting(false);
    }
  }

  async function exportAuditBundle() {
    setCargoExporting(true);
    try {
      const [cargoRes, manifestRes] = await Promise.all([
        getCargoRecords({
          commodity: productFilter === 'all' ? undefined : productFilter,
          min_confidence: cargoMinConfNum,
          exclude_seed: !includeSeedData,
          limit: 2000,
        }),
        getTradeManifests({ limit: 500 }),
      ]);
      const cargo = cargoRes.cargo_records ?? [];
      const manifests = manifestRes.manifests ?? [];
      if (cargo.length === 0 && manifests.length === 0) {
        toast.info(t('אין נתונים לייצוא', 'Nothing to export'));
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      if (cargo.length > 0) {
        downloadCsv(
          `meridian-audit-cargo-${stamp}.csv`,
          ['id', 'bol_tier', 'shipper_name', 'consignee_name', 'commodity_family', 'event_date'],
          cargo.map((r) => [
            r.id,
            r.bol_tier ?? '',
            r.shipper_name ?? '',
            r.consignee_name ?? '',
            r.commodity_family ?? '',
            r.event_date ?? '',
          ]),
        );
      }
      if (manifests.length > 0) {
        downloadCsv(
          `meridian-audit-manifests-${stamp}.csv`,
          [
            'id',
            'bol_tier',
            'importer_name',
            'exporter_name',
            'partner_country',
            'hs_code',
            'source_record_url',
          ],
          manifests.map((m) => [
            m.id,
            m.bol_tier ?? '',
            m.importer_name ?? '',
            m.exporter_name ?? '',
            m.partner_country ?? '',
            m.hs_code ?? '',
            m.source_record_url ?? '',
          ]),
        );
      }
      toast.success(t('יוצא חבילת ביקורת (2 CSV)', 'Audit bundle exported (2 CSV files)'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setCargoExporting(false);
    }
  }

  async function handleWatchOpp(opp: OilOpportunity) {
    setWatchingOppId(opp.id);
    try {
      const { already } = await watchOpportunity(opp, watchlistsData ?? []);
      if (already) {
        toast.info(t('כבר ברשימת מעקב', 'Already on watchlist'));
      } else {
        toast.success(t('נוסף לרשימת מעקב', 'Added to watchlist'));
        void queryClient.invalidateQueries({ queryKey: ['oil-live-watchlists'] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Watch failed');
    } finally {
      setWatchingOppId(null);
    }
  }

  async function exportOpportunitiesCsv() {
    setOppExporting(true);
    try {
      if (opportunities.length === 0) {
        toast.info(t('אין הזדמנויות לייצוא', 'No opportunities to export'));
        return;
      }
      const headers = [
        'id',
        'title',
        'opportunity_type',
        'confidence',
        'deal_score',
        'source_tiers',
        'signal_kind',
        'hypothesis',
        'terminal_id',
        'terminal_name',
        'terminal_country',
      ];
      const rows = opportunities.map((o) => [
        o.id,
        o.title ?? '',
        o.opportunity_type ?? '',
        o.confidence != null ? String(o.confidence) : '',
        o.deal_score != null ? String(o.deal_score) : '',
        o.source_tiers?.join('|') ?? '',
        o.signal_kind ?? '',
        o.hypothesis ?? '',
        o.terminal_id ?? '',
        o.terminal_name ?? '',
        o.terminal_country ?? '',
      ]);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`meridian-opportunities-${stamp}.csv`, headers, rows);
      toast.success(t('יוצא CSV', 'CSV exported'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setOppExporting(false);
    }
  }

  const handleSearchHit = useCallback(
    (hit: LiveDataSearchHitClick) => {
      if (hit.lat != null && hit.lng != null && onMapFlyTo) {
        onMapFlyTo(hit.lat, hit.lng);
      }
      if (onOpenLiveEntity) {
        onOpenLiveEntity({
          entityKind: hit.type,
          entityId: hit.id,
          title: hit.title,
          subtitle: hit.subtitle,
        });
        return;
      }
      // Fallback to per-kind callbacks when the parent doesn't pass the
      // unified handler. cargo / company are the two we have today.
      if (hit.type === 'cargo' && onOpenCargoRecord) {
        onOpenCargoRecord({ id: hit.id } as MeridianCargoRecord);
        return;
      }
      if (hit.type === 'company' && onOpenCompanyDossier) {
        onOpenCompanyDossier(hit.id);
        return;
      }
      if (hit.type === 'manifest') {
        if (!onOpenLiveEntity) {
          if (hit.source_record_url) {
            window.open(hit.source_record_url, '_blank', 'noopener,noreferrer');
          }
          toast.info(
            `${hit.title}${hit.bol_tier ? ` (${hit.bol_tier})` : ''} — ${t('אמת במקור', 'Verify at source')}`,
          );
        }
        return;
      }
      // Terminal / vessel without a parent handler: surface a tip so the
      // user knows the click registered but the drawer isn't wired here.
      toast.info(t('פתחו את המגירה מהמפה', 'Open the drawer from the map'));
    },
    [onOpenLiveEntity, onOpenCargoRecord, onOpenCompanyDossier, onMapFlyTo, t],
  );

  async function handleSave(company: OilCompany) {
    try {
      const result = await saveCompanyToSuppliers(company.id);
      if (result.status === 'saved') {
        toast.success(t('נשמר בספקים', 'Saved to Suppliers'));
        void queryClient.invalidateQueries({ queryKey: ['oil-live-companies'] });
        void queryClient.invalidateQueries({ queryKey: ['licenses'] });
      } else {
        toast.warning(
          t('ייצוא נכשל — ניתן ליצור ידנית', 'Export failed — use returned payload manually'),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-slate-50/95 dark:bg-slate-950/95">
      <div className="shrink-0 px-4 py-4 border-b border-black/5 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-sky-500" />
            {t('רדאר עסקאות', 'Deal Radar')}
          </h2>
          <button
            type="button"
            title={t('מה זה נתונים חיים?', 'What is Live Data?')}
            aria-expanded={liveDataHelpOpen}
            aria-label={t('מה זה נתונים חיים?', 'What is Live Data?')}
            onClick={() => setLiveDataHelpOpen((v) => !v)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20"
          >
            <CircleHelp className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {t(activeLensCopy.hintHe, activeLensCopy.hintEn)}
        </p>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5" role="tablist" aria-label={t('מצב עבודה', 'Work mode')}>
          {LIVE_DATA_LENS_ORDER.map((lens) => {
            const meta = LIVE_DATA_LENS_COPY[lens];
            const active = liveDataLens === lens;
            return (
              <button
                key={lens}
                type="button"
                onClick={() => onLiveDataLensChange?.(lens)}
                className={`rounded-xl px-2 py-2 text-left transition-colors ${
                  active
                    ? 'border border-sky-500/40 bg-sky-500/15 text-slate-950 dark:text-white'
                    : 'border border-black/10 bg-white/80 text-slate-600 hover:bg-white dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-300'
                }`}
              >
                <span className="block text-[10px] font-black uppercase leading-tight">
                  {t(meta.labelHe, meta.labelEn)}
                </span>
              </button>
            );
          })}
        </div>
        {liveDataLens === 'crisis' && (
          <LiveDataCrisisDeskPanel onOpenOpportunity={onOpenOpportunity} />
        )}
        {liveDataHelpOpen && (
          <div className="mt-2 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2.5 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
            <p className={`${LABEL} text-sky-800 dark:text-sky-200 mb-1.5`}>
              {t('מה זה נתונים חיים?', 'What is Live Data?')}
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                {t(
                  'מטען סינתטי — מסיקה מ-AIS, נמלים ומסחר; לא BOL בתשלום.',
                  'Synthetic cargo — inferred from AIS, ports, and trade signals; not paid BOL data.',
                )}
              </li>
              <li>
                {t(
                  'לא עסקה מאומתת — רק רמזים ציבוריים/ch חינמיים.',
                  'Not a confirmed deal — public/free-source hints only.',
                )}
              </li>
              <li>
                {t(
                  'הריצו graph-sync (Admin) כדי לרענן מסופים, חברות ומטען.',
                  'Run graph-sync (Admin) to refresh terminals, companies, and cargo records.',
                )}
              </li>
            </ul>
          </div>
        )}
        {liveAisBanner.kind !== 'none' &&
          liveAisBanner.kind !== 'tls_expired' &&
          liveAisBanner.kind !== 'worker_error' && (
          <div
            className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2.5 text-sm leading-relaxed text-amber-950 dark:text-amber-100"
            role="status"
          >
            {t(liveAisBanner.messageHe, liveAisBanner.messageEn)}
          </div>
        )}
        <CollapsibleSection
          defaultOpen={false}
          className="mt-3 rounded-xl border border-cyan-600/30 bg-cyan-500/10 px-3 py-3"
          title={
            <p className={`${LABEL} text-cyan-900 dark:text-cyan-200`}>
              {t('בריאות כיסוי', 'Coverage health')}
            </p>
          }
          badge={
            aisLive ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-900 dark:text-emerald-100">
                {t('AIS', 'AIS')}
              </span>
            ) : null
          }
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-800/90 dark:text-cyan-200/90">
            {t('בתצוגת המפה', 'In current map view')}
          </p>
          <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {coverageInView.map(({ key, label, value }) => (
              <div
                key={key}
                className="rounded-lg border border-cyan-600/20 bg-white/70 px-2 py-2 text-center dark:bg-slate-950/40"
              >
                <p className="text-xl font-black tabular-nums leading-none text-cyan-950 dark:text-cyan-50">
                  {value}
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
                  {label}
                </p>
              </div>
            ))}
          </div>
          {coverageViewNote && (
            <p
              className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100"
              role="note"
            >
              {t(coverageViewNote.he, coverageViewNote.en)}
            </p>
          )}
          <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-cyan-800/90 dark:text-cyan-200/90">
            {t('במאגר', 'In database')}
          </p>
          {syncStatusUnreachable && (
            <p
              className="mt-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-2 text-xs leading-relaxed text-rose-950 dark:text-rose-100"
              role="alert"
            >
              {t(
                'לא ניתן להגיע ל-oil-live-intel (/api/oil-live/sync-status). ודאו שהקונטיינר רץ, graph-sync הורץ, והדפדפן פונה דרך Caddy :8080 או frontend :5173 (לא backend :8000 בלבד).',
                'Cannot reach oil-live-intel (/api/oil-live/sync-status). Ensure the container is running, graph-sync has completed, and the browser uses Caddy :8080 or frontend :5173 (not backend :8000 alone).',
              )}
              {syncStatusErrorMessage ? ` (${syncStatusErrorMessage})` : ''}
            </p>
          )}
          {globalCoverageBanner && (
            <p className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-sky-950 dark:text-sky-100">
              {t('כיסוי גלובלי', 'Global ledger')}:{' '}
              {globalCoverageBanner.tiers || t('אין מטען', 'no cargo')}{' '}
              {globalCoverageBanner.comtrade &&
                ` · ${t('Comtrade', 'Comtrade')} ${globalCoverageBanner.comtrade}`}
              {globalCoverageBanner.eurostat &&
                ` · ${t('Eurostat', 'Eurostat')} ${globalCoverageBanner.eurostat}`}
              {globalCoverageBanner.macroSources &&
                ` · ${t('מאקרו לפי מקור', 'macro by source')} ${globalCoverageBanner.macroSources}`}
              {globalCoverageBanner.jodi &&
                ` · ${t('JODI', 'JODI')} ${globalCoverageBanner.jodi}`}
              {syncStatus?.last_jodi_sync_status &&
                syncStatus.last_jodi_sync_status !== 'ok' &&
                ` (${syncStatus.last_jodi_sync_status})`}
            </p>
          )}
          <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {coverageDatabase.map(({ key, label, value }) => (
              <div
                key={key}
                className="rounded-lg border border-cyan-600/20 bg-white/70 px-2 py-2 text-center dark:bg-slate-950/40"
              >
                <p className="text-xl font-black tabular-nums leading-none text-cyan-950 dark:text-cyan-50">
                  {value}
                </p>
                {key === 'manifests' && !syncStatusUnreachable && !syncStatusPending && (
                  <div className="mt-1 flex flex-col items-center gap-1">
                    <CustomsOpenTierBadge tier="customs_open" className="text-[8px]" />
                    <p className="text-[9px] font-semibold text-cyan-800 dark:text-cyan-200 tabular-nums">
                      {t('מכס פתוח', 'customs_open')}: {customsOpenManifestCount}
                    </p>
                  </div>
                )}
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
                  {label}
                </p>
              </div>
            ))}
          </div>
          {(syncStatus?.trade_manifest_row_count ?? 0) > 0 && (
            <p className="mt-2 text-[10px] leading-relaxed text-cyan-900/85 dark:text-cyan-100/85">
              {t(
                'מניפסטים פתוחים (UK HMRC ודומה) — לא ImportYeti / BOL בתשלום. אמתו tier ו-source_record_url.',
                'Open manifests (UK HMRC-style) — not paid ImportYeti/BOL. Verify tier and source_record_url.',
              )}
            </p>
          )}
          {(syncStatus?.watch_zone_observations_24h?.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[9px] font-black uppercase text-cyan-800 dark:text-cyan-200">
                {t('כיסוי AIS לפי אזור (24ש)', 'AIS by watch zone (24h)')}
              </p>
              <ul className="max-h-28 overflow-y-auto text-[9px] text-cyan-900/90 dark:text-cyan-100/90 space-y-0.5">
                {syncStatus!.watch_zone_observations_24h!.map((z) => (
                  <li key={z.zone_id} className="flex justify-between gap-2">
                    <span className="truncate">{z.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {z.observation_count}
                      {z.has_gap ? ` · ${t('פער', 'gap')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(lastGraphSyncLabel || lastCargoSyncLabel) && (
            <p className="mt-2 text-xs leading-relaxed text-cyan-900/90 dark:text-cyan-100/90">
              {lastGraphSyncLabel && (
                <>
                  {t('סנכרון גרף', 'Graph sync')}: {lastGraphSyncLabel}
                </>
              )}
              {lastGraphSyncLabel && lastCargoSyncLabel && ' · '}
              {lastCargoSyncLabel && (
                <>
                  {t('מטען אחרון', 'Last cargo')}: {lastCargoSyncLabel}
                </>
              )}
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-cyan-900/80 dark:text-cyan-100/80">
            {t(
              'מקורות: OSM, AIS פתוח, Comtrade, TED, רישיונות — AIS חסר מסומן כחור כיסוי ולא כאין פעילות.',
              'Sources: OSM, open AIS, Comtrade, TED, licenses — missing AIS is labeled as a coverage gap, not no activity.',
            )}
          </p>
          {maritimeSourceHealth.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {maritimeSourceHealth.map((source) => (
                <span
                  key={source.source}
                  className="rounded-full border border-cyan-700/20 bg-cyan-50 px-2 py-1 text-[10px] font-bold uppercase text-cyan-950 dark:border-cyan-300/20 dark:bg-cyan-950/40 dark:text-cyan-100"
                  title={source.limitations?.[0] ?? source.coverage_tier}
                >
                  {source.display_name}: {source.status.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          )}
        </CollapsibleSection>
        <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200 mt-2">
          {t(DISCLAIMER_HE, DISCLAIMER_EN)}
        </p>

        <div className="mt-3 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            type="search"
            value={terminalSearch}
            onChange={(e) => onTerminalSearchChange(e.target.value)}
            placeholder={t('חיפוש מסוף (שם / מדינה)', 'Search terminals (name / country)')}
            className="w-full pl-8 pr-2 py-2 rounded-lg border border-black/10 dark:border-white/10 text-xs bg-white dark:bg-slate-900"
          />
          {terminalSearch.trim() && (
            <p className="mt-1 text-[10px] text-slate-500">
              {t('מסנן מסופים על המפה', 'Filtering terminals on map')}
              {terminalSearchMatches.length > 0 &&
                ` · ${terminalSearchMatches.length} ${t('התאמות במאגר', 'index matches')}`}
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-3 flex-wrap">
          {(['all', 'crude', 'diesel', 'gasoil', 'jet', 'gasoline', 'lng', 'lpg', 'gas', 'sulfur'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onProductFilterChange(p)}
              className={`${BTN} ${
                productFilter === p
                  ? 'bg-sky-600 text-white'
                  : TAB_IDLE
              }`}
            >
              {p === 'all' ? t('הכל', 'All') : p}
            </button>
          ))}
        </div>

      </div>

        <div className="shrink-0 sticky top-0 z-10 border-b border-black/5 bg-slate-50/98 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/98">
        <LiveDataSearchBar onHitClick={handleSearchHit} className="mb-3" />
        <p className={`${LABEL} text-slate-600 dark:text-slate-400 mb-2`}>
          {liveDataLens === 'deal'
            ? t('בחרו ליד ואז בנו מסלול / פתחו חבילת עסקה', 'Pick a lead, then build route / open deal pack')
            : t('שכבות מפה זמינות בפאנל בפינה השמאלית', 'Map layers are available in the bottom-left panel')}
        </p>
        <div className="flex gap-2 flex-wrap">
          {(['feed', 'opportunities', 'cargo', 'companies', 'alerts'] as const).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              className={`${BTN} flex items-center gap-1.5 ${
                tab === tabKey ? TAB_ACTIVE : TAB_IDLE
              }`}
            >
              {tabKey === 'feed' && t('מודיעין', 'Intelligence')}
              {tabKey === 'opportunities' && (
                <>
                  {t('רדאר עסקאות', 'Deal Radar')}
                  {opportunities.length > 0 && (
                    <span className="rounded-full bg-emerald-600/20 px-1.5 text-[10px] font-black text-emerald-800 dark:text-emerald-200">
                      {opportunities.length}
                    </span>
                  )}
                </>
              )}
              {tabKey === 'cargo' && (
                <>
                  <Package className="w-3.5 h-3.5" />
                  {t('מטען', 'Cargo')}
                </>
              )}
              {tabKey === 'companies' && t('חברות', 'Companies')}
              {tabKey === 'alerts' && (
                <>
                  <Bell className="w-3.5 h-3.5" />
                  {t('התראות', 'Alerts')}
                  {unreadCount > 0 && (
                    <span className="bg-red-500 text-white rounded-full min-w-[18px] px-1.5 text-[10px] font-black">
                      {unreadCount}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`flex-1 min-h-0 p-4 ${
          tab === 'opportunities'
            ? 'overflow-y-auto max-h-[min(58vh,520px)]'
            : 'overflow-y-auto'
        }`}
      >
        <div className="space-y-4">
        {tab === 'feed' &&
          filteredCards.map((card) => (
            <article
              key={card.id}
              className={`${CARD} cursor-pointer hover:border-sky-500/40`}
              onClick={() => setSelectedCard(card)}
            >
              <div className="flex justify-between gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">{card.title}</h3>
                <span className="shrink-0 text-xs font-black px-2.5 py-1 rounded-full bg-sky-600/15 text-sky-900 dark:text-sky-200">
                  {Math.round((card.confidence ?? 0) * 100)}%
                </span>
              </div>
              <p className={`${MUTED} mt-2 line-clamp-3`}>{card.summary}</p>
              <div className={`flex flex-wrap gap-2 mt-2 ${LABEL}`}>
                <span className="flex items-center gap-1">
                  <Ship className="w-3.5 h-3.5" />
                  {card.event_type}
                </span>
                {card.terminal_name && <span>{card.terminal_name}</span>}
                {card.product_family_inferred && (
                  <span className="text-amber-600">{card.product_family_inferred}</span>
                )}
              </div>
            </article>
          ))}

        {tab === 'cargo' && (
          <>
            <TradeManifestUploadPanel className="mb-3" />
            <div className="flex flex-wrap gap-2 mb-2 items-center">
              <input
                className="flex-1 min-w-[120px] text-[10px] border rounded-lg px-2 py-1.5 dark:bg-slate-900"
                placeholder={t('מדינה (טעינה/פריקה)', 'Country (load/discharge)')}
                value={cargoCountry}
                onChange={(e) => setCargoCountry(e.target.value)}
              />
              {canShowSeedDataToggle() && (
                <label className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeSeedData}
                    onChange={(e) => setIncludeSeedData(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  {t('כלול נתוני seed', 'Include seed data')}
                </label>
              )}
              <select
                className="text-[10px] border rounded-lg px-2 py-1.5 dark:bg-slate-900"
                value={cargoMinConfidence}
                onChange={(e) => setCargoMinConfidence(e.target.value)}
              >
                <option value="0.45">≥45%</option>
                <option value="0.5">≥50%</option>
                <option value="0.55">≥55%</option>
                <option value="0.65">≥65%</option>
                <option value="0.75">≥75%</option>
              </select>
              <button
                type="button"
                disabled={cargoExporting}
                onClick={() => void exportCargoCsv()}
                className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-1.5 rounded-lg border border-amber-500/40 text-amber-800 dark:text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
              >
                {cargoExporting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Download className="w-3 h-3" />
                )}
                {t('ייצוא CSV', 'Export CSV')}
              </button>
              <button
                type="button"
                disabled={cargoExporting}
                onClick={() => void exportAuditBundle()}
                className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-1.5 rounded-lg border border-violet-500/40 text-violet-800 dark:text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
              >
                {t('חבילת ביקורת', 'Audit bundle')}
              </button>
            </div>
            {cargoLoading && (
              <p className="text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('טוען רשומות מטען…', 'Loading cargo records…')}
              </p>
            )}
            {(cargoLedger?.cargo_records ?? []).map((record) => (
                <article
                  key={record.id}
                  role="button"
                  tabIndex={0}
                  className="rounded-xl border border-amber-500/25 bg-white dark:bg-slate-900 p-3 cursor-pointer hover:border-amber-500/50 transition-colors"
                  onClick={() => openCargoRecord(record)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openCargoRecord(record);
                    }
                  }}
                >
                  <div className="flex justify-between gap-2 items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1 mb-0.5">
                        <OilLiveProvenanceBadge kind={record.data_provenance} />
                      </div>
                      <p className="text-[9px] font-mono text-amber-700 dark:text-amber-300 truncate">
                        {record.synthetic_bol_id ?? record.id.slice(0, 8)}
                      </p>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                        {record.commodity_family ?? record.commodity_description ?? '—'}
                      </h3>
                      <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">
                        {record.shipper_name ?? '—'} → {record.consignee_name ?? record.discharge_hint ?? '—'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-[9px] font-black text-emerald-600">
                        {Math.round((record.confidence ?? 0) * 100)}%
                      </span>
                      <p className="text-[8px] text-slate-400 uppercase">
                        {record.bol_tier ?? 'inferred'} · {record.triangulation_score ?? 0}{' '}
                        {t('מקורות', 'src')}
                      </p>
                    </div>
                  </div>
                  <p className="text-[9px] text-slate-500 mt-1">
                    {formatVolumeBand(record)}
                    {record.load_port_name && ` · ${record.load_port_name}`}
                    {record.load_country && ` (${record.load_country})`}
                  </p>
                  {firstVerifyUrl(record) && (
                    <a
                      href={firstVerifyUrl(record)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-[9px] font-bold uppercase text-violet-600 dark:text-violet-400"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('אמת במקור', 'Verify at source')}
                    </a>
                  )}
                  {record.opportunity_id && onOpenOpportunity && (
                    <button
                      type="button"
                      className="mt-2 text-[9px] font-bold uppercase text-emerald-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenOpportunity(
                          record.opportunity_id!,
                          record.vessel_name ?? record.synthetic_bol_id,
                        );
                      }}
                    >
                      {t('חבילת עסקה', 'Deal pack')}
                    </button>
                  )}
                </article>
              ))}
            {!cargoLoading && (cargoLedger?.cargo_records ?? []).length === 0 && (
              <GraphSyncEmptyCta context="cargo" />
            )}
          </>
        )}

        {tab === 'opportunities' && (
          <div className="flex flex-wrap gap-2 mb-2 items-center">
            <button
              type="button"
              disabled={oppExporting}
              onClick={() => void exportOpportunitiesCsv()}
              className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"
            >
              {oppExporting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              {t('ייצוא CSV', 'Export CSV')}
            </button>
          </div>
        )}

        {tab === 'opportunities' && opportunities.length === 0 && (
          <GraphSyncEmptyCta context="cargo" />
        )}

        {tab === 'opportunities' &&
          opportunities.map((opp: OilOpportunity) => {
            const econ = oppEconomics[opp.id];
            const expanded = expandedOpp === opp.id;
            const watchTarget = opportunityWatchTarget(opp);
            const score = opp.deal_score ?? opp.confidence ?? 0;
            const sourceTiers = opp.source_tiers?.length ? opp.source_tiers : ['inferred'];
            const why = (((opp.signal?.why_this_matters as unknown[] | undefined) ?? opp.evidence ?? []) as unknown[])
              .map((line) => String(line))
              .filter(Boolean);
            const actions = (opp.recommended_actions ?? []).map(actionLabel).filter(Boolean).slice(0, 5);
            const counterpartyHints = (opp.counterparty_hints ?? []).map(hintLabel).filter(Boolean).slice(0, 2);
            const infrastructureHints = (opp.infrastructure_hints ?? []).map(hintLabel).filter(Boolean).slice(0, 2);
            const onWatchlist =
              watchTarget != null &&
              isOnWatchlist(watchlistsData ?? [], watchTarget.watch_type, watchTarget.watch_ref);
            return (
              <article
                key={opp.id}
                className={OPP_CARD}
              >
                <div className="flex justify-between gap-3 items-start">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      {opp.signal_kind?.replaceAll('_', ' ') ?? opp.opportunity_type.replaceAll('_', ' ')}
                    </p>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                      {opp.title}
                    </h3>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="block text-lg font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
                      {percent(score)}%
                    </span>
                    <span className="text-[9px] font-black uppercase text-slate-500">
                      {t('ציון עסקה', 'deal score')}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sourceTiers.map((tier) => (
                    <span
                      key={tier}
                      className="rounded-full border border-emerald-600/20 bg-white/70 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-900 dark:bg-slate-950/50 dark:text-emerald-200"
                    >
                      {tier}
                    </span>
                  ))}
                  {opp.confidence != null && (
                    <span className="rounded-full border border-slate-500/20 bg-white/70 px-2 py-0.5 text-[9px] font-black uppercase text-slate-600 dark:bg-slate-950/50 dark:text-slate-300">
                      {percent(opp.confidence)}% {t('ביטחון', 'confidence')}
                    </span>
                  )}
                </div>
                <p className={`${MUTED} mt-2`}>{opp.hypothesis}</p>
                {why.length > 0 && (
                  <div className="mt-3">
                    <p className={`${LABEL} mb-1`}>{t('למה זה חשוב', 'Why this matters')}</p>
                    <ExpandableBulletList items={why} limit={3} />
                  </div>
                )}
                {(counterpartyHints.length > 0 || infrastructureHints.length > 0) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 text-[10px] text-slate-600 dark:text-slate-300">
                    {counterpartyHints.length > 0 && (
                      <div className="rounded-lg border border-emerald-600/15 bg-white/65 px-2 py-1.5 dark:bg-slate-950/40">
                        <span className="font-black uppercase text-emerald-700 dark:text-emerald-300">
                          {t('צדדים', 'Parties')}
                        </span>{' '}
                        {counterpartyHints.join(' · ')}
                      </div>
                    )}
                    {infrastructureHints.length > 0 && (
                      <div className="rounded-lg border border-sky-600/15 bg-white/65 px-2 py-1.5 dark:bg-slate-950/40">
                        <span className="font-black uppercase text-sky-700 dark:text-sky-300">
                          {t('תשתית', 'Infrastructure')}
                        </span>{' '}
                        {infrastructureHints.join(' · ')}
                      </div>
                    )}
                  </div>
                )}
                {actions.length > 0 && (
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {actions.join(' · ')}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {watchTarget && (
                    <button
                      type="button"
                      disabled={watchingOppId === opp.id || onWatchlist}
                      onClick={() => void handleWatchOpp(opp)}
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-2 rounded-lg border border-violet-500/40 text-[10px] font-bold uppercase text-violet-800 dark:text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
                    >
                      {watchingOppId === opp.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Bell className={`w-3.5 h-3.5 ${onWatchlist ? 'fill-current' : ''}`} />
                      )}
                      {onWatchlist
                        ? t('ברשימת מעקב', 'Watching')
                        : t('עקוב', 'Watch')}
                    </button>
                  )}
                  {onOpenOpportunity && (
                    <button
                      type="button"
                      onClick={() => onOpenOpportunity(opp.id, opp.title)}
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-2 rounded-lg bg-emerald-600 text-white text-[10px] font-bold uppercase hover:bg-emerald-500"
                    >
                      <Package className="w-3.5 h-3.5" />
                      {t('פתח חבילת עסקה', 'Open deal pack')}
                    </button>
                  )}
                  {onOpenRoutePlanner && (
                    <button
                      type="button"
                      onClick={() => onOpenRoutePlanner(buildRoutePlannerHintsFromOpportunity(opp))}
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-2 rounded-lg border border-sky-500/40 text-[10px] font-bold uppercase text-sky-800 dark:text-sky-200 hover:bg-sky-500/10"
                    >
                      <Route className="w-3.5 h-3.5" />
                      {t('בנה מסלול', 'Build route')}
                    </button>
                  )}
                  {firstVerifyUrl(opp) && (
                    <a
                      href={firstVerifyUrl(opp)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-2 rounded-lg border border-violet-500/40 text-[10px] font-bold uppercase text-violet-800 dark:text-violet-200 hover:bg-violet-500/10"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      {t('אמת מקור', 'Verify source')}
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  className="mt-3 w-full min-h-[44px] py-2.5 rounded-xl bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 text-sm font-bold uppercase tracking-wide hover:opacity-90 transition-colors"
                  onClick={async () => {
                    if (onOpenOpportunity) {
                      onOpenOpportunity(opp.id, opp.title);
                    }
                    if (expanded) {
                      setExpandedOpp(null);
                      return;
                    }
                    setExpandedOpp(opp.id);
                    try {
                      const data = await getOilOpportunityEconomics(opp.id);
                      setOppEconomics((prev) => ({ ...prev, [opp.id]: data }));
                      const s = data.sheet;
                      setDealSheet({
                        volume_bbl: s.volume_bbl != null ? String(s.volume_bbl) : '',
                        buy_price_usd_per_bbl:
                          s.buy_price_usd_per_bbl != null ? String(s.buy_price_usd_per_bbl) : '',
                        sell_price_usd_per_bbl:
                          s.sell_price_usd_per_bbl != null ? String(s.sell_price_usd_per_bbl) : '',
                        freight_usd: s.freight_usd != null ? String(s.freight_usd) : '',
                        storage_usd: s.storage_usd != null ? String(s.storage_usd) : '',
                        other_costs_usd: s.other_costs_usd != null ? String(s.other_costs_usd) : '',
                      });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed');
                    }
                  }}
                >
                  {expanded
                    ? t('הסתר גיליון עסקה', 'Hide deal sheet')
                    : t('גיליון עסקה / מרווח', 'Deal sheet / margin')}
                </button>
                {expanded && (
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    {(
                      [
                        ['volume_bbl', t('נפח (חב)', 'Vol (bbl)')],
                        ['buy_price_usd_per_bbl', t('קנייה $/חב', 'Buy $/bbl')],
                        ['sell_price_usd_per_bbl', t('מכירה $/חב', 'Sell $/bbl')],
                        ['freight_usd', t('הובלה $', 'Freight $')],
                        ['storage_usd', t('אחסון $', 'Storage $')],
                        ['other_costs_usd', t('אחר $', 'Other $')],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="text-[9px] text-slate-500">
                        {label}
                        <input
                          className="w-full text-[10px] border rounded px-1 py-0.5 mt-0.5"
                          value={dealSheet[key]}
                          onChange={(e) => setDealSheet((s) => ({ ...s, [key]: e.target.value }))}
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      className="col-span-2 py-1.5 rounded-lg bg-emerald-600 text-white text-[9px] font-bold uppercase"
                      onClick={async () => {
                        const num = (k: keyof typeof dealSheet) => {
                          const v = parseFloat(dealSheet[k]);
                          return Number.isFinite(v) ? v : undefined;
                        };
                        try {
                          const data = await saveOilOpportunityEconomics(opp.id, {
                            volume_bbl: num('volume_bbl'),
                            buy_price_usd_per_bbl: num('buy_price_usd_per_bbl'),
                            sell_price_usd_per_bbl: num('sell_price_usd_per_bbl'),
                            freight_usd: num('freight_usd'),
                            storage_usd: num('storage_usd'),
                            other_costs_usd: num('other_costs_usd'),
                          });
                          setOppEconomics((prev) => ({ ...prev, [opp.id]: data }));
                          if (data.result.complete && data.result.indicative_margin_usd != null) {
                            toast.success(
                              t(
                                `מרווח משוער: $${Math.round(data.result.indicative_margin_usd).toLocaleString()}`,
                                `Indicative margin: $${Math.round(data.result.indicative_margin_usd).toLocaleString()}`,
                              ),
                            );
                          }
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Failed');
                        }
                      }}
                    >
                      {t('חשב מרווח', 'Calc margin')}
                    </button>
                    {econ?.result.complete && econ.result.indicative_margin_usd != null && (
                      <p className="col-span-2 text-[9px] font-bold text-emerald-700">
                        {t('מרווח משוער', 'Indicative margin')}: $
                        {Math.round(econ.result.indicative_margin_usd).toLocaleString()}
                        {econ.result.margin_per_bbl_usd != null &&
                          ` · $${econ.result.margin_per_bbl_usd.toFixed(2)}/bbl`}
                      </p>
                    )}
                    <p className="col-span-2 text-[9px] text-amber-700">
                      {econ?.disclaimer ??
                        t(
                          'מרווח מהנחות שלך בלבד — לא הצעת שוק',
                          'Margin from your inputs only — not a market offer',
                        )}
                    </p>
                  </div>
                )}
              </article>
            );
          })}

        {tab === 'alerts' && (
          <>
            <div className="flex flex-wrap gap-2 mb-3 items-center">
              <button
                type="button"
                className={`${BTN} border border-sky-500/40 text-sky-700 dark:text-sky-300`}
                onClick={async () => {
                  await markAllOilAlertsRead();
                  void refetchAlerts();
                }}
              >
                {t('סמן הכל כנקרא', 'Mark all read')}
              </button>
              <span className={`${LABEL}`}>
                {(alertsData ?? []).filter((a) => !a.read_at).length} {t('לא נקראו', 'unread')}
              </span>
            </div>

            <section className={`${CARD} mb-3`}>
              <h3 className={`${LABEL} mb-2`}>
                {t('רשימות מעקב', 'Watchlists')} ({(watchlistsData ?? []).length})
              </h3>
              {(watchlistsData ?? []).length === 0 ? (
                <p className={MUTED}>{t('אין מעקבים פעילים', 'No active watches')}</p>
              ) : (
                <ul className="space-y-2">
                  {(watchlistsData ?? []).map((w: OilWatchlistItem) => (
                    <li
                      key={w.id}
                      className="flex justify-between items-center gap-2 text-sm text-slate-700 dark:text-slate-300 border-b border-black/5 dark:border-white/10 pb-2 last:border-0"
                    >
                      <span>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {w.label || w.watch_ref}
                        </span>
                        <span className={`${LABEL} ml-2`}>{w.watch_type}</span>
                      </span>
                      <button
                        type="button"
                        className="text-red-600 font-bold text-xs"
                        onClick={async () => {
                          await deleteOilWatchlist(w.id);
                          void queryClient.invalidateQueries({ queryKey: ['oil-live-watchlists'] });
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {(alertsData ?? []).map((a: OilAlert) => {
              const severity = (a.severity ?? 'info').toLowerCase();
              const severityClass =
                severity === 'high' || severity === 'critical'
                  ? 'border-red-500/40 bg-red-500/5'
                  : severity === 'medium' || severity === 'warn'
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-violet-500/30 bg-violet-500/5';
              return (
                <article
                  key={a.id}
                  className={`${CARD} mb-3 ${a.read_at ? 'opacity-60' : severityClass}`}
                >
                  <div className="flex justify-between gap-2 items-start">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                      {a.title}
                    </h3>
                    {!a.read_at && (
                      <span className="shrink-0 text-xs font-black px-2 py-0.5 rounded-full bg-violet-600/15 text-violet-900 dark:text-violet-200 uppercase">
                        {a.alert_type.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  {a.body && <p className={`${MUTED} mt-2`}>{a.body}</p>}
                  <div className={`flex flex-wrap gap-2 mt-3 ${LABEL}`}>
                    {a.severity && <span>{a.severity}</span>}
                    {a.status && <span>{a.status}</span>}
                    {a.assigned_to && (
                      <span>
                        {t('מוקצה ל', 'Assigned')}: {a.assigned_to}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    {!a.read_at && (
                      <button
                        type="button"
                        className={`${BTN} border border-sky-500/40 text-sky-700 dark:text-sky-300`}
                        onClick={async () => {
                          await markOilAlertRead(a.id);
                          void refetchAlerts();
                        }}
                      >
                        {t('נקרא', 'Mark read')}
                      </button>
                    )}
                    <input
                      className="flex-1 min-w-[120px] text-sm border rounded-lg px-2 py-1.5 dark:bg-slate-900"
                      placeholder={t('הקצה ל', 'Assign to')}
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                    />
                    <button
                      type="button"
                      className={`${BTN} bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900`}
                      onClick={async () => {
                        if (!assignee.trim()) return;
                        await assignOilAlert(a.id, assignee.trim());
                        toast.success(t('הוקצה', 'Assigned'));
                        void refetchAlerts();
                      }}
                    >
                      {t('הקצה', 'Assign')}
                    </button>
                  </div>
                </article>
              );
            })}
            {(alertsData ?? []).length === 0 && (
              <p className={MUTED}>
                {t(
                  'אין התראות — הוסף מעקב מהמפה או המתן להזדמנויות חדשות',
                  'No alerts — watch a terminal on the map or wait for new opportunities',
                )}
              </p>
            )}
          </>
        )}

        {tab === 'companies' && (
          <div className="flex gap-2 mb-2 flex-wrap items-center">
            <button
              type="button"
              disabled={enrichContactsLoading}
              onClick={() => void handleBatchEnrichContacts()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-violet-500/40 bg-violet-500/10 text-[10px] font-black uppercase text-violet-800 dark:text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
            >
              {enrichContactsLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : null}
              {t('העשר אנשי קשר (batch)', 'Enrich contacts (batch)')}
            </button>
            <span className="text-[9px] text-slate-500">
              {t('דורש Admin token · עד 20 חברות', 'Requires admin token · up to 20 companies')}
            </span>
          </div>
        )}

        {tab === 'companies' && (
          <p className="text-[10px] text-slate-500 mb-2">
            {t('סה״כ', 'Total')}: {companiesTotal.toLocaleString()}{' '}
            {t('חברות', 'companies')}
            {companiesTotal > companyPageSize &&
              ` · ${t('מציג', 'Showing')} ${companyOffset + 1}–${Math.min(companyOffset + companyPageSize, companiesTotal)}`}
          </p>
        )}

        {tab === 'companies' && (
          <div className="flex gap-1.5 mb-2 flex-wrap">
            <input
              type="text"
              value={companyCountryFilter}
              onChange={(e) => {
                setCompanyCountryFilter(e.target.value);
                setCompanyOffset(0);
              }}
              placeholder={t('מדינה', 'Country')}
              className="flex-1 min-w-[80px] px-2 py-1 rounded-lg border text-[10px] bg-white dark:bg-slate-900"
            />
            <input
              type="text"
              value={companyRoleFilter}
              onChange={(e) => {
                setCompanyRoleFilter(e.target.value);
                setCompanyOffset(0);
              }}
              placeholder={t('תפקיד (role)', 'Role')}
              className="flex-1 min-w-[80px] px-2 py-1 rounded-lg border text-[10px] bg-white dark:bg-slate-900"
            />
          </div>
        )}

        {tab === 'companies' &&
          companies.map((co) => {
            const expanded = expandedCompany === co.id;
            const contacts = companyContacts[co.id] ?? [];
            return (
              <article
                key={co.id}
                className="rounded-xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-900 p-3"
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h3 className="text-xs font-bold flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      {co.name}
                    </h3>
                    <p className="text-[9px] text-slate-500 uppercase">
                      {co.company_type} · {co.country}
                    </p>
                    <p className="text-[8px] text-slate-400 mt-0.5">
                      MCR {co.mcr_count ?? 0} · {t('אירועים', 'Events')} {co.event_count ?? 0} ·{' '}
                      {t('אנשי קשר', 'Contacts')} {co.contact_count ?? 0}
                    </p>
                    {(co.sources?.length ?? 0) > 0 && (
                      <p className="text-[8px] text-cyan-700 dark:text-cyan-300 mt-0.5 truncate">
                        {co.sources!.join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="text-[9px] font-bold text-emerald-600">{co.supplier_status}</span>
                </div>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {co.supplier_id && onOpenCompanyDossier && (
                    <button
                      type="button"
                      onClick={() => onOpenCompanyDossier(co.id)}
                      className="flex-1 min-w-[120px] py-1.5 rounded-lg border border-sky-500/40 text-xs font-bold uppercase text-sky-700 dark:text-sky-300"
                    >
                      {t('פתח דוסייה', 'Open dossier')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSave(co)}
                    className="flex-1 min-w-[120px] py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-black uppercase"
                  >
                    {t('שמור לספקים', 'Save to Suppliers')}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { draft } = await draftOilOutreach(co.id);
                        await navigator.clipboard.writeText(draft);
                        toast.success(t('טיוטה הועתקה', 'Draft copied'));
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Failed');
                      }
                    }}
                    className="flex-1 py-1.5 rounded-lg border text-[9px] font-black uppercase"
                  >
                    {t('טיוטת פנייה', 'Draft outreach')}
                  </button>
                </div>
                {co.supplier_id && (
                  <button
                    type="button"
                    className="mt-2 w-full py-1.5 rounded-lg border border-violet-500/30 text-[9px] font-bold uppercase text-violet-700"
                    onClick={async () => {
                      try {
                        const job = await runContactEnrichmentAgent(co.supplier_id!, 'license');
                        toast.success(
                          job.cached
                            ? t('סוכן אנשי קשר (מטמון)', 'Contact agent (cached)')
                            : t('סוכן אנשי קשר הושלם', 'Contact agent finished'),
                        );
                        const data = await getOilCompanyContacts(co.id);
                        setCompanyContacts((prev) => ({ ...prev, [co.id]: data.contacts }));
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Agent failed');
                      }
                    }}
                  >
                    {t('הרץ סוכן אנשי קשר', 'Run contact agent (Groq → fallback)')}
                  </button>
                )}
                <button
                  type="button"
                  className="mt-2 w-full py-1.5 text-[9px] font-bold uppercase text-sky-600"
                  onClick={async () => {
                    if (expanded) {
                      setExpandedCompany(null);
                      return;
                    }
                    setExpandedCompany(co.id);
                    try {
                      const data = await getOilCompanyContacts(co.id);
                      setCompanyContacts((prev) => ({ ...prev, [co.id]: data.contacts }));
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed');
                    }
                  }}
                >
                  {expanded
                    ? t('הסתר אנשי קשר', 'Hide contacts')
                    : t('אנשי קשר ורכש', 'Contacts & procurement')}
                </button>
                {expanded && (
                  <div className="mt-2 space-y-2">
                    {contacts.length === 0 && (
                      <p className="text-[9px] text-slate-500">
                        {t(
                          'אין אנשי קשר — שמור לספקים לסנכרון מרישיון',
                          'No contacts — save to Suppliers to sync from license',
                        )}
                      </p>
                    )}
                    {contacts.map((c, i) => (
                      <div key={c.id ?? i} className="text-[9px] text-slate-600 dark:text-slate-400">
                        <span className="font-bold uppercase">{c.contact_type}</span>: {c.value}
                        {c.origin && <span className="text-slate-400 ml-1">({c.origin})</span>}
                      </div>
                    ))}
                    <div className="flex gap-1">
                      <select
                        className="text-[9px] border rounded-lg px-1"
                        value={newContact.type}
                        onChange={(e) => setNewContact((s) => ({ ...s, type: e.target.value }))}
                      >
                        <option value="phone">phone</option>
                        <option value="email">email</option>
                        <option value="website">website</option>
                      </select>
                      <input
                        className="flex-1 text-[9px] border rounded-lg px-2"
                        placeholder={t('טלפון / אימייל', 'Phone / email')}
                        value={newContact.value}
                        onChange={(e) => setNewContact((s) => ({ ...s, value: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="text-[9px] font-bold px-2 rounded-lg bg-slate-800 text-white"
                        onClick={async () => {
                          if (!newContact.value.trim()) return;
                          try {
                            await addOilCompanyContact(co.id, {
                              contact_type: newContact.type,
                              value: newContact.value.trim(),
                            });
                            const data = await getOilCompanyContacts(co.id);
                            setCompanyContacts((prev) => ({ ...prev, [co.id]: data.contacts }));
                            setNewContact({ type: 'phone', value: '' });
                            toast.success(t('נוסף', 'Added'));
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Failed');
                          }
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}

        {tab === 'companies' && companiesTotal > companyPageSize && (
          <div className="flex items-center justify-between gap-2 mt-2">
            <button
              type="button"
              disabled={companyOffset <= 0}
              onClick={() => setCompanyOffset((o) => Math.max(0, o - companyPageSize))}
              className="px-2 py-1 rounded-lg border text-[9px] font-bold uppercase disabled:opacity-40"
            >
              {t('הקודם', 'Prev')}
            </button>
            <span className="text-[9px] text-slate-500">
              {companyOffset + 1}–{Math.min(companyOffset + companyPageSize, companiesTotal)} / {companiesTotal}
            </span>
            <button
              type="button"
              disabled={companyOffset + companyPageSize >= companiesTotal}
              onClick={() => setCompanyOffset((o) => o + companyPageSize)}
              className="px-2 py-1 rounded-lg border text-[9px] font-bold uppercase disabled:opacity-40"
            >
              {t('הבא', 'Next')}
            </button>
          </div>
        )}

        {tab === 'feed' && filteredCards.length === 0 && !isLoading && (
          <p className="text-xs text-slate-500">{t('אין כרטיסי מודיעין', 'No intelligence cards yet')}</p>
        )}

        {tab === 'companies' && !companies.length && companiesTotal === 0 && (
          <GraphSyncEmptyCta context="companies" />
        )}
        </div>
      </div>

      {selectedCard && (
        <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <p className="text-[10px] text-amber-700 dark:text-amber-300">{t(DISCLAIMER_HE, DISCLAIMER_EN)}</p>
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{selectedCard.title}</h2>
            <p className={`${BODY} mt-3`}>{selectedCard.summary}</p>
            {(selectedCard.evidence?.length ?? 0) > 0 && (
              <div className="mt-4">
                <p className={LABEL}>{t('ראיות', 'Evidence')}</p>
                <ExpandableBulletList items={selectedCard.evidence ?? []} limit={5} />
              </div>
            )}
            <button
              type="button"
              className="mt-4 w-full min-h-[44px] py-2.5 rounded-xl border text-sm font-bold uppercase text-slate-700 dark:text-slate-200"
              onClick={() => setSelectedCard(null)}
            >
              {t('סגור', 'Close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
