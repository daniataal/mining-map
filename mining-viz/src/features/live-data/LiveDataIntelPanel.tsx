import { useEffect, useMemo, useState } from 'react';
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
  saveOilCompanyToSuppliers,
  draftOilOutreach,
  getCargoRecords,
  getCargoRecord,
  getOilTerminals,
  getOilLiveSyncStatus,
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
} from '../../api/oilLiveApi';
import type { OilLiveLayerVisibility } from '../../components/petroleum/OilLiveMapOverlays';
import { runContactEnrichmentAgent } from '../../lib/api';
import { toast } from 'sonner';
import { Radio, Building2, Ship, AlertTriangle, Bell, Package, Loader2, Download } from 'lucide-react';
import DealExecutionPack from './DealExecutionPack';
import OilLiveProvenanceBadge from './OilLiveProvenanceBadge';
import { downloadCsv } from '../../lib/csvExport';

const DISCLAIMER_EN =
  'Inferred from public/free data only. Not a confirmed private transaction, buyer, seller, or cargo grade.';
const DISCLAIMER_HE = 'מסקנות מנתונים ציבוריים בלבד — לא עסקה, קונה, מוכר או סוג מוצר מאומתים.';

type Tab = 'feed' | 'companies' | 'opportunities' | 'cargo' | 'alerts';

export type LiveDataIntelPanelProps = {
  productFilter: string;
  onProductFilterChange: (value: string) => void;
  layers: OilLiveLayerVisibility;
  onLayersChange: (layers: OilLiveLayerVisibility) => void;
  coverageStats?: { terminals: number; vessels: number; opportunities: number } | null;
  onOpenOpportunity?: (opportunityId: string, title?: string) => void;
};

