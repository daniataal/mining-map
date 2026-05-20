import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { useI18n } from '../../lib/i18n';
import {
  getOilLiveMap,
  getIntelligenceCards,
  getOilCompanies,
  getOilOpportunities,
  getOilOpportunityEconomics,
  saveOilOpportunityEconomics,
  getOilCompanyContacts,
  addOilCompanyContact,
  saveOilCompanyToSuppliers,
  draftOilOutreach,
  type OilContact,
  type OilDealEconomics,
  getOilWatchlists,
  addOilWatchlist,
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
  type OilTerminal,
} from '../../api/oilLiveApi';
import { runContactEnrichmentAgent } from '../../lib/api';
import { toast } from 'sonner';
import { Radio, Building2, Ship, AlertTriangle, Bell, Eye } from 'lucide-react';

import 'leaflet/dist/leaflet.css';

const terminalIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:12px;height:12px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 0 6px rgba(37,99,235,.6)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const DISCLAIMER_EN =
  'Inferred from public/free data only. Not a confirmed private transaction, buyer, seller, or cargo grade.';
const DISCLAIMER_HE = 'מסקנות מנתונים ציבוריים בלבד — לא עסקה, קונה, מוכר או סוג מוצר מאומתים.';

type Tab = 'feed' | 'companies' | 'opportunities' | 'alerts';

