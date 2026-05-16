import { useState, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { useI18n } from '../lib/i18n';
import {
  MiningLicense,
  UserAnnotation,
  EntityContact,
  EntityRelationship,
  DdReport,
  LegalEvent,
  LeadValue,
  OilHsCategory,
  MarketTickerRow,
} from '../types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Input } from './ui/input';
import {
  X as LucideX,
  Brain as LucideBrain,
  MapPin as LucideMapPin,
  ShieldCheck as LucideShieldCheck,
  Zap as LucideZap,
  User as LucideUser,
  Phone as LucidePhone,
  Mail as LucideMail,
  Globe as LucideGlobe,
  Trash2 as LucideTrash2,
  Camera as LucideCamera,
  Share2 as LucideShare2,
  Pencil as LucidePencil,
  Check as LucideCheck,
  Scale as LucideScale,
  Gavel as LucideGavel,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AiIntelligenceReport } from './AiIntelligenceReport';
import TradeContext from './TradeContext';
import OilTradeContext from './OilTradeContext';
import ExecutionChecklist from './ExecutionChecklist';
import AddToDueDiligenceButton from './AddToDueDiligenceButton';
import MaritimeContextPanel from './MaritimeContextPanel';
import PortLogisticsPanel from './PortLogisticsPanel';
import EntityRelationshipPanel from './EntityRelationshipPanel';
import {
  API_BASE,
  getEntityContacts,
  getEntityRelationships,
  getLatestDdReport,
  getLegalEvents,
  useStorageTerminalDetails,
} from '../lib/api';
import { getLicenseCommodityLabels } from '../lib/commodities';
import { getCommodityMarketSnapshot } from '../lib/commodityMarket';
import {
  getLicenseHeroImageUrl,
  getLicenseVolumeUnit,
  isOilAndGasLicense,
} from '../lib/licenseHeroImage';

/** Client-side cap so hung requests release the UI (server may use longer LLM timeouts). */
const AI_ANALYZE_CLIENT_TIMEOUT_MS = 180_000;

function formatAiAnalyzeFailureMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const m = (payload as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  if (status === 503) {
    return 'Intelligence providers are busy or unreachable. Try again in a moment.';
  }
  if (status === 502) {
    return 'The intelligence service could not complete this request. Please try again.';
  }
  return 'Intelligence request failed.';
}

interface DossierViewProps {
  isOpen: boolean;
  onClose: () => void;
  item: MiningLicense | null;
  annotation: UserAnnotation;
  marketPrices: MarketTickerRow[];
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  onDeleteLicense?: () => void;
  isInDdQueue?: boolean;
  onAddToDueDiligence?: () => void;
  onRemoveFromDueDiligence?: () => void;
}

const KANBAN_STAGES = ['New', 'Needs Review', 'Investigating', 'Escalated', 'Approved', 'Rejected'] as const;

const LIFECYCLE_STEPS = [
  { id: 'New', label: 'New' },
  { id: 'Needs Review', label: 'Needs Review' },
  { id: 'Investigating', label: 'Investigating' },
  { id: 'Escalated', label: 'Escalated' },
  { id: 'Approved', label: 'Approved' },
  { id: 'Rejected', label: 'Rejected' },
] as const;

const STAGE_TO_LIFECYCLE: Record<string, number> = {
  'New': 0,
  'Needs Review': 1,
  'Investigating': 2,
  'Escalated': 3,
  'Approved': 4,
  'Rejected': 5,
};

const LIFECYCLE_TO_STAGE: Record<number, string> = {
  0: 'New',
  1: 'Needs Review',
  2: 'Investigating',
  3: 'Escalated',
  4: 'Approved',
  5: 'Rejected',
};

function inferOilCategory(commodity?: string | null): OilHsCategory {
  const normalized = (commodity || '').toLowerCase();
  if (normalized.includes('lng') || normalized.includes('lpg') || normalized.includes('gas')) return 'gas';
  if (normalized.includes('refin') || normalized.includes('diesel') || normalized.includes('petrol')) return 'refined';
  if (normalized.includes('oil') || normalized.includes('petroleum') || normalized.includes('crude')) return 'crude';
  return 'other';
}

export default function DossierView({
  isOpen,
  onClose,
  item,
  annotation,
  marketPrices,
  updateAnnotation,
  onDeleteLicense,
  isInDdQueue = false,
  onAddToDueDiligence,
  onRemoveFromDueDiligence,
}: DossierViewProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('overview');
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingLOI, setIsGeneratingLOI] = useState(false);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [entityContacts, setEntityContacts] = useState<EntityContact[]>([]);
  const [entityRelationships, setEntityRelationships] = useState<EntityRelationship[]>([]);
  const [latestDdReport, setLatestDdReport] = useState<DdReport | null>(null);
  const [legalEvents, setLegalEvents] = useState<LegalEvent[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [isLoadingRelationships, setIsLoadingRelationships] = useState(false);
  const [isLoadingDdReport, setIsLoadingDdReport] = useState(false);
  const [isLoadingLegalEvents, setIsLoadingLegalEvents] = useState(false);
  const [legalEventsError, setLegalEventsError] = useState<string | null>(null);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);
  const [aiSlowNetworkHint, setAiSlowNetworkHint] = useState(false);
  const aiRunInFlightRef = useRef(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [relationshipsError, setRelationshipsError] = useState<string | null>(null);
  const [selectedCommodity, setSelectedCommodity] = useState('');

  // CRM edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<Partial<UserAnnotation>>({});

  const effectiveCommodityRaw = useMemo(() => {
    const annotated = (annotation.commodity ?? '').trim();
    const base = (item?.commodity ?? '').trim();
    return annotated || base;
  }, [annotation.commodity, item?.commodity]);

  const commodityLabels = useMemo(
    () =>
      item
        ? getLicenseCommodityLabels(item.commodity, annotation.commodity).filter(
            (label) => label !== 'Unknown'
          )
        : [],
    [annotation.commodity, item?.commodity]
  );
  const primaryCommodityLabel = commodityLabels[0] || '';
  const activeCommodityLabel = selectedCommodity || primaryCommodityLabel;
  const commodityListLabel = effectiveCommodityRaw || activeCommodityLabel || 'Unknown';
  const commoditySummaryLabel =
    commodityLabels.length === 0
      ? 'Unknown'
      : commodityLabels.length === 1
        ? commodityLabels[0]
        : `${commodityLabels[0]} +${commodityLabels.length - 1}`;
  const commoditySearchLabel = activeCommodityLabel || commodityListLabel;
  const activeCommodityMarket = useMemo(
    () => getCommodityMarketSnapshot(activeCommodityLabel, marketPrices),
    [activeCommodityLabel, marketPrices]
  );

  // Current pipeline stage
  const currentStage = annotation.stage || 'New';
  const lifecycleStep = STAGE_TO_LIFECYCLE[currentStage] ?? 0;
  const isOilAndGas = isOilAndGasLicense(item?.sector, commodityListLabel);
  const volumeUnit = getLicenseVolumeUnit(item?.sector, commodityListLabel);
  const heroImageUrl = item ? getLicenseHeroImageUrl(item) : '/assets/commodities/mining.png';
  const isStorageTerminal = item?.entityKind === 'storage_terminal';
  const isPortLogistics = item?.entityKind === 'port' || item?.entityKind === 'logistics_node';
  const oilCategory = inferOilCategory(effectiveCommodityRaw);
  const { data: storageTerminalDetails, isLoading: isLoadingStorageTerminal } =
    useStorageTerminalDetails(
      isStorageTerminal ? item?.id : undefined,
      Boolean(isOpen && isStorageTerminal && item?.id)
    );

  const runAiAnalysis = async () => {
    if (!item) return;
    if (aiRunInFlightRef.current) return;
    aiRunInFlightRef.current = true;
    setAiAnalysisError(null);
    setAiSlowNetworkHint(false);
    setAiAnalysis('');
    setIsAnalyzing(true);
    const controller = new AbortController();
    const clientTimeout = window.setTimeout(() => controller.abort(), AI_ANALYZE_CLIENT_TIMEOUT_MS);
    try {
      const token = localStorage.getItem('mining_token');
      const res = await fetch(`${API_BASE}/api/ai/analyze`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: `Analyze the intelligence potential, risks, and operational profile for ${item.company} located in ${item.region}, ${item.country}. Sector: ${item.sector || 'Mining'}. Primary commodity/focus: ${commodityListLabel}. Entity Type: ${item.licenseType}. Entity ID: ${item.id}.

Output requirements:
- Use Markdown only. Start with "## Entity Snapshot" and 4–6 short bullet lines (company, location, sector, focus, entity type, ID, status note).
- Then "## Operational Analysis", "## Risk Rating" (give X/10 and a compact table: Category | Score | One-line why), and "## Tactical Recommendation" (numbered steps, plain language).
- Keep paragraphs to 2–4 sentences. Avoid dense pipe tables except the risk matrix. Flag items that must be verified through raw evidence.`,
          context: { type: 'DOSSIER', item_id: item.id, entity_kind: item.entityKind || 'license' },
        }),
      });
      let data: Record<string, unknown> | null = null;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = null;
      }
      if (!res.ok) {
        setAiAnalysis('');
        setAiAnalysisError(formatAiAnalyzeFailureMessage(res.status, data));
        return;
      }
      if (data?.ddReport && typeof data.ddReport === 'object') {
        const ddReport = data.ddReport as DdReport;
        setLatestDdReport(ddReport);
        if (Array.isArray(ddReport.legalEvents)) {
          setLegalEvents(ddReport.legalEvents);
        }
      }
      setAiAnalysis(
        (typeof data?.analysis === 'string' && data.analysis) ||
          (typeof data?.response === 'string' && data.response) ||
          'No tactical data available for this site.'
      );
    } catch (err: unknown) {
      setAiAnalysis('');
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
      if (name === 'AbortError') {
        setAiAnalysisError(
          'This scan is taking a long time and was stopped on this device. The network or upstream AI may be slow — try again in a minute.'
        );
      } else {
        setAiAnalysisError('Intelligence link failed. Manual verification recommended.');
      }
    } finally {
      window.clearTimeout(clientTimeout);
      aiRunInFlightRef.current = false;
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!isAnalyzing) {
      setAiSlowNetworkHint(false);
      return;
    }
    const t = window.setTimeout(() => setAiSlowNetworkHint(true), 8000);
    return () => {
      window.clearTimeout(t);
    };
  }, [isAnalyzing]);

  useEffect(() => {
    if (isOpen && item) {
      fetch(`${API_BASE}/activity/logs?limit=50`)
        .then(r => r.json())
        .then(logs =>
          setActivityLogs(
            logs.filter(
              (l: any) =>
                l.details?.includes(item.id) || l.details?.includes(item.company)
            )
          )
        )
        .catch(() => {});
    }
  }, [isOpen, item]);

  useEffect(() => {
    let isCancelled = false;
    if (!isOpen || !item) {
      setLatestDdReport(null);
      setAiAnalysis('');
      setAiAnalysisError(null);
      setIsLoadingDdReport(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoadingDdReport(true);
    getLatestDdReport(item.id, item.entityKind || 'license')
      .then((report) => {
        if (isCancelled) return;
        setLatestDdReport(report);
        if (report?.analysis?.trim()) {
          setAiAnalysis(report.analysis);
          setAiAnalysisError(null);
          return;
        }
        void runAiAnalysis();
      })
      .catch(() => {
        if (!isCancelled) {
          setLatestDdReport(null);
          void runAiAnalysis();
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingDdReport(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, item?.id]);

  useEffect(() => {
    let isCancelled = false;
    if (!isOpen || !item) {
      setEntityContacts([]);
      setContactsError(null);
      setIsLoadingContacts(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoadingContacts(true);
    setContactsError(null);

    getEntityContacts(item.id, item.entityKind || 'license')
      .then((contacts) => {
        if (!isCancelled) {
          setEntityContacts(contacts);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setEntityContacts([]);
          setContactsError('Unable to load verified public contacts right now.');
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingContacts(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, item?.id]);

  useEffect(() => {
    let isCancelled = false;
    if (!isOpen || !item) {
      setEntityRelationships([]);
      setRelationshipsError(null);
      setIsLoadingRelationships(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoadingRelationships(true);
    setRelationshipsError(null);

    getEntityRelationships(item.id, item.entityKind || 'license')
      .then((relationships) => {
        if (!isCancelled) {
          setEntityRelationships(relationships);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setEntityRelationships([]);
          setRelationshipsError('Unable to load ownership and operator roles right now.');
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingRelationships(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, item?.id]);

  // Load persisted legal/litigation events when the dossier opens. The AI
  // extraction path runs inside /api/ai/analyze, so this read is cheap and
  // safe to repeat — the backend just returns whatever is in legal_events.
  useEffect(() => {
    let isCancelled = false;
    if (!isOpen || !item) {
      setLegalEvents([]);
      setLegalEventsError(null);
      setIsLoadingLegalEvents(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoadingLegalEvents(true);
    setLegalEventsError(null);

    getLegalEvents(item.id, item.entityKind || 'license')
      .then((events) => {
        if (!isCancelled) {
          setLegalEvents(events);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setLegalEvents([]);
          setLegalEventsError('Unable to load legal history right now.');
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingLegalEvents(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, item?.id]);

  useEffect(() => {
    if (commodityLabels.length === 0) {
      setSelectedCommodity('');
      return;
    }
    setSelectedCommodity((current) =>
      commodityLabels.includes(current) ? current : commodityLabels[0]
    );
  }, [commodityLabels, item?.id]);

  // Reset edit state when item changes
  useEffect(() => {
    setIsEditing(false);
    setEditDraft({});
  }, [item?.id]);

  const startEdit = () => {
    setEditDraft({
      notes: annotation.notes || annotation.comment || '',
      contactPerson: annotation.contactPerson || item?.contactPerson || '',
      phoneNumber: annotation.phoneNumber || item?.phoneNumber || '',
      quantity: annotation.quantity ?? item?.capacity ?? 0,
      price: annotation.price ?? item?.pricePerKg ?? 0,
      stage: annotation.stage || 'New',
    });
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (!item) return;
    updateAnnotation(item.id, editDraft);
    setIsEditing(false);
    setEditDraft({});
  };

  if (!item) return null;
  const terminalDetails = isStorageTerminal ? { ...item, ...(storageTerminalDetails || {}) } : item;

  const publicBusinessContacts = entityContacts.filter(
    (contact) => (contact.contactScope || 'public_business') === 'public_business'
  );
  const sourceBackedPhoneContact = publicBusinessContacts.find(
    (contact) => contact.contactType === 'phone' && (contact.discoveredBy || 'open_data') !== 'ai'
  );
  const aiDiscoveredPhoneContacts = publicBusinessContacts.filter(
    (contact) => contact.contactType === 'phone' && contact.discoveredBy === 'ai'
  );
  const publicPhoneContact = sourceBackedPhoneContact || aiDiscoveredPhoneContacts[0];
  const publicWebsiteContact = publicBusinessContacts.find((contact) => contact.contactType === 'website');
  const ddExtractedContacts = latestDdReport?.extractedContacts || [];
  const ddDiscoveredPhones = latestDdReport?.discoveredPhones || [];
  const ddAutoPromotedPhones = ddExtractedContacts.filter(
    (contact) => contact.contactType === 'phone' && contact.autoPromoted
  );
  const ddLastRunLabel = formatDdTimestamp(latestDdReport?.createdAt);

  // Litigation split. We never assume an "either/or" — "subject" is the
  // safe bucket for any case the AI/adapter could not unambiguously classify.
  const legalEventsAsDefendant = legalEvents.filter((event) =>
    ['defendant', 'respondent'].includes((event.role || '').toLowerCase()),
  );
  const legalEventsAsPlaintiff = legalEvents.filter((event) =>
    ['plaintiff', 'petitioner', 'claimant', 'complainant', 'applicant'].includes(
      (event.role || '').toLowerCase(),
    ),
  );
  const legalEventsOther = legalEvents.filter(
    (event) => !legalEventsAsDefendant.includes(event) && !legalEventsAsPlaintiff.includes(event),
  );
  const legalStubOnly =
    legalEvents.length > 0 &&
    legalEvents.every((event) => (event.sourceType || '').toLowerCase() === 'stub_fixture');

  const privateLeadName = annotation.contactPerson || item.contactPerson || t('לא ידוע', 'Not identified');
  const privateLeadPhone = annotation.phoneNumber || item.phoneNumber || '—';
  const sourceKindLabel = formatSourceKindLabel(terminalDetails.sourceKind);
  const coverageStateLabel = formatCoverageStateLabel(terminalDetails.coverageState);
  const roleLabelMap: Record<string, string> = {
    beneficial_owner: 'Beneficial owner',
    parent_company: 'Parent company',
    subsidiary: 'Subsidiary',
    owner: 'Owner',
    license_holder: 'License holder',
    operator: 'Operator',
    manager: 'Manager',
    charterer: 'Charterer',
    trader: 'Trader',
    counterparty: 'Counterparty',
  };
  const roleSummary = Array.from(
    new Set(
      entityRelationships
        .map((relationship) => relationship.relationshipType)
        .filter(Boolean)
        .map((role) => roleLabelMap[role] || role.replaceAll('_', ' '))
    )
  ).join(' · ');
  const ownershipStatusLabel = roleSummary || 'Source-backed split pending';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-white/95 dark:bg-slate-950/95 backdrop-blur-3xl overflow-y-auto"
        >
          {/* Header */}
          <header className="sticky top-0 z-10 w-full bg-white/80 dark:bg-slate-950/80 border-b border-black/5 dark:border-white/5 flex items-center justify-between px-4 sm:px-8 py-3 sm:py-0 sm:h-16 backdrop-blur-md gap-3">
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex flex-col min-w-0">
                <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white uppercase italic tracking-tight truncate">
                  {item.company}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-amber-500/10 text-amber-500 border-none text-[9px] font-black h-4 px-1.5 uppercase shrink-0">
                    {commoditySummaryLabel}
                  </Badge>
                  {commodityLabels.length > 1 && (
                    <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black h-4 px-1.5 uppercase shrink-0">
                      {t('רב-סחורה', 'Multi-commodity')}
                    </Badge>
                  )}
                  {item.sector && (
                    <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border-none text-[9px] font-black h-4 px-1.5 uppercase shrink-0">
                      {item.sector.replaceAll('_', ' ')}
                    </Badge>
                  )}
                  {item.sourceName && (
                    <Badge className="bg-cyan-500/10 text-cyan-500 border-none text-[9px] font-black h-4 px-1.5 uppercase shrink-0">
                      {item.sourceName}
                    </Badge>
                  )}
                  {sourceKindLabel && (
                    <Badge className={getSourceKindBadgeClass(terminalDetails.sourceKind)}>
                      {sourceKindLabel}
                    </Badge>
                  )}
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate">
                    {item.region}, {item.country}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              {onAddToDueDiligence && onRemoveFromDueDiligence && (
                <div className="hidden sm:block w-52">
                  <AddToDueDiligenceButton
                    compact
                    isInQueue={isInDdQueue}
                    onAdd={onAddToDueDiligence}
                    onRemove={onRemoveFromDueDiligence}
                  />
                </div>
              )}
              <Button
                variant="outline"
                className="h-10 border-black/10 dark:border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/5 px-3 sm:px-6 text-slate-600 dark:text-slate-300"
              >
                <LucideShare2 className="w-3.5 h-3.5 sm:mr-2" />
                <span className="hidden sm:inline">{t('שתף', 'Share Report')}</span>
              </Button>
              <Button
                onClick={onClose}
                variant="ghost"
                className="h-10 w-10 p-0 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-full shrink-0"
              >
                <LucideX className="w-6 h-6" />
              </Button>
            </div>
          </header>

          <main className="max-w-[1400px] mx-auto p-4 sm:p-6 md:p-10 pb-16 sm:pb-32">
            {onAddToDueDiligence && onRemoveFromDueDiligence && (
              <div className="sm:hidden mb-6">
                <AddToDueDiligenceButton
                  isInQueue={isInDdQueue}
                  onAdd={onAddToDueDiligence}
                  onRemove={onRemoveFromDueDiligence}
                />
              </div>
            )}
            {/* Deal Lifecycle Strip — driven by annotation.stage */}
            <div className="mb-6 md:mb-10 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                    {t('סטטוס עסקה', 'Deal Lifecycle')}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white uppercase">
                      {LIFECYCLE_STEPS[lifecycleStep]?.label}
                    </span>
                    <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-none text-[9px] font-black ml-1">
                      {currentStage}
                    </Badge>
                  </div>
                </div>
                {/* Steps: horizontal scroll on mobile */}
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {LIFECYCLE_STEPS.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          updateAnnotation(item.id, { stage: LIFECYCLE_TO_STAGE[i] })
                        }
                        className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer min-h-[44px] whitespace-nowrap
                          ${i === lifecycleStep
                            ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-lg shadow-amber-500/20'
                            : i < lifecycleStep
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-black/5 dark:bg-white/5 text-slate-500 border-black/5 dark:border-white/5 hover:bg-black/10 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-slate-300'
                          }`}
                      >
                        <span className="opacity-50">{i + 1}.</span> {step.label}
                      </button>
                      {i < LIFECYCLE_STEPS.length - 1 && (
                        <div className="w-3 h-px bg-black/10 dark:bg-white/10 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <nav className="flex gap-0.5 sm:gap-1 border-b border-black/5 dark:border-white/5 mb-6 md:mb-10 overflow-x-auto no-scrollbar pointer-events-auto">
              {['overview', 'operations', 'exports-imports', 'news', 'satellite', 'owners', 'counterparties', 'intelligence', 'raw-evidence', 'human-notes'].map(tab => {
                const tabLabels: Record<string, string> = {
                  'overview': 'Overview',
                  'operations': 'Operations',
                  'exports-imports': 'Exports and Imports',
                  'news': 'News',
                  'satellite': 'Satellite',
                  'owners': 'Ownership',
                  'counterparties': 'Counterparties',
                  'intelligence': 'AI Due Diligence',
                  'raw-evidence': 'Raw Evidence',
                  'human-notes': 'Human Notes'
                };
                return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 sm:px-6 py-3 sm:py-4 text-[10px] font-black uppercase tracking-widest transition-all relative z-10 whitespace-nowrap min-h-[44px]
                  ${activeTab === tab ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  {tabLabels[tab]}
                  {activeTab === tab && (
                    <motion.div
                      layoutId="tab-underline"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500"
                    />
                  )}
                </button>
              )})}
            </nav>

            {/* EXECUTION TAB */}
            {activeTab === 'execution' && (
              <div className="grid grid-cols-12 gap-6 md:gap-10">
                {/* Left: Checklist */}
                <div className="col-span-12 lg:col-span-7 space-y-6">
                  <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-6 md:p-8">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                      <LucideShieldCheck className="w-4 h-4 text-emerald-500" /> Execution Checklist
                    </h4>
                    <ExecutionChecklist dealId={item.id} dealLabel={item.company} />
                  </div>
                </div>

                {/* Right: Lead Value + Fee Note */}
                <div className="col-span-12 lg:col-span-5 space-y-6">
                  {/* Lead Value Score */}
                  <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-6 md:p-8">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
                      <LucideZap className="w-4 h-4 text-amber-500" /> Lead Value
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-4 leading-relaxed">
                      Internal priority tag for pipeline ranking. Not shared externally.
                    </p>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {(['high', 'medium', 'low'] as LeadValue[]).map(v => {
                        const cfg = {
                          high:   { label: 'High',   color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', active: 'bg-emerald-500 text-white border-emerald-500' },
                          medium: { label: 'Medium', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',     active: 'bg-amber-500 text-slate-950 border-amber-500' },
                          low:    { label: 'Low',    color: 'bg-slate-500/20 text-slate-400 border-slate-500/30',     active: 'bg-slate-500 text-white border-slate-500' },
                        }[v];
                        const isActive = (annotation.leadValue || 'medium') === v;
                        return (
                          <button
                            key={v}
                            onClick={() => updateAnnotation(item.id, { leadValue: v })}
                            className={`py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${isActive ? cfg.active : cfg.color + ' hover:opacity-80'}`}
                          >
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9px] text-slate-400 leading-relaxed">
                      ⚠ Lead scores are internal workflow aids only — not investment ratings. No financial advice implied.
                    </p>
                  </div>

                  {/* Broker Fee Note */}
                  <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-6 md:p-8">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-3">
                      <LucidePencil className="w-4 h-4 text-amber-500" /> Fee / Margin Note
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-4 leading-relaxed">
                      Private note for broker margin, commission structure, or deal economics. Stored locally only.
                    </p>
                    <textarea
                      className="w-full text-xs bg-white dark:bg-slate-900 border border-black/10 dark:border-white/10 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 outline-none focus:border-amber-400 transition-colors resize-none h-28"
                      placeholder="e.g. 3% broker margin on CIF value, split 50/50 with partner..."
                      value={annotation.feeNote || ''}
                      onChange={e => updateAnnotation(item.id, { feeNote: e.target.value })}
                    />
                    <p className="text-[9px] text-amber-500/80 mt-2 leading-relaxed">
                      ⚠ This field is a private workflow note only — not legal, tax, or financial advice. Consult licensed professionals before structuring any fee arrangement.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* EXPORTS / IMPORTS TAB */}
            {activeTab === 'exports-imports' && (
              isOilAndGas
                ? <OilTradeContext country={item.country} category={oilCategory} />
                : <TradeContext item={item} />
            )}

            {/* LOGS TAB */}
            {activeTab === 'logs' && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">
                  Activity Log — {item.company}
                </p>
                {activityLogs.length === 0 ? (
                  <div className="text-center py-16 text-slate-600 text-sm font-bold">
                    No recorded activity for this license yet.
                  </div>
                ) : (
                  activityLogs.map((log: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-start gap-4 p-4 bg-black/5 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5"
                    >
                      <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">
                          {log.action}
                        </span>
                        <span className="text-sm text-slate-900 dark:text-white font-medium">{log.details}</span>
                        <span className="text-[9px] text-slate-500">
                          {log.username} ·{' '}
                          {new Date(log.timestamp || log.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TECH SPECS TAB */}
            {activeTab === 'tech-specs' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-8 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-8">
                <SpecItem label="License ID" value={`#${item.id}`} />
                <SpecItem label="License Type" value={item.licenseType || 'N/A'} />
                <SpecItem
                  label="Commodity"
                  value={commodityListLabel || 'N/A'}
                  isGold={commodityListLabel.toLowerCase().includes('gold')}
                />
                <SpecItem label="Status" value={item.status || 'N/A'} />
                <SpecItem label="Country" value={item.country || 'N/A'} />
                <SpecItem label="Region" value={item.region || 'N/A'} />
                <SpecItem
                  label="Coordinates"
                  value={`${item.lat?.toFixed(4)}, ${item.lng?.toFixed(4)}`}
                />
                {item.date && <SpecItem label="Date Issued" value={item.date} />}
                {(item.phoneNumber || annotation.phoneNumber) && (
                  <SpecItem label="Phone" value={item.phoneNumber || annotation.phoneNumber || ''} />
                )}
                {(item.contactPerson || annotation.contactPerson) && (
                  <SpecItem
                    label="Contact"
                    value={item.contactPerson || annotation.contactPerson || ''}
                  />
                )}
              </div>
            )}

            {/* OWNERS TAB */}
            {activeTab === 'owners' && (
              <div className="space-y-4 max-w-2xl">
                <div className="p-6 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        Role breakdown
                      </p>
                      <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase">
                        {item.company}
                      </h3>
                    </div>
                    {roleSummary && (
                      <Badge className="bg-cyan-500/10 text-cyan-400 border-none text-[9px] font-black uppercase tracking-widest shrink-0">
                        {roleSummary}
                      </Badge>
                    )}
                  </div>

                  {isLoadingRelationships ? (
                    <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
                        Loading ownership roles
                      </p>
                    </div>
                  ) : (
                    <EntityRelationshipPanel
                      relationships={entityRelationships}
                      emptyTitle="No verified owner/operator split yet"
                      emptyMessage="This dossier stays explicit about uncertainty. When the source only exposes one named company, we do not invent extra ownership roles."
                    />
                  )}

                  {relationshipsError && (
                    <p className="text-[10px] text-red-500 font-bold">{relationshipsError}</p>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <SpecItem label="Country" value={item.country || 'N/A'} />
                    <SpecItem label="Region" value={item.region || 'N/A'} />
                    <SpecItem
                      label="Contact Person"
                      value={
                        item.contactPerson ||
                        annotation.contactPerson ||
                        'Not on record'
                      }
                    />
                    <SpecItem
                      label="Phone"
                      value={item.phoneNumber || annotation.phoneNumber || 'Not on record'}
                    />
                  </div>
                </div>
                {isOilAndGas && (
                  <MaritimeContextPanel
                    query={{
                      company: item.company,
                      country: item.country,
                      commodity: commodityListLabel,
                      lat: item.lat,
                      lng: item.lng,
                    }}
                    section="owners"
                  />
                )}
              </div>
            )}

            {/* COUNTERPARTIES TAB */}
            {activeTab === 'counterparties' && (
              <div className="max-w-3xl space-y-4">
                {isOilAndGas ? (
                  <MaritimeContextPanel
                    query={{
                      company: item.company,
                      country: item.country,
                      commodity: commodityListLabel,
                      lat: item.lat,
                      lng: item.lng,
                    }}
                    section="counterparties"
                  />
                ) : (
                  <div className="p-6 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
                      Counterparty context
                    </p>
                    <p className="text-sm text-slate-500">
                      Counterparty proxies are currently enabled for oil and gas maritime workflows.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* RAW EVIDENCE TAB */}
            {activeTab === 'raw-evidence' && (
              <div className="max-w-3xl space-y-4">
                <div className="p-6 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl space-y-3">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Source provenance
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <SpecItem label="Primary Source" value={terminalDetails.sourceName || 'Manual / local'} />
                    <SpecItem label="Source Class" value={sourceKindLabel || 'Unknown'} />
                    <SpecItem label="Source ID" value={terminalDetails.sourceId || 'N/A'} />
                    <SpecItem label="Coverage State" value={coverageStateLabel || 'N/A'} />
                    <SpecItem label="Source URL" value={terminalDetails.sourceUrl || 'N/A'} />
                    <SpecItem label="Record URL" value={terminalDetails.sourceRecordUrl || 'N/A'} />
                    <SpecItem label="Source Updated" value={terminalDetails.sourceUpdatedAt || 'N/A'} />
                    <SpecItem label="Last Synced" value={terminalDetails.lastSyncedAt || 'N/A'} />
                  </div>
                  {terminalDetails.provenanceNote && (
                    <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {terminalDetails.provenanceNote}
                    </p>
                  )}
                </div>
                <div className="p-6 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl space-y-3">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Stored DD output
                  </p>
                  {isLoadingDdReport ? (
                    <p className="text-[11px] text-slate-500">Loading the last saved DD run...</p>
                  ) : latestDdReport ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <SpecItem label="Last Run" value={ddLastRunLabel || 'Just now'} />
                        <SpecItem label="Analysis Provider" value={latestDdReport.provider || 'Unknown'} />
                        <SpecItem label="Extracted Contacts" value={String(ddExtractedContacts.length)} />
                        <SpecItem label="Auto-Promoted Phones" value={String(ddAutoPromotedPhones.length)} />
                      </div>
                      {ddExtractedContacts.slice(0, 2).map((contact, index) => (
                        <div
                          key={`${contact.contactType}-${contact.value}-${index}`}
                          className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4"
                        >
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <Badge className="bg-indigo-500/10 text-indigo-400 border-none text-[9px] font-black uppercase">
                              {formatContactTypeLabel(contact.contactType)}
                            </Badge>
                            {contact.autoPromoted && (
                              <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black uppercase">
                                Auto-promoted
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-black text-slate-900 dark:text-white break-all">
                            {contact.value}
                          </p>
                          {contact.evidenceSnippet && (
                            <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                              {contact.evidenceSnippet}
                            </p>
                          )}
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      No saved DD run yet. Running the scan stores the analysis and any source-backed contact extraction for reuse.
                    </p>
                  )}
                </div>
                {isStorageTerminal && (
                  <div className="space-y-3">
                    {isLoadingStorageTerminal ? (
                      <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                          Loading open-source evidence
                        </p>
                      </div>
                    ) : (
                      (storageTerminalDetails?.evidence || []).map((evidence) => (
                        <div
                          key={evidence.id}
                          className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-900 dark:text-white">
                                {evidence.title}
                              </p>
                              <p className="mt-1 text-[10px] text-slate-500">
                                {evidence.source_label} · {Math.round(evidence.confidence * 100)}%
                              </p>
                              {evidence.summary && (
                                <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                                  {evidence.summary}
                                </p>
                              )}
                            </div>
                            {evidence.url && (
                              <a
                                href={evidence.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] font-black uppercase tracking-widest text-cyan-500 shrink-0"
                              >
                                {t('צפה במקור', 'View source')}
                              </a>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {isOilAndGas && (
                  <MaritimeContextPanel
                    query={{
                      company: terminalDetails.company,
                      country: terminalDetails.country,
                      commodity: commodityListLabel,
                      lat: terminalDetails.lat,
                      lng: terminalDetails.lng,
                    }}
                    section="evidence"
                  />
                )}
                {isPortLogistics && (
                  <PortLogisticsPanel item={terminalDetails} section="evidence" />
                )}
              </div>
            )}

            {/* INTELLIGENCE TAB */}
            {activeTab === 'intelligence' && (
              <div className="max-w-3xl space-y-6">
                <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-6">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <Badge className="bg-indigo-500/10 text-indigo-400 border-none text-[9px] font-black uppercase">
                      {latestDdReport?.provider || 'AI DD'}
                    </Badge>
                    {ddLastRunLabel && (
                      <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border-none text-[9px] font-black uppercase">
                        Saved {ddLastRunLabel}
                      </Badge>
                    )}
                    {ddAutoPromotedPhones.length > 0 && (
                      <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black uppercase">
                        {ddAutoPromotedPhones.length} phone synced
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Persisted DD runs are reused when this dossier opens again. Public business phones only sync when the source snapshot includes explicit evidence, a source URL or source name, and a high-confidence business label.
                  </p>
                  {ddExtractedContacts.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {ddExtractedContacts.slice(0, 3).map((contact, index) => (
                        <div
                          key={`${contact.contactType}-${contact.value}-${index}`}
                          className="rounded-2xl border border-black/5 dark:border-white/5 bg-white/60 dark:bg-slate-950/60 p-4"
                        >
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <Badge className="bg-amber-500/15 text-amber-500 border-none text-[9px] font-black uppercase">
                              {formatContactTypeLabel(contact.contactType)}
                            </Badge>
                            {contact.confidence != null && (
                              <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black uppercase">
                                {formatConfidenceLabel(contact.confidence) || 'Review source'}
                              </Badge>
                            )}
                            {contact.autoPromoted && (
                              <Badge className="bg-cyan-500/10 text-cyan-500 border-none text-[9px] font-black uppercase">
                                In contacts DB
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-black text-slate-900 dark:text-white break-all">
                            {contact.value}
                          </p>
                          {contact.label && (
                            <p className="mt-1 text-[10px] text-slate-500">{contact.label}</p>
                          )}
                          {contact.evidenceSnippet && (
                            <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                              {contact.evidenceSnippet}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-3xl p-8">
                  <h4 className="text-[12px] font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <LucideBrain className="w-4 h-4" /> AI Intelligence Report
                  </h4>
                  <div className="min-h-[150px] w-full max-h-[min(70vh,640px)] overflow-y-auto pr-1">
                    {isAnalyzing || isLoadingDdReport ? (
                      <div className="flex min-h-[150px] flex-col items-center justify-center gap-3">
                        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[10px] font-black text-indigo-400 uppercase animate-pulse text-center px-2">
                          {isAnalyzing ? 'Analyzing Intelligence...' : 'Loading saved DD...'}
                        </span>
                        {isAnalyzing && aiSlowNetworkHint && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 text-center max-w-xs leading-relaxed">
                            Still working — slow networks or busy AI hosts can take over a minute.
                          </span>
                        )}
                      </div>
                    ) : aiAnalysis.trim() ? (
                      <AiIntelligenceReport content={aiAnalysis} />
                    ) : (
                      <div className="space-y-2 py-4">
                        <p className="text-sm text-slate-400 leading-relaxed">
                          {t('אין ניתוח עדיין. לחץ להרצה.', 'No analysis yet. Use the button below to run a scan.')}
                        </p>
                        {aiAnalysisError && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">{aiAnalysisError}</p>
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={runAiAnalysis}
                    disabled={isAnalyzing || isLoadingDdReport}
                    className="mt-6 w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-[10px]"
                  >
                    {isAnalyzing ? 'Analyzing...' : 'Re-Run Intelligence Scan'}
                  </Button>
                </div>

                {/* ── Litigation history ── */}
                <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-6 space-y-5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <LucideScale className="w-4 h-4 text-amber-500" /> Litigation &amp; Regulatory History
                    </h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      {isLoadingLegalEvents && (
                        <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border-none text-[9px] font-black uppercase">
                          Loading
                        </Badge>
                      )}
                      {!isLoadingLegalEvents && legalEvents.length > 0 && (
                        <Badge className="bg-amber-500/15 text-amber-500 border-none text-[9px] font-black uppercase">
                          {legalEvents.length} events
                        </Badge>
                      )}
                      {legalStubOnly && (
                        <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border-none text-[9px] font-black uppercase">
                          Stub feed
                        </Badge>
                      )}
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Public lawsuits, regulatory actions, and arbitration matters tied to this entity.
                    Configure <code className="font-mono">COURTLISTENER_API_KEY</code>,{' '}
                    <code className="font-mono">PACER_API_TOKEN</code>, or a KYB provider key to replace the stub
                    feed with live data. AI-extracted events appear alongside adapter-sourced rows and are
                    re-fingerprinted so re-running DD does not duplicate cases.
                  </p>

                  {legalEventsError && (
                    <p className="text-[10px] text-red-500 font-bold">{legalEventsError}</p>
                  )}

                  <LegalEventSection
                    title="Litigation — as defendant"
                    description="Cases where this entity (or a closely-related party) was sued, prosecuted, or named as respondent."
                    icon={LucideGavel}
                    accentClass="text-red-400"
                    badgeClass="bg-red-500/10 text-red-400"
                    events={legalEventsAsDefendant}
                  />
                  <LegalEventSection
                    title="Litigation — as plaintiff"
                    description="Cases this entity has initiated against counterparties, contractors, or regulators."
                    icon={LucideScale}
                    accentClass="text-emerald-400"
                    badgeClass="bg-emerald-500/10 text-emerald-400"
                    events={legalEventsAsPlaintiff}
                  />
                  {legalEventsOther.length > 0 && (
                    <LegalEventSection
                      title="Other legal events"
                      description="Cases where the AI/adapter could not unambiguously assign a plaintiff/defendant role yet."
                      icon={LucideScale}
                      accentClass="text-slate-400"
                      badgeClass="bg-slate-500/10 text-slate-400"
                      events={legalEventsOther}
                    />
                  )}

                  {!isLoadingLegalEvents && legalEvents.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4">
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        No legal history on record. Running a fresh DD scan will trigger the AI legal extractor
                        and the configured litigation adapters.
                      </p>
                    </div>
                  )}
                </div>

                {/* ── AI-discovered public phones ── */}
                <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-6 space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <LucidePhone className="w-4 h-4 text-emerald-500" /> Phones discovered by AI
                    </h4>
                    {(ddDiscoveredPhones.length > 0 || aiDiscoveredPhoneContacts.length > 0) && (
                      <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black uppercase">
                        {Math.max(ddDiscoveredPhones.length, aiDiscoveredPhoneContacts.length)} on file
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    These numbers were located by the AI during a DD run and persisted to{' '}
                    <code className="font-mono">entity_contacts</code> with{' '}
                    <code className="font-mono">discovered_by='ai'</code> and confidence capped at 0.7.
                    They show up everywhere a public business phone is rendered — including the dossier card
                    and the map popup — but stay clearly distinguishable from source-backed numbers so an
                    analyst can verify them before promoting.
                  </p>

                  {aiDiscoveredPhoneContacts.length === 0 && ddDiscoveredPhones.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4">
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        No AI-discovered phones yet. Re-run the DD scan above and the AI will attempt to locate
                        public business numbers (head office, switchboard, reception) for this entity.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {aiDiscoveredPhoneContacts.map((contact) => (
                        <div
                          key={contact.id}
                          className="rounded-2xl border border-emerald-500/20 bg-white/60 dark:bg-slate-950/60 p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <Badge className="bg-emerald-500/15 text-emerald-500 border-none text-[9px] font-black uppercase">
                              AI-discovered
                            </Badge>
                            <Badge className="bg-cyan-500/10 text-cyan-500 border-none text-[9px] font-black uppercase">
                              In contacts DB
                            </Badge>
                            {contact.phoneVerifiedAt && (
                              <Badge className="bg-amber-500/15 text-amber-500 border-none text-[9px] font-black uppercase">
                                Verified
                              </Badge>
                            )}
                            {contact.confidenceScore != null && (
                              <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border-none text-[9px] font-black uppercase">
                                {Math.round((contact.confidenceScore || 0) * 100)}% confidence
                              </Badge>
                            )}
                          </div>
                          <a
                            href={`tel:${contact.value}`}
                            className="block text-sm font-black text-slate-900 dark:text-white break-all hover:text-emerald-500 transition-colors"
                          >
                            {contact.value}
                          </a>
                          {contact.label && (
                            <p className="mt-1 text-[10px] text-slate-500">{contact.label}</p>
                          )}
                          {contact.sourceUrl && (
                            <a
                              href={contact.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-block text-[10px] font-black uppercase tracking-widest text-cyan-500 hover:text-cyan-400"
                            >
                              View source
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* NEWS TAB */}
            {activeTab === 'news' && (
              <div className="max-w-3xl space-y-4">
                {[
                  {
                    title: `Search news about ${item.company}`,
                    url: `https://www.google.com/search?q=${encodeURIComponent(item.company + ' mining')}&tbm=nws`,
                    source: 'Google News',
                  },
                  {
                    title: `${commoditySearchLabel} market news`,
                    url: `https://www.google.com/search?q=${encodeURIComponent(commoditySearchLabel + ' mining market')}&tbm=nws`,
                    source: 'Google News',
                  },
                  {
                    title: `Mining news: ${item.country}`,
                    url: `https://www.google.com/search?q=${encodeURIComponent(item.country + ' mining industry news')}&tbm=nws`,
                    source: 'Google News',
                  },
                ].map((newsItem, i) => (
                  <a
                    key={i}
                    href={newsItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-5 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-2xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors group"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">
                        {newsItem.source}
                      </span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-amber-500 dark:group-hover:text-amber-400 transition-colors">
                        {newsItem.title}
                      </span>
                    </div>
                    <LucideShare2 className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-slate-900 dark:group-hover:text-white transition-colors shrink-0 ml-4" />
                  </a>
                ))}
              </div>
            )}

            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <div className="grid grid-cols-12 gap-4 sm:gap-8">
                {/* Left Column */}
                <div className="col-span-12 lg:col-span-8 space-y-4 sm:space-y-8">
                  {/* Hero Visual */}
                  <Card className="bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 overflow-hidden rounded-3xl relative">
                    <div className="absolute inset-0 z-10 pointer-events-none opacity-20 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
                    <div className="h-[200px] sm:h-[400px] w-full relative">
                      <img
                        src={heroImageUrl}
                        className="w-full h-full object-cover grayscale-[20%] hover:grayscale-0 transition-all duration-1000"
                        alt="Commodity Visual"
                      />
                      <div className="absolute top-0 left-0 w-full h-px bg-cyan-500/50 animate-[scan_3s_ease-in-out_infinite]" />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                      <div className="absolute bottom-4 sm:bottom-8 left-4 sm:left-8 right-4 sm:right-8 flex justify-between items-end gap-3">
                        <div className="space-y-1 sm:space-y-2 min-w-0">
                          <Badge className="bg-amber-500 text-slate-950 border-none font-black text-[10px] px-3 h-6 uppercase tracking-widest">
                            {t('פעיל', 'Live Status: Operational')}
                          </Badge>
                          <h3 className="text-xl sm:text-3xl font-black text-white uppercase italic truncate">
                            {item.company}
                          </h3>
                        </div>
                        <Button className="hidden sm:flex bg-white/10 backdrop-blur-md hover:bg-white/20 border border-white/10 text-[10px] font-black uppercase tracking-widest h-12 px-8 text-white shrink-0">
                          <LucideCamera className="w-4 h-4 mr-2" />{' '}
                          {t('גלריית תמונות', 'Photo Gallery (12)')}
                        </Button>
                      </div>
                    </div>
                  </Card>

                  {/* General Specs */}
                  <Card className="bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 rounded-3xl p-4 sm:p-8">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-6 sm:mb-8 flex items-center gap-3">
                      <LucideShieldCheck className="w-4 h-4 text-emerald-500" />{' '}
                      {t('מפרט טכני', 'Technical Specifications')}
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-y-8 gap-x-12">
                      <SpecItem
                        label={t('סוג רשיון', 'License Type')}
                        value={item.licenseType || 'ML'}
                      />
                      <SpecItem
                        label={t('מזהה רשיון', 'License ID')}
                        value={`#${item.id.slice(0, 8)}`}
                      />
                      <SpecItem
                        label={t('סחורה עיקרית', 'Main Commodity')}
                        value={commodityListLabel}
                        isGold={commodityListLabel.toLowerCase().includes('gold')}
                      />
                      <SpecItem label={t('אזור', 'Region')} value={item.region} />
                      <SpecItem label={t('מדינה', 'Country')} value={item.country} />
                      <SpecItem
                        label={t('בעלות', 'Ownership Status')}
                        value={ownershipStatusLabel}
                      />
                      {terminalDetails.entitySubtype && (
                        <SpecItem
                          label={t('סוג תשתית', 'Infrastructure Type')}
                          value={terminalDetails.entitySubtype.replaceAll('_', ' ')}
                        />
                      )}
                      {terminalDetails.operatorName && (
                        <SpecItem
                          label={t('מפעיל', 'Operator')}
                          value={terminalDetails.operatorName}
                        />
                      )}
                      {terminalDetails.nearbyPort?.name && (
                        <SpecItem
                          label={t('נמל קרוב', 'Nearby Port')}
                          value={terminalDetails.nearbyPort.name}
                        />
                      )}
                      {terminalDetails.capacityText && (
                        <SpecItem
                          label={t('קיבולת מסומנת', 'Tagged Capacity')}
                          value={terminalDetails.capacityText}
                        />
                      )}
                      {terminalDetails.confidenceScore != null && (
                        <SpecItem
                          label={t('רמת ביטחון', 'Confidence')}
                          value={`${Math.round((terminalDetails.confidenceScore || 0) * 100)}%`}
                        />
                      )}
                      <SpecItem
                        label={t('נפח מוערך', 'Estimated Volume')}
                        value={`${annotation.quantity ?? item.capacity ?? 0} ${volumeUnit}`}
                      />
                      <SpecItem
                        label={t('שווי מוערך', 'Estimated Valuation')}
                        value={`$${(annotation.price ?? item.pricePerKg ?? 0).toLocaleString()}`}
                      />
                      <SpecItem
                        label={t('ליד פנימי', 'Internal Lead')}
                        value={
                          annotation.contactPerson || item.contactPerson || t('חסוי', 'Confidential')
                        }
                      />
                      {publicPhoneContact && (
                        <SpecItem
                          label={
                            publicPhoneContact.discoveredBy === 'ai'
                              ? t('טלפון (גילוי AI)', 'Public Phone (AI-found)')
                              : t('טלפון ציבורי', 'Public Phone')
                          }
                          value={publicPhoneContact.value}
                        />
                      )}
                      {publicWebsiteContact && (
                        <SpecItem
                          label={t('אתר אינטרנט', 'Website')}
                          value={publicWebsiteContact.value}
                        />
                      )}
                      {item.date && (
                        <SpecItem label={t('תאריך הנפקה', 'Date Issued')} value={item.date} />
                      )}
                      {annotation.notes && (
                        <div className="col-span-2 md:col-span-3">
                          <SpecItem label={t('הערות', 'Notes')} value={annotation.notes} />
                        </div>
                      )}
                    </div>
                  </Card>

                  <Card className="bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 rounded-3xl p-4 sm:p-8">
                    <div className="flex items-center justify-between gap-3 mb-6">
                      <div>
                        <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em]">
                          {t('מפת תפקידים', 'Role Transparency')}
                        </h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2">
                          {t(
                            'בעלים מול מפעיל מול מחזיק רשיון, רק כאשר המקור תומך בכך.',
                            'Owner vs operator vs holder, only when the source actually supports that split.'
                          )}
                        </p>
                      </div>
                      {roleSummary && (
                        <Badge className="bg-cyan-500/10 text-cyan-400 border-none text-[9px] font-black uppercase tracking-widest">
                          {roleSummary}
                        </Badge>
                      )}
                    </div>

                    {isLoadingRelationships ? (
                      <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
                          {t('טוען תפקידי ישות', 'Loading entity roles')}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2">
                          {t('קורא שדות בעלות/הפעלה ממקורות גלויים.', 'Reading owner/operator/holder fields from the source-backed record.')}
                        </p>
                      </div>
                    ) : (
                      <EntityRelationshipPanel
                        relationships={entityRelationships}
                        emptyTitle="No verified role split yet"
                        emptyMessage="This record is visible, but the current source does not yet expose a distinct owner/operator/holder split we can verify."
                      />
                    )}

                    {relationshipsError && (
                      <p className="text-[10px] text-red-500 font-bold mt-3">{relationshipsError}</p>
                    )}
                  </Card>
                  {isPortLogistics && (
                    <PortLogisticsPanel item={terminalDetails} section="summary" />
                  )}
                </div>

                {/* Right Column */}
                <div className="col-span-12 lg:col-span-4 space-y-8">
                  {/* AI Intelligence */}
                  <Card className="bg-indigo-500/10 border-indigo-500/20 rounded-3xl p-8 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-20">
                      <LucideZap className="w-24 h-24 text-indigo-500" />
                    </div>
                    <h4 className="text-[12px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                      <LucideBrain className="w-4 h-4" />{' '}
                      {t('מודיעין Gemini', 'Gemini Intelligence OS')}
                    </h4>
                    <div className="space-y-6">
                      <div className="bg-white/60 dark:bg-slate-950/60 backdrop-blur-md rounded-2xl p-5 border border-indigo-500/20 min-h-[120px] w-full max-h-[min(55vh,520px)] overflow-y-auto">
                        {isAnalyzing || isLoadingDdReport ? (
                          <div className="flex min-h-[120px] flex-col items-center justify-center gap-3">
                            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[10px] font-black text-indigo-400 uppercase animate-pulse text-center px-2">
                              {isAnalyzing
                                ? t('מנתח...', 'Analyzing Intelligence...')
                                : t('טוען DD...', 'Loading saved DD...')}
                            </span>
                            {isAnalyzing && aiSlowNetworkHint && (
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 text-center max-w-xs leading-relaxed">
                                {t(
                                  'רשת איטית — עדיין מעבד',
                                  'Still working — slow networks or busy AI can take over a minute.'
                                )}
                              </span>
                            )}
                          </div>
                        ) : aiAnalysis.trim() ? (
                          <AiIntelligenceReport content={aiAnalysis} className="text-left" />
                        ) : (
                          <div className="space-y-2 py-2">
                            <p className="text-xs text-slate-500 leading-relaxed">
                              {t(
                                'הרץ סריקה לקבלת סיכום',
                                'Run a scan to see a readable briefing here.'
                              )}
                            </p>
                            {aiAnalysisError && (
                              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                                {aiAnalysisError}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        onClick={runAiAnalysis}
                        disabled={isAnalyzing || isLoadingDdReport}
                        className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-[10px] shadow-2xl"
                      >
                        {isAnalyzing
                          ? t('מנתח...', 'Analyzing...')
                          : t('הרץ שוב', 'Re-Run Intelligence Scan')}
                      </Button>
                    </div>
                  </Card>

                  {/* Commodity Market Engine */}
                  <Card className="bg-emerald-500/10 border-emerald-500/20 rounded-3xl p-8 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <LucideZap className="w-20 h-20 text-emerald-500" />
                    </div>
                    <h4 className="text-[12px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                      <LucideBrain className="w-4 h-4" />{' '}
                      {commodityLabels.length > 0 && activeCommodityLabel
                        ? t('מנוע שוק לסחורה', `${activeCommodityLabel} Market Engine`)
                        : t('מנוע שוק לסחורה', 'Commodity Market Engine')}
                    </h4>
                    <div className="space-y-3">
                      {commodityLabels.length === 0 ? (
                        <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-white/60 dark:bg-slate-950/60 p-4">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                            {t('אין סחורה מתויגת', 'No commodity on record')}
                          </p>
                          <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                            {t(
                              'האתר נשאר זמין לבדיקה, אבל מנוע השוק נשאר כבוי עד שמופיע שדה סחורה.',
                              'The dossier stays usable, but market and ROI signals remain disabled until this record carries a commodity field.'
                            )}
                          </p>
                        </div>
                      ) : (
                        <>
                          {commodityLabels.length > 1 && (
                            <div className="flex flex-wrap gap-2">
                              {commodityLabels.map((label) => (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => setSelectedCommodity(label)}
                                  className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-widest transition-colors ${
                                    activeCommodityLabel === label
                                      ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                                      : 'border-black/10 bg-white/70 text-slate-600 hover:bg-white dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                              <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black h-7 px-2 uppercase">
                                {t('רב-סחורה', 'Multi-commodity')}
                              </Badge>
                            </div>
                          )}
                          <div className="flex justify-between items-center bg-white/60 dark:bg-slate-950/60 p-3 rounded-xl border border-black/5 dark:border-white/5">
                            <span className="text-[9px] font-black text-slate-500 uppercase">
                              {activeCommodityMarket.benchmarkLabel}
                            </span>
                            <span
                              className={`text-xs font-black ${
                                activeCommodityMarket.priceOk
                                  ? 'text-amber-500 dark:text-amber-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {activeCommodityMarket.benchmarkDisplayPrice}
                            </span>
                          </div>
                          <div className="flex justify-between items-center bg-white/60 dark:bg-slate-950/60 p-3 rounded-xl border border-black/5 dark:border-white/5">
                            <span className="text-[9px] font-black text-slate-500 uppercase">
                              {t('כיסוי שוק', 'Market Coverage')}
                            </span>
                            <span className="text-xs font-black text-emerald-500 dark:text-emerald-400">
                              {activeCommodityMarket.supportLabel}
                            </span>
                          </div>
                          <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-white/60 dark:bg-slate-950/60 p-4">
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                              {t('הערת כיסוי', 'Coverage Note')}
                            </p>
                            <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                              {activeCommodityMarket.supportDetail}
                            </p>
                            {activeCommodityMarket.benchmarkSymbol && (
                              <p className="mt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                {t('פיד', 'Feed')}: {activeCommodityMarket.benchmarkSymbol}
                              </p>
                            )}
                          </div>
                          {activeCommodityMarket.supportLevel === 'roi_supported' &&
                            activeCommodityMarket.discountPct != null &&
                            activeCommodityMarket.logisticsCost != null &&
                            activeCommodityMarket.netbackPerUnit != null && (
                              <>
                                <div className="flex justify-between items-center bg-white/60 dark:bg-slate-950/60 p-3 rounded-xl border border-black/5 dark:border-white/5">
                                  <span className="text-[9px] font-black text-slate-500 uppercase">
                                    {t('דיסקאונט מקומי', 'Local Discount')}
                                  </span>
                                  <span className="text-xs font-black text-emerald-500 dark:text-emerald-400">
                                    - {activeCommodityMarket.discountPct}%
                                  </span>
                                </div>
                                <div className="flex justify-between items-center bg-white/60 dark:bg-slate-950/60 p-3 rounded-xl border border-black/5 dark:border-white/5">
                                  <span className="text-[9px] font-black text-slate-500 uppercase">
                                    {t('לוגיסטיקה ומיסים', 'Logistics & Taxes')}
                                  </span>
                                  <span className="text-xs font-black text-red-400">
                                    ${activeCommodityMarket.logisticsCost.toLocaleString()} /{' '}
                                    {activeCommodityMarket.logisticsUnit}
                                  </span>
                                </div>
                                <div className="pt-3 border-t border-black/5 dark:border-white/5">
                                  <div className="flex justify-between items-end gap-3">
                                    <div className="flex flex-col">
                                      <span className="text-[9px] font-black text-slate-500 uppercase">
                                        {t(
                                          'רווח נקי משוער',
                                          `Indicative Netback (${activeCommodityLabel})`
                                        )}
                                      </span>
                                      <span className="text-2xl font-black text-emerald-500">
                                        $
                                        {activeCommodityMarket.netbackPerUnit.toLocaleString(undefined, {
                                          maximumFractionDigits: 0,
                                        })}{' '}
                                        / {activeCommodityMarket.netbackUnit}
                                      </span>
                                    </div>
                                    <Badge className="bg-emerald-500 text-slate-950 font-black text-[10px] mb-1">
                                      {activeCommodityMarket.supportLabel}
                                    </Badge>
                                  </div>
                                </div>
                              </>
                            )}
                        </>
                      )}
                      <Button
                        onClick={() => {
                          setIsGeneratingLOI(true);
                          setTimeout(() => {
                            const profitLine =
                              commodityLabels.length === 0
                                ? 'Commodity benchmark: N/A (commodity not tagged on this record)'
                                : activeCommodityMarket.supportLevel === 'roi_supported' &&
                                    activeCommodityMarket.netbackPerUnit != null &&
                                    activeCommodityMarket.netbackUnit
                                  ? `Indicative ${activeCommodityLabel} netback: $${activeCommodityMarket.netbackPerUnit.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${activeCommodityMarket.netbackUnit}`
                                  : activeCommodityMarket.priceOk
                                    ? `${activeCommodityMarket.benchmarkLabel}: ${activeCommodityMarket.benchmarkDisplayPrice} (${activeCommodityMarket.supportDetail})`
                                    : `${activeCommodityLabel || commodityListLabel} benchmark: N/A (${activeCommodityMarket.supportDetail})`;
                            const loi = `LETTER OF INTENT\n\nDate: ${new Date().toLocaleDateString()}\n\nRE: Mining License Acquisition — ${item.company}\n\nTo Whom It May Concern,\n\nWe hereby express our intent to enter into a formal acquisition agreement for the following mining license:\n\nCompany: ${item.company}\nLicense ID: ${item.id}\nCommodity: ${commodityListLabel}\nRegion: ${item.region}, ${item.country}\nLicense Type: ${item.licenseType}\n${profitLine}\n\nThis letter is non-binding and subject to due diligence.\n\nSincerely,\n[Your Name]\n[Company]`;
                            const blob = new Blob([loi], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `LOI_${item.company.replace(/\s+/g, '_')}.txt`;
                            a.click();
                            setIsGeneratingLOI(false);
                          }, 1500);
                        }}
                        disabled={isGeneratingLOI}
                        className="w-full h-12 bg-white text-slate-950 hover:bg-slate-200 font-black uppercase tracking-widest text-[10px] mt-2 shadow-2xl relative overflow-hidden"
                      >
                        {isGeneratingLOI ? (
                          <>
                            <div className="absolute bottom-0 left-0 h-1 bg-emerald-500 animate-[progress_1.5s_linear_infinite]" style={{ width: '100%' }} />
                            {t('מייצר מסמך...', 'Producing Document...')}
                          </>
                        ) : (
                          t('צור מכתב כוונות (LOI)', 'Generate LOI Contract')
                        )}
                      </Button>
                    </div>
                  </Card>

                  {/* Contact Intelligence */}
                  <Card className="bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 rounded-3xl p-8">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                      <LucideUser className="w-4 h-4 text-amber-500" />{' '}
                      {isStorageTerminal
                        ? t('פרופיל תשתית', 'Infrastructure Profile')
                        : t('אנשי קשר ציבוריים', 'Public Business Contacts')}
                    </h4>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                      {isStorageTerminal
                        ? t(
                            'לשכבת האחסון אנחנו מציגים רק פרטי מפעיל/נמל/קיבולת שמופיעים במקור הפתוח עצמו. אין ניחוש של בעלות מסחרית.',
                            'For storage infrastructure we only show operator, port, and capacity fields that appear in the open source itself. Commercial ownership is never guessed.'
                          )
                        : t(
                            'מוצגים כאן רק פרטי קשר עסקיים ציבוריים ומבוססי מקור. לא מוצגים מספרים פרטיים או מידע משוער.',
                            'Only source-backed public business contacts appear here. Private numbers and guessed details are intentionally excluded.'
                          )}
                    </p>
                    <div className="space-y-3">
                      {isStorageTerminal ? (
                        <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
                          <div className="space-y-2">
                            <ReadRow label={t('תת-סוג', 'Subtype')} value={terminalDetails.entitySubtype?.replaceAll('_', ' ') || '—'} />
                            <ReadRow label={t('מפעיל', 'Operator')} value={terminalDetails.operatorName || '—'} />
                            <ReadRow label={t('נמל קרוב', 'Nearby Port')} value={terminalDetails.nearbyPort?.name || '—'} />
                            <ReadRow label={t('מרחק לנמל', 'Port Distance')} value={terminalDetails.nearbyPort?.distance_km != null ? `${terminalDetails.nearbyPort.distance_km} km` : '—'} />
                            <ReadRow label={t('קיבולת מסומנת', 'Tagged Capacity')} value={terminalDetails.capacityText || '—'} />
                            <ReadRow label={t('הסבר ביטחון', 'Confidence Note')} value={terminalDetails.confidenceNote || '—'} wide />
                          </div>
                          {isLoadingStorageTerminal && (
                            <p className="mt-3 text-[10px] text-slate-500">
                              {t('טוען פרטי ראיות מלאים...', 'Loading full evidence details...')}
                            </p>
                          )}
                        </div>
                      ) : isLoadingContacts ? (
                        <div className="flex min-h-[120px] items-center justify-center rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5">
                          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                            <div className="h-4 w-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
                            {t('טוען מקורות קשר', 'Loading contact sources')}
                          </div>
                        </div>
                      ) : publicBusinessContacts.length > 0 ? (
                        publicBusinessContacts.map((contact) => {
                          const href = buildContactHref(contact);
                          const sourceDate = formatContactTimestamp(contact.verifiedAt || contact.lastSeenAt);
                          const confidenceLabel = formatConfidenceLabel(contact.confidenceScore);
                          const ContactIcon = getContactIcon(contact.contactType);
                          const displayLabel =
                            contact.label && contact.label.toLowerCase() !== contact.contactType.toLowerCase()
                              ? contact.label
                              : formatContactTypeLabel(contact.contactType);

                          return (
                            <div
                              key={contact.id}
                              className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <Badge className="bg-amber-500/15 text-amber-500 border-none text-[9px] font-black uppercase">
                                      {formatContactTypeLabel(contact.contactType)}
                                    </Badge>
                                    {confidenceLabel && (
                                      <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black uppercase">
                                        {confidenceLabel}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                                    {displayLabel}
                                  </div>
                                  {href ? (
                                    <a
                                      href={href}
                                      target={contact.contactType === 'website' ? '_blank' : undefined}
                                      rel={contact.contactType === 'website' ? 'noreferrer' : undefined}
                                      className="block text-sm font-black text-slate-900 dark:text-white break-all hover:text-amber-500 transition-colors"
                                    >
                                      {contact.value}
                                    </a>
                                  ) : (
                                    <div className="text-sm font-black text-slate-900 dark:text-white break-words">
                                      {contact.value}
                                    </div>
                                  )}
                                  <div className="mt-3 space-y-1">
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                      {contact.sourceName || t('מקור פומבי', 'Public source')}
                                      {sourceDate ? ` · ${sourceDate}` : ''}
                                    </p>
                                    {contact.extractedFrom && (
                                      <p className="text-[10px] text-slate-400 dark:text-slate-500 break-all">
                                        {t('שדה מקור', 'Source field')}: {contact.extractedFrom}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-3 shrink-0">
                                  <div className="h-10 w-10 rounded-full bg-white/60 dark:bg-slate-950/60 border border-black/5 dark:border-white/5 flex items-center justify-center text-emerald-500">
                                    <ContactIcon className="w-4 h-4" />
                                  </div>
                                  {contact.sourceUrl && (
                                    <a
                                      href={contact.sourceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[10px] font-black uppercase tracking-widest text-cyan-500 hover:text-cyan-400"
                                    >
                                      {t('צפה במקור', 'View source')}
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4">
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
                            {t('אין עדיין פרטי קשר ציבוריים מאומתים.', 'No verified public contacts on record yet.')}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            {t(
                              'כאשר המקורות הרשמיים לא מפרסמים טלפון, אימייל או אתר ברור, אנחנו משאירים את האזור ריק במקום לנחש.',
                              'When official/open sources do not publish a clear phone, email, website, or address, this section stays empty instead of guessing.'
                            )}
                          </p>
                        </div>
                      )}

                      {contactsError && (
                        <p className="text-[10px] text-red-500 font-bold">{contactsError}</p>
                      )}

                      <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-white/60 dark:bg-slate-950/60 p-4">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">
                          {t('הערות ליד פנימיות', 'Internal Lead Notes')}
                        </div>
                        <div className="space-y-2">
                          <ReadRow label={t('איש קשר', 'Lead')} value={privateLeadName} />
                          <ReadRow label={t('טלפון', 'Phone Note')} value={privateLeadPhone} />
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Tactical Pipeline Status */}
                  <Card className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-3xl p-8">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                      <LucideZap className="w-4 h-4 text-emerald-500" />{' '}
                      {t('מצב צנרת', 'Pipeline State')}
                    </h4>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { id: 'good', label: t('עסקה', 'Deal'), color: 'bg-emerald-500' },
                        { id: 'maybe', label: t('בדיקה', 'Assay'), color: 'bg-amber-500' },
                        { id: 'bad', label: t('ליד', 'Lead'), color: 'bg-red-500' },
                      ].map(s => {
                        const isActive = annotation.status === s.id;
                        return (
                          <button
                            key={s.id}
                            onClick={e => {
                              e.stopPropagation();
                              updateAnnotation(item.id, { status: s.id as any });
                            }}
                            className={`flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all active:scale-95 cursor-pointer relative z-50
                              ${isActive
                                ? `${s.color}/20 border-black/20 dark:border-white/30 shadow-[0_0_15px_rgba(0,0,0,0.3)]`
                                : 'bg-black/5 dark:bg-white/5 border-transparent hover:bg-black/10 dark:hover:bg-white/10'}`}
                          >
                            <div
                              className={`w-2.5 h-2.5 rounded-full ${s.color} ${isActive ? 'animate-pulse' : 'opacity-40'}`}
                            />
                            <span
                              className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}
                            >
                              {s.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Card>

                  {/* CRM Edit Section */}
                  <Card className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-3xl p-8">
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] flex items-center gap-3">
                        <LucidePencil className="w-4 h-4 text-slate-400" />{' '}
                        {t('עריכת עסקה', 'Edit Deal')}
                      </h4>
                      {!isEditing ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={startEdit}
                          className="h-8 px-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-black/5 dark:border-white/5"
                        >
                          <LucidePencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={saveEdit}
                          className="h-8 px-3 text-[10px] font-black uppercase tracking-widest bg-amber-500 text-slate-950 hover:bg-amber-400"
                        >
                          <LucideCheck className="w-3 h-3 mr-1" /> Save
                        </Button>
                      )}
                    </div>

                    {!isEditing ? (
                      <div className="space-y-3">
                        <ReadRow
                          label={t('שלב', 'Stage')}
                          value={annotation.stage || 'New'}
                        />
                        <ReadRow
                          label={t('איש קשר', 'Contact')}
                          value={annotation.contactPerson || item.contactPerson || '—'}
                        />
                        <ReadRow
                          label={t('טלפון', 'Phone')}
                          value={annotation.phoneNumber || item.phoneNumber || '—'}
                        />
                        <ReadRow
                          label={t('נפח (KG)', 'Volume (KG)')}
                          value={String(annotation.quantity ?? item.capacity ?? 0)}
                        />
                        <ReadRow
                          label={t('שווי ($)', 'Valuation ($)')}
                          value={String(annotation.price ?? item.pricePerKg ?? 0)}
                        />
                        <ReadRow
                          label={t('הערות', 'Notes')}
                          value={annotation.notes || annotation.comment || '—'}
                          wide
                        />
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                            {t('שלב בצנרת', 'Pipeline Stage')}
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {(['New', 'Contacted', 'Diligence', 'Verified', 'Closed'] as const).map(s => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setEditDraft(d => ({ ...d, stage: s }))}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all
                                  ${editDraft.stage === s
                                    ? 'bg-amber-500 text-slate-950 border-amber-500'
                                    : 'bg-black/5 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-black/10 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/10'}`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                        <EditField
                          label={t('איש קשר', 'Contact Person')}
                          value={editDraft.contactPerson || ''}
                          onChange={v => setEditDraft(d => ({ ...d, contactPerson: v }))}
                        />
                        <EditField
                          label={t('טלפון', 'Phone')}
                          value={editDraft.phoneNumber || ''}
                          onChange={v => setEditDraft(d => ({ ...d, phoneNumber: v }))}
                          type="tel"
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <EditField
                            label={t('נפח (KG)', 'Volume (KG)')}
                            value={String(editDraft.quantity ?? '')}
                            onChange={v => setEditDraft(d => ({ ...d, quantity: parseFloat(v) || 0 }))}
                            type="number"
                          />
                          <EditField
                            label={t('שווי ($)', 'Valuation ($)')}
                            value={String(editDraft.price ?? '')}
                            onChange={v => setEditDraft(d => ({ ...d, price: parseFloat(v) || 0 }))}
                            type="number"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                            {t('הערות', 'Notes')}
                          </label>
                          <textarea
                            rows={3}
                            value={editDraft.notes || ''}
                            onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                            className="w-full bg-white/60 dark:bg-slate-950/60 border border-black/10 dark:border-white/10 rounded-xl text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 px-3 py-2 resize-none outline-none focus:border-amber-500/50 transition-colors"
                            placeholder={t('הוסף הערות...', 'Add notes...')}
                          />
                        </div>
                      </div>
                    )}
                    {onDeleteLicense && (
                      <div className="mt-8 pt-6 border-t border-red-500/20">
                        <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">
                          {t('אזור מסוכן', 'Danger zone')}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full h-11 text-[10px] font-black uppercase tracking-widest border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:border-red-500/30 dark:hover:bg-red-500/15"
                          onClick={onDeleteLicense}
                        >
                          <LucideTrash2 className="w-4 h-4 mr-2 shrink-0" />
                          {t('מחק רישיון לצמיתות', 'Delete license permanently')}
                        </Button>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            )}
          </main>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function formatSourceKindLabel(sourceKind?: string | null): string | null {
  switch ((sourceKind || '').toLowerCase()) {
    case 'official_registry':
      return 'Official registry';
    case 'global_open_fallback':
      return 'Global fallback';
    case 'user_import_csv':
      return 'User CSV';
    case 'bundled_json':
      return 'Bundled fallback';
    default:
      return null;
  }
}

function getSourceKindBadgeClass(sourceKind?: string | null): string {
  switch ((sourceKind || '').toLowerCase()) {
    case 'official_registry':
      return 'bg-cyan-500/10 text-cyan-500 border-none text-[9px] font-black h-4 px-1.5 uppercase shrink-0';
    case 'global_open_fallback':
      return 'bg-violet-500/10 text-violet-500 border-none text-[9px] font-black h-4 px-1.5 uppercase shrink-0';
    case 'user_import_csv':
      return 'bg-amber-500/10 text-amber-500 border-none text-[9px] font-black h-4 px-1.5 uppercase shrink-0';
    default:
      return 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border-none text-[9px] font-black h-4 px-1.5 uppercase shrink-0';
  }
}

function formatCoverageStateLabel(coverageState?: string | null): string | null {
  switch ((coverageState || '').toLowerCase()) {
    case 'official_syncable':
      return 'Official syncable';
    case 'global_fallback_only':
      return 'Global fallback only';
    case 'user_import_csv':
      return 'User CSV fallback';
    case 'bundled_json':
      return 'Bundled fallback';
    default:
      return coverageState || null;
  }
}

function formatContactTypeLabel(contactType: string): string {
  switch (contactType) {
    case 'phone':
      return 'Phone';
    case 'email':
      return 'Email';
    case 'website':
      return 'Website';
    case 'address':
      return 'Address';
    default:
      return contactType.replaceAll('_', ' ');
  }
}

function formatConfidenceLabel(confidence?: number | null): string | null {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return null;
  }
  if (confidence >= 0.9) return 'High confidence';
  if (confidence >= 0.75) return 'Medium confidence';
  return 'Review source';
}

function formatContactTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return `Verified ${parsed.toLocaleDateString()}`;
}

function formatDdTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

function buildContactHref(contact: EntityContact): string | null {
  if (contact.contactType === 'phone') {
    return `tel:${contact.value}`;
  }
  if (contact.contactType === 'email') {
    return `mailto:${contact.value}`;
  }
  if (contact.contactType === 'website') {
    return /^https?:\/\//i.test(contact.value) ? contact.value : `https://${contact.value}`;
  }
  return null;
}

function getContactIcon(contactType: string) {
  switch (contactType) {
    case 'phone':
      return LucidePhone;
    case 'email':
      return LucideMail;
    case 'website':
      return LucideGlobe;
    case 'address':
      return LucideMapPin;
    default:
      return LucideUser;
  }
}

function SpecItem({
  label,
  value,
  isGold,
}: {
  label: string;
  value: string;
  isGold?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
      <span
        className={`text-[13px] font-black uppercase tracking-tight ${
          isGold
            ? 'text-amber-500 dark:text-amber-400 underline decoration-amber-500/30 underline-offset-4'
            : 'text-slate-700 dark:text-slate-200'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ReadRow({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`flex ${wide ? 'flex-col gap-1' : 'justify-between items-center'} py-2 border-b border-black/5 dark:border-white/5 last:border-0`}>
      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest shrink-0">
        {label}
      </span>
      <span className="text-xs font-bold text-slate-600 dark:text-slate-300 text-right">{value}</span>
    </div>
  );
}

function LegalEventSection({
  title,
  description,
  icon: Icon,
  accentClass,
  badgeClass,
  events,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  accentClass: string;
  badgeClass: string;
  events: LegalEvent[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h5 className={`text-[10px] font-black uppercase tracking-widest ${accentClass} flex items-center gap-2`}>
          <Icon className="w-3.5 h-3.5" /> {title}
        </h5>
        <Badge className={`${badgeClass} border-none text-[9px] font-black uppercase`}>
          {events.length}
        </Badge>
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">{description}</p>
      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-3">
          <p className="text-[10px] text-slate-500 leading-relaxed">
            No cases on record in this category yet.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <LegalEventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function LegalEventCard({ event }: { event: LegalEvent }) {
  const filedDateLabel = (() => {
    if (!event.filedDate) return null;
    const parsed = new Date(event.filedDate);
    if (Number.isNaN(parsed.getTime())) return event.filedDate;
    return parsed.toLocaleDateString();
  })();

  const statusBadgeClass =
    {
      open: 'bg-amber-500/15 text-amber-500',
      pending: 'bg-amber-500/15 text-amber-500',
      filed: 'bg-amber-500/15 text-amber-500',
      active: 'bg-amber-500/15 text-amber-500',
      settled: 'bg-emerald-500/15 text-emerald-500',
      dismissed: 'bg-slate-500/15 text-slate-400',
      closed: 'bg-slate-500/15 text-slate-400',
      concluded: 'bg-slate-500/15 text-slate-400',
      withdrawn: 'bg-slate-500/15 text-slate-400',
      appeal: 'bg-orange-500/15 text-orange-500',
      judgment: 'bg-violet-500/15 text-violet-400',
      judgement: 'bg-violet-500/15 text-violet-400',
    }[(event.status || 'unknown').toLowerCase()] || 'bg-slate-500/15 text-slate-400';

  return (
    <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-white/60 dark:bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge className={`border-none text-[9px] font-black uppercase ${statusBadgeClass}`}>
              {(event.status || 'unknown').toUpperCase()}
            </Badge>
            {event.discoveredBy && (
              <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border-none text-[9px] font-black uppercase">
                {event.discoveredBy.replaceAll('_', ' ')}
              </Badge>
            )}
            {event.confidenceScore != null && (
              <Badge className="bg-indigo-500/10 text-indigo-400 border-none text-[9px] font-black uppercase">
                {Math.round((event.confidenceScore || 0) * 100)}%
              </Badge>
            )}
            {(event.sourceType || '').toLowerCase() === 'stub_fixture' && (
              <Badge className="bg-amber-500/10 text-amber-500 border-none text-[9px] font-black uppercase">
                Stub — awaiting live feed
              </Badge>
            )}
          </div>
          <p className="text-sm font-black text-slate-900 dark:text-white">{event.caseTitle}</p>
          {event.parties && (
            <p className="mt-1 text-[10px] text-slate-500">Parties: {event.parties}</p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-500">
            {event.court && <span>Court: <span className="text-slate-700 dark:text-slate-200">{event.court}</span></span>}
            {event.jurisdiction && <span>Jurisdiction: <span className="text-slate-700 dark:text-slate-200">{event.jurisdiction}</span></span>}
            {filedDateLabel && <span>Filed: <span className="text-slate-700 dark:text-slate-200">{filedDateLabel}</span></span>}
            {event.sourceName && <span>Source: <span className="text-slate-700 dark:text-slate-200">{event.sourceName}</span></span>}
          </div>
          {event.summary && (
            <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">{event.summary}</p>
          )}
        </div>
        {event.sourceUrl && (
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-black uppercase tracking-widest text-cyan-500 hover:text-cyan-400 shrink-0"
          >
            View source
          </a>
        )}
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">
        {label}
      </label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-white/60 dark:bg-slate-950/60 border-black/10 dark:border-white/10 text-sm text-slate-700 dark:text-slate-200 h-9 focus:border-amber-500/50"
      />
    </div>
  );
}