export default function LiveDataIntelPanel({
  productFilter,
  onProductFilterChange,
  layers,
  onLayersChange,
  coverageStats,
  onOpenOpportunity,
}: LiveDataIntelPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('feed');
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
  const [expandedCargoId, setExpandedCargoId] = useState<string | null>(null);
  const [cargoDetail, setCargoDetail] = useState<MeridianCargoRecord | null>(null);
  const [cargoDetailLoading, setCargoDetailLoading] = useState(false);
  const [cargoDealPackOppId, setCargoDealPackOppId] = useState<string | null>(null);
  const [cargoExporting, setCargoExporting] = useState(false);
  const [companyRoleFilter, setCompanyRoleFilter] = useState('');
  const [companyCountryFilter, setCompanyCountryFilter] = useState('');
  const [companyOffset, setCompanyOffset] = useState(0);
  const companyPageSize = 40;
  const [dealSheet, setDealSheet] = useState({
    volume_bbl: '',
    buy_price_usd_per_bbl: '',
    sell_price_usd_per_bbl: '',
    freight_usd: '',
    storage_usd: '',
    other_costs_usd: '',
  });

  const queryClient = useQueryClient();

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

  useEffect(() => {
    const disconnect = connectOilLiveWebSocket((msg) => {
      if (msg.type === 'intelligence_card_created' || msg.type === 'vessel_position') {
        void queryClient.invalidateQueries({ queryKey: ['oil-live-map'] });
        void queryClient.invalidateQueries({ queryKey: ['oil-live-intelligence'] });
      }
      if (msg.type === 'oil_alert') {
        void refetchAlerts();
        toast.info(t('התראה חדשה', 'New watchlist alert'));
      }
    });
    return disconnect;
  }, [queryClient, refetchAlerts, t]);

  const { data: cardsData, isLoading } = useQuery({
    queryKey: ['oil-live-intelligence'],
    queryFn: async () => (await getIntelligenceCards()).cards,
    staleTime: 30_000,
  });

  const { data: opportunitiesData } = useQuery({
    queryKey: ['oil-live-opportunities'],
    queryFn: async () => (await getOilOpportunities(0.55)).opportunities,
    staleTime: 60_000,
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

  const { data: syncStatus } = useQuery({
    queryKey: ['oil-live-sync-status'],
    queryFn: getOilLiveSyncStatus,
    staleTime: 45_000,
    refetchInterval: 120_000,
  });

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
  const opportunities = opportunitiesData ?? [];

  const filteredCards = useMemo(() => {
    if (productFilter === 'all') return cards;
    return cards.filter((c) => (c.product_family_inferred || '').includes(productFilter));
  }, [cards, productFilter]);

  function toggleLayer(key: keyof OilLiveLayerVisibility) {
    onLayersChange({ ...layers, [key]: !layers[key] });
  }

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

  async function toggleCargoDetail(record: MeridianCargoRecord) {
    if (expandedCargoId === record.id) {
      setExpandedCargoId(null);
      setCargoDetail(null);
      setCargoDealPackOppId(null);
      return;
    }
    setExpandedCargoId(record.id);
    setCargoDetailLoading(true);
    setCargoDealPackOppId(record.opportunity_id ?? null);
    try {
      const detail = await getCargoRecord(record.id);
      setCargoDetail(detail);
      if (detail.opportunity_id) setCargoDealPackOppId(detail.opportunity_id);
    } catch (e) {
      setCargoDetail(record);
      toast.error(e instanceof Error ? e.message : 'Failed to load cargo record');
    } finally {
      setCargoDetailLoading(false);
    }
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

  async function handleSave(company: OilCompany) {
    try {
      const result = await saveOilCompanyToSuppliers(company.id);
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
    <div className="flex flex-col h-full min-h-0 rounded-2xl border border-black/10 dark:border-white/10 bg-slate-50/95 dark:bg-slate-950/95 shadow-2xl backdrop-blur-xl overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-black/5 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Radio className="w-4 h-4 text-sky-500" />
            {t('נתונים חיים', 'Live Data')}
          </h2>
        </div>
        <div className="mt-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-2 text-[9px] leading-snug text-cyan-950 dark:text-cyan-100">
          <p className="font-black uppercase tracking-widest text-[8px] text-cyan-800 dark:text-cyan-200">
            {t('בריאות כיסוי', 'Coverage health')}
          </p>
          <p className="mt-0.5">
            {t('במפה', 'In map view')}:{' '}
            <span className="font-bold">{coverageStats?.terminals ?? 0}</span> {t('מסופים', 'terminals')} ·{' '}
            <span className="font-bold">{coverageStats?.vessels ?? 0}</span> {t('כלי שיט', 'vessels')} ·{' '}
            <span className="font-bold">{coverageStats?.opportunities ?? 0}</span>{' '}
            {t('הזדמנויות', 'opportunities')}
          </p>
          <p className="mt-0.5 text-cyan-900/80 dark:text-cyan-100/80">
            {t('במאגר', 'In database')}:{' '}
            <span className="font-bold">{syncStatus?.terminal_count ?? terminalsIndex?.length ?? '…'}</span>{' '}
            {t('מסופים', 'terminals')} ·{' '}
            <span className="font-bold">{syncStatus?.port_call_count ?? '…'}</span>{' '}
            {t('קריאות נמל', 'port calls')}
            {syncStatus != null && (
              <>
                {' '}
                · <span className="font-bold">{syncStatus.cargo_record_count}</span>{' '}
                {t('רשומות מטען סינתטיות', 'synthetic cargo records')}
              </>
            )}
            {lastGraphSyncLabel && (
              <>
                {' '}
                · {t('סנכרון גרף', 'Graph sync')}: {lastGraphSyncLabel}
              </>
            )}
            {lastCargoSyncLabel && (
              <>
                {' '}
                · {t('מטען אחרון', 'Last cargo')}: {lastCargoSyncLabel}
              </>
            )}
          </p>
          <p className="mt-1 text-[8px] text-cyan-800/70 dark:text-cyan-200/70">
            {t(
              'מקורות: OSM, AIS, Comtrade, TED, רישיונות — סנכרון גרף דרך graph-sync',
              'Sources: OSM, AIS, Comtrade, TED, licenses — graph sync via admin graph-sync',
            )}
          </p>
        </div>
        <p className="text-[9px] text-amber-700 dark:text-amber-300 mt-1">{t(DISCLAIMER_HE, DISCLAIMER_EN)}</p>

        <div className="flex gap-1.5 mt-2 flex-wrap">
          {(['all', 'crude', 'refined', 'gas', 'sulfur'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onProductFilterChange(p)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase ${
                productFilter === p
                  ? 'bg-sky-600 text-white'
                  : 'bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10'
              }`}
            >
              {p === 'all' ? t('הכל', 'All') : p}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 mt-2 flex-wrap">
          {(
            [
              ['terminals', t('מסופים', 'Terminals')],
              ['vessels', t('כלי שיט', 'Vessels')],
              ['corridors', t('מסדרונות', 'Corridors')],
              ['opportunities', t('הזדמנויות', 'Opportunities')],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleLayer(key)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase ${
                layers[key]
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 mt-2 flex-wrap">
          {(['feed', 'opportunities', 'cargo', 'companies', 'alerts'] as const).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase flex items-center gap-1 ${
                tab === tabKey ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-white dark:bg-slate-900 border'
              }`}
            >
              {tabKey === 'feed' && t('מודיעין', 'Intelligence')}
              {tabKey === 'opportunities' && t('הזדמנויות', 'Opportunities')}
              {tabKey === 'cargo' && (
                <>
                  <Package className="w-3 h-3" />
                  {t('מטען', 'Cargo')}
                </>
              )}
              {tabKey === 'companies' && t('חברות', 'Companies')}
              {tabKey === 'alerts' && (
                <>
                  <Bell className="w-3 h-3" />
                  {t('התראות', 'Alerts')}
                  {unreadCount > 0 && (
                    <span className="bg-red-500 text-white rounded-full px-1 text-[8px]">{unreadCount}</span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {tab === 'feed' &&
          filteredCards.map((card) => (
            <article
              key={card.id}
              className="rounded-xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-900 p-3 shadow-sm cursor-pointer hover:border-sky-500/40"
              onClick={() => setSelectedCard(card)}
            >
              <div className="flex justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">{card.title}</h3>
                <span className="shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-700 dark:text-sky-300">
                  {Math.round((card.confidence ?? 0) * 100)}%
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">{card.summary}</p>
              <div className="flex flex-wrap gap-2 mt-2 text-[9px] uppercase font-bold text-slate-400">
                <span className="flex items-center gap-1">
                  <Ship className="w-3 h-3" />
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
            <div className="flex flex-wrap gap-2 mb-2 items-center">
              <input
                className="flex-1 min-w-[120px] text-[10px] border rounded-lg px-2 py-1.5 dark:bg-slate-900"
                placeholder={t('מדינה (טעינה/פריקה)', 'Country (load/discharge)')}
                value={cargoCountry}
                onChange={(e) => setCargoCountry(e.target.value)}
              />
              <label className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase text-slate-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSeedData}
                  onChange={(e) => setIncludeSeedData(e.target.checked)}
                  className="rounded border-slate-300"
                />
                {t('כלול נתוני seed', 'Include seed data')}
              </label>
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
            </div>
            {cargoLoading && (
              <p className="text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('טוען רשומות מטען…', 'Loading cargo records…')}
              </p>
            )}
            {(cargoLedger?.cargo_records ?? []).map((record) => {
              const expanded = expandedCargoId === record.id;
              return (
                <article
                  key={record.id}
                  className="rounded-xl border border-amber-500/25 bg-white dark:bg-slate-900 p-3"
                >
                  <div className="flex justify-between gap-2 items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1 mb-0.5">
                        <OilLiveProvenanceBadge kind={record.data_provenance ?? 'synthetic'} />
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
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-[9px] font-bold uppercase text-amber-700"
                      onClick={() => void toggleCargoDetail(record)}
                    >
                      {expanded ? t('הסתר', 'Hide') : t('פרטים', 'Details')}
                    </button>
                    {(record.opportunity_id || cargoDealPackOppId) && onOpenOpportunity && (
                      <button
                        type="button"
                        className="text-[9px] font-bold uppercase text-emerald-700"
                        onClick={() =>
                          onOpenOpportunity(
                            (record.opportunity_id ?? cargoDealPackOppId)!,
                            record.vessel_name ?? record.synthetic_bol_id,
                          )
                        }
                      >
                        {t('חבילת עסקה', 'Deal pack')}
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div className="mt-2 border-t border-black/5 dark:border-white/10 pt-2 space-y-2">
                      {cargoDetailLoading && (
                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {t('טוען…', 'Loading…')}
                        </p>
                      )}
                      {cargoDetail && !cargoDetailLoading && (
                        <>
                          <ul className="text-[9px] text-slate-500 list-disc pl-4 space-y-0.5">
                            {(cargoDetail.evidence_chain ?? []).slice(0, 6).map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                          {cargoDealPackOppId && (
                            <div className="mt-2">
                              <DealExecutionPack opportunityId={cargoDealPackOppId} />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {!cargoLoading && (cargoLedger?.cargo_records ?? []).length === 0 && (
              <p className="text-xs text-slate-500">
                {t(
                  'אין רשומות מטען — הריצו graph-sync ו-synthetic BOL rebuild',
                  'No cargo records — run graph-sync and synthetic BOL rebuild',
                )}
              </p>
            )}
          </>
        )}

        {tab === 'opportunities' &&
          opportunities.map((opp: OilOpportunity) => {
            const econ = oppEconomics[opp.id];
            const expanded = expandedOpp === opp.id;
            return (
              <article
                key={opp.id}
                className="rounded-xl border border-emerald-500/20 bg-white dark:bg-slate-900 p-3"
              >
                <div className="flex justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">{opp.title}</h3>
                  <span className="text-[9px] font-black text-emerald-600">
                    {Math.round((opp.confidence ?? 0) * 100)}%
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">{opp.hypothesis}</p>
                {opp.profit_checklist && opp.profit_checklist.length > 0 && (
                  <ul className="mt-2 text-[9px] text-slate-500 list-disc pl-4">
                    {opp.profit_checklist.slice(0, 4).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className="mt-2 w-full py-1.5 text-[9px] font-bold uppercase text-emerald-700"
                  onClick={async () => {
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
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                className="text-[9px] font-bold uppercase text-sky-600"
                onClick={async () => {
                  await markAllOilAlertsRead();
                  void refetchAlerts();
                }}
              >
                {t('סמן הכל כנקרא', 'Mark all read')}
              </button>
            </div>
            <p className="text-[9px] font-bold text-slate-500 uppercase mb-2">
              {t('רשימות מעקב', 'Watchlists')} ({(watchlistsData ?? []).length})
            </p>
            {(watchlistsData ?? []).map((w: OilWatchlistItem) => (
              <div
                key={w.id}
                className="flex justify-between items-center text-[9px] text-slate-500 border-b py-1"
              >
                <span>
                  {w.label || w.watch_ref} · {w.watch_type}
                </span>
                <button
                  type="button"
                  className="text-red-600 font-bold"
                  onClick={async () => {
                    await deleteOilWatchlist(w.id);
                    void queryClient.invalidateQueries({ queryKey: ['oil-live-watchlists'] });
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {(alertsData ?? []).map((a: OilAlert) => (
              <article
                key={a.id}
                className={`rounded-xl border p-3 ${a.read_at ? 'opacity-60' : 'border-violet-500/30 bg-violet-500/5'}`}
              >
                <h3 className="text-xs font-bold">{a.title}</h3>
                <p className="text-[10px] text-slate-500 mt-1">{a.body}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!a.read_at && (
                    <button
                      type="button"
                      className="text-[9px] font-bold uppercase text-sky-600"
                      onClick={async () => {
                        await markOilAlertRead(a.id);
                        void refetchAlerts();
                      }}
                    >
                      {t('נקרא', 'Mark read')}
                    </button>
                  )}
                  <input
                    className="text-[9px] border rounded px-1 flex-1 min-w-[80px]"
                    placeholder={t('הקצה ל', 'Assign to')}
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  />
                  <button
                    type="button"
                    className="text-[9px] font-bold uppercase"
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
            ))}
            {(alertsData ?? []).length === 0 && (
              <p className="text-xs text-slate-500">
                {t(
                  'אין התראות — הוסף מעקב מהמפה או המתן להזדמנויות חדשות',
                  'No alerts — watch a terminal on the map or wait for new opportunities',
                )}
              </p>
            )}
          </>
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
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSave(co)}
                    className="flex-1 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-[9px] font-black uppercase"
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
      </div>

      {selectedCard && (
        <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <p className="text-[10px] text-amber-700 dark:text-amber-300">{t(DISCLAIMER_HE, DISCLAIMER_EN)}</p>
            </div>
            <h2 className="text-lg font-bold">{selectedCard.title}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{selectedCard.summary}</p>
            <ul className="mt-4 space-y-1 text-[11px] text-slate-500">
              {(selectedCard.evidence || []).map((e, i) => (
                <li key={i}>• {e}</li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-4 w-full py-2 rounded-xl border text-[10px] font-bold uppercase"
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