export default function LiveDataPanel() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('feed');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [selectedCard, setSelectedCard] = useState<OilIntelligenceCard | null>(null);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [companyContacts, setCompanyContacts] = useState<Record<string, OilContact[]>>({});
  const [newContact, setNewContact] = useState({ type: 'phone', value: '' });
  const [expandedOpp, setExpandedOpp] = useState<string | null>(null);
  const [oppEconomics, setOppEconomics] = useState<Record<string, OilDealEconomics>>({});
  const [assignee, setAssignee] = useState('');
  const [dealSheet, setDealSheet] = useState({
    volume_bbl: '',
    buy_price_usd_per_bbl: '',
    sell_price_usd_per_bbl: '',
    freight_usd: '',
    storage_usd: '',
    other_costs_usd: '',
  });

  const queryClient = useQueryClient();

  const { data: mapData, isLoading } = useQuery({
    queryKey: ['oil-live-map'],
    queryFn: () => getOilLiveMap(),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

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

  const { data: cardsData } = useQuery({
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
    queryKey: ['oil-live-companies', productFilter],
    queryFn: async () =>
      (
        await getOilCompanies({
          supplier_status: tab === 'companies' ? undefined : 'candidate',
          min_confidence: 0.5,
        })
      ).companies,
    staleTime: 30_000,
  });

  const terminals = mapData?.terminals ?? [];
  const cards = cardsData ?? mapData?.cards ?? [];
  const companies = companiesData ?? mapData?.companies ?? [];
  const opportunities = opportunitiesData ?? [];

  const filteredCards = useMemo(() => {
    if (productFilter === 'all') return cards;
    return cards.filter(
      (c) => (c.product_family_inferred || '').includes(productFilter) || productFilter === 'all',
    );
  }, [cards, productFilter]);

  const mapCenter = useMemo((): [number, number] => {
    if (terminals.length && terminals[0].lat != null && terminals[0].lng != null) {
      return [terminals[0].lat!, terminals[0].lng!];
    }
    return [25, 50];
  }, [terminals]);

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
    <div className="flex flex-col h-full min-h-0 pt-20 sm:pt-24 bg-slate-50 dark:bg-slate-950">
      <div className="shrink-0 px-4 pb-3 border-b border-black/5 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-sky-500" />
            {t('נתונים חיים', 'Live Data')}
          </h1>
          <p className="text-[10px] text-amber-700 dark:text-amber-300 max-w-2xl">
            {t(DISCLAIMER_HE, DISCLAIMER_EN)}
          </p>
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          {(['all', 'crude', 'refined', 'gas', 'sulfur'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProductFilter(p)}
              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase ${
                productFilter === p
                  ? 'bg-sky-600 text-white'
                  : 'bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10'
              }`}
            >
              {p === 'all' ? t('הכל', 'All') : p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTab('feed')}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase ${tab === 'feed' ? 'bg-amber-500 text-slate-950' : 'bg-white dark:bg-slate-900 border'}`}
          >
            {t('מודיעין', 'Intelligence')}
          </button>
          <button
            type="button"
            onClick={() => setTab('opportunities')}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase ${tab === 'opportunities' ? 'bg-amber-500 text-slate-950' : 'bg-white dark:bg-slate-900 border'}`}
          >
            {t('הזדמנויות', 'Opportunities')}
          </button>
          <button
            type="button"
            onClick={() => setTab('companies')}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase ${tab === 'companies' ? 'bg-amber-500 text-slate-950' : 'bg-white dark:bg-slate-900 border'}`}
          >
            {t('חברות', 'Companies')}
          </button>
          <button
            type="button"
            onClick={() => setTab('alerts')}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 ${tab === 'alerts' ? 'bg-amber-500 text-slate-950' : 'bg-white dark:bg-slate-900 border'}`}
          >
            <Bell className="w-3 h-3" />
            {t('התראות', 'Alerts')}
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white rounded-full px-1.5 text-[9px]">{unreadCount}</span>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-0 overflow-hidden">
        <div className="lg:w-[55%] h-[40vh] lg:h-full min-h-[240px] relative border-b lg:border-b-0 lg:border-r border-black/5 dark:border-white/10">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
              {t('טוען מפה...', 'Loading map...')}
            </div>
          ) : (
            <MapContainer center={mapCenter} zoom={3} className="h-full w-full" scrollWheelZoom>
              <TileLayer
                attribution="&copy; OpenStreetMap"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {terminals.map((term: OilTerminal) =>
                term.lat != null && term.lng != null ? (
                  <Marker key={term.id} position={[term.lat, term.lng]} icon={terminalIcon}>
                    <Popup>
                      <strong>{term.name}</strong>
                      <br />
                      {term.operator_name}
                      <br />
                      {(term.products || []).join(', ')}
                      <br />
                      <button
                        type="button"
                        className="mt-2 text-[10px] font-bold text-sky-600 uppercase"
                        onClick={async () => {
                          try {
                            await addOilWatchlist({
                              watch_type: 'terminal',
                              watch_ref: term.id,
                              label: term.name,
                            });
                            toast.success(t('נוסף למעקב', 'Added to watchlist'));
                            void queryClient.invalidateQueries({ queryKey: ['oil-live-watchlists'] });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Failed');
                          }
                        }}
                      >
                        <Eye className="w-3 h-3 inline mr-1" />
                        {t('עקוב אחרי מסוף', 'Watch terminal')}
                      </button>
                    </Popup>
                  </Marker>
                ) : null,
              )}
            </MapContainer>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === 'feed' &&
            filteredCards.map((card) => (
              <article
                key={card.id}
                className="rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-900 p-4 shadow-sm cursor-pointer hover:border-sky-500/40"
                onClick={() => setSelectedCard(card)}
              >
                <div className="flex justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{card.title}</h3>
                  <span className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-700 dark:text-sky-300">
                    {Math.round((card.confidence ?? 0) * 100)}%
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{card.summary}</p>
                <div className="flex flex-wrap gap-2 mt-2 text-[10px] uppercase font-bold text-slate-400">
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

          {tab === 'opportunities' &&
            opportunities.map((opp: OilOpportunity) => {
              const econ = oppEconomics[opp.id];
              const expanded = expandedOpp === opp.id;
              return (
                <article
                  key={opp.id}
                  className="rounded-2xl border border-emerald-500/20 bg-white dark:bg-slate-900 p-4"
                >
                  <div className="flex justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{opp.title}</h3>
                    <span className="text-[10px] font-black text-emerald-600">
                      {Math.round((opp.confidence ?? 0) * 100)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{opp.hypothesis}</p>
                  {opp.profit_checklist && opp.profit_checklist.length > 0 && (
                    <ul className="mt-2 text-[10px] text-slate-500 list-disc pl-4">
                      {opp.profit_checklist.slice(0, 4).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="mt-2 w-full py-1.5 text-[10px] font-bold uppercase text-emerald-700"
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
                            onChange={(e) =>
                              setDealSheet((s) => ({ ...s, [key]: e.target.value }))
                            }
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        className="col-span-2 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold uppercase"
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
                        <p className="col-span-2 text-[10px] font-bold text-emerald-700">
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
                  className="text-[10px] font-bold uppercase text-sky-600"
                  onClick={async () => {
                    await markAllOilAlertsRead();
                    void refetchAlerts();
                  }}
                >
                  {t('סמן הכל כנקרא', 'Mark all read')}
                </button>
              </div>
              <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">
                {t('רשימות מעקב', 'Watchlists')} ({(watchlistsData ?? []).length})
              </p>
              {(watchlistsData ?? []).map((w: OilWatchlistItem) => (
                <div
                  key={w.id}
                  className="flex justify-between items-center text-[10px] text-slate-500 border-b py-1"
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
                  className={`rounded-2xl border p-4 ${a.read_at ? 'opacity-60' : 'border-violet-500/30 bg-violet-500/5'}`}
                >
                  <h3 className="text-sm font-bold">{a.title}</h3>
                  <p className="text-[11px] text-slate-500 mt-1">{a.body}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!a.read_at && (
                      <button
                        type="button"
                        className="text-[10px] font-bold uppercase text-sky-600"
                        onClick={async () => {
                          await markOilAlertRead(a.id);
                          void refetchAlerts();
                        }}
                      >
                        {t('נקרא', 'Mark read')}
                      </button>
                    )}
                    <input
                      className="text-[10px] border rounded px-1 flex-1 min-w-[80px]"
                      placeholder={t('הקצה ל', 'Assign to')}
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                    />
                    <button
                      type="button"
                      className="text-[10px] font-bold uppercase"
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
                <p className="text-sm text-slate-500">
                  {t(
                    'אין התראות — הוסף מעקב ממפה או ממתין להזדמנויות חדשות',
                    'No alerts — watch a terminal on the map or wait for new opportunities',
                  )}
                </p>
              )}
            </>
          )}

          {tab === 'companies' &&
            companies.map((co) => {
              const expanded = expandedCompany === co.id;
              const contacts = companyContacts[co.id] ?? [];
              return (
                <article
                  key={co.id}
                  className="rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-900 p-4"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h3 className="text-sm font-bold flex items-center gap-1">
                        <Building2 className="w-4 h-4 text-slate-400" />
                        {co.name}
                      </h3>
                      <p className="text-[10px] text-slate-500 uppercase">
                        {co.company_type} · {co.country}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600">{co.supplier_status}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSave(co)}
                      className="flex-1 py-2 rounded-xl bg-amber-500 text-slate-950 text-[10px] font-black uppercase"
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
                      className="flex-1 py-2 rounded-xl border text-[10px] font-black uppercase"
                    >
                      {t('טיוטת פנייה', 'Draft outreach')}
                    </button>
                  </div>
                  {co.supplier_id && (
                    <button
                      type="button"
                      className="mt-2 w-full py-1.5 rounded-xl border border-violet-500/30 text-[10px] font-bold uppercase text-violet-700"
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
                    className="mt-2 w-full py-1.5 text-[10px] font-bold uppercase text-sky-600"
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
                        <p className="text-[10px] text-slate-500">
                          {t(
                            'אין אנשי קשר — שמור לספקים לסנכרון מרישיון',
                            'No contacts — save to Suppliers to sync from license',
                          )}
                        </p>
                      )}
                      {contacts.map((c, i) => (
                        <div key={c.id ?? i} className="text-[10px] text-slate-600 dark:text-slate-400">
                          <span className="font-bold uppercase">{c.contact_type}</span>: {c.value}
                          {c.origin && (
                            <span className="text-slate-400 ml-1">({c.origin})</span>
                          )}
                        </div>
                      ))}
                      <div className="flex gap-1">
                        <select
                          className="text-[10px] border rounded-lg px-1"
                          value={newContact.type}
                          onChange={(e) => setNewContact((s) => ({ ...s, type: e.target.value }))}
                        >
                          <option value="phone">phone</option>
                          <option value="email">email</option>
                          <option value="website">website</option>
                        </select>
                        <input
                          className="flex-1 text-[10px] border rounded-lg px-2"
                          placeholder={t('טלפון / אימייל', 'Phone / email')}
                          value={newContact.value}
                          onChange={(e) => setNewContact((s) => ({ ...s, value: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="text-[10px] font-bold px-2 rounded-lg bg-slate-800 text-white"
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

          {tab === 'feed' && filteredCards.length === 0 && !isLoading && (
            <p className="text-sm text-slate-500">{t('אין כרטיסי מודיעין', 'No intelligence cards yet')}</p>
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
