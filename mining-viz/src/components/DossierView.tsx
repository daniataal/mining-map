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
  AgentJobResponse,
  ContactEnrichmentOutput,
  OperatorValidationOutput,
  DealRoom,
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
  FileText as LucideFileText,
  Upload as LucideUploadCloud,
  AlertTriangle as LucideAlertTriangle,
  CheckCircle2 as LucideCheckCircle2,
  Ship as LucideShip,
  Pin as LucidePin,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AiIntelligenceReport } from './AiIntelligenceReport';
import TradeContext from './TradeContext';
import OilTradeContext from './OilTradeContext';
import ExecutionChecklist from './ExecutionChecklist';
import AddToDueDiligenceButton from './AddToDueDiligenceButton';
import { GraphExplorer } from './GraphExplorer';
import {
  LIFECYCLE_STEPS,
  normalizeDealStage,
  dealStageIndex,
  dealStageAtIndex,
  DD_CHECKLIST_IDS,
  checklistStageWarning,
} from '../lib/dealWorkflow';
import {
  resolveChecklistItems,
  checklistProgress,
} from '../lib/checklistDefaults';
import {
  sourceQualityLabel,
  sourceQualityTier,
  sourceQualityWarning,
} from '../lib/sourceQuality';
import { toast } from 'sonner';
import { getEsgZoneIntersection } from '../lib/esgConservationZones';
import MaritimeContextPanel from './MaritimeContextPanel';
import PortLogisticsPanel from './PortLogisticsPanel';
import EntityRelationshipPanel from './EntityRelationshipPanel';
import OperationsTab from './OperationsTab';
import SecFilingsLink from './dossier/SecFilingsLink';
import GleifLeiLink from './dossier/GleifLeiLink';
import CompanyContactEnvelope from './dossier/CompanyContactEnvelope';
import CompanyRegistryLinks from './dossier/CompanyRegistryLinks';
import EntityTradeFlowsPanel from './dossier/EntityTradeFlowsPanel';
import { CountryCoveragePanel } from './dossier/CountryCoveragePanel';
import DealRoomPanel from './DealRoomPanel';
import LicenseeProcurementSection from './LicenseeProcurementSection';
import SupplyChainPanel from './dossier/SupplyChainPanel';
import FreeTradeEvidencePanel from './dossier/FreeTradeEvidencePanel';
import CountryCommoditySnapshotCard from './CountryCommoditySnapshotCard';
import SatelliteSitePanel from './dossier/SatelliteSitePanel';
import GoldBodLicensePanel from './dossier/GoldBodLicensePanel';
import {
  API_BASE,
  getEntityContacts,
  getEntityRelationships,
  getLatestDdReport,
  getLegalEvents,
  createDealRoom,
  listDealRooms,
  runContactEnrichmentAgent,
  runOperatorValidationAgent,
  useStorageTerminalDetails,
} from '../lib/api';
import { getLicenseCommodityLabels } from '../lib/commodities';
import {
  formatStorageOperatorLabel,
  formatStorageOwnerLabel,
  formatStorageSubstanceLabel,
  storageTerminalOsmTagSummary,
  STORAGE_OPERATOR_UNTAGGED,
} from '../lib/storageTankFarmsLayer';
import { getCommodityMarketSnapshot } from '../lib/commodityMarket';
import {
  getLicenseHeroImageUrl,
  getLicenseVolumeUnit,
  isOilAndGasLicense,
} from '../lib/licenseHeroImage';
import {
  buildMaritimeStatusMessages,
  buildVesselAlerts,
  findNearbyVessels,
  licenseViewportBounds,
  resolveMaritimeFeedIssue,
  useMaritimeVessels,
  type VesselAlert,
} from '../lib/vessels';

/** Client-side cap — slightly above server AI_ANALYSIS_DEADLINE_SECONDS + enrichment budget. */
const AI_ANALYZE_CLIENT_TIMEOUT_MS = 70_000;

function formatAiAnalyzeFailureMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const record = payload as { message?: unknown; error_code?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
    if (record.error_code === 'AI_ALL_PROVIDERS_FAILED') {
      return 'Intelligence providers are unavailable. Check the platform status banner for backend env (SET/MISSING) and configure GROQ_API_KEY or OPENROUTER_API_KEY on the server.';
    }
  }
  if (status === 503) {
    return 'Intelligence providers are busy or unreachable. Try again in a moment.';
  }
  if (status === 502) {
    return 'The intelligence service could not complete this request. Please try again.';
  }
  return 'Intelligence request failed.';
}

function fmtAlertTimestamp(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function vesselAlertSeverityClass(severity: VesselAlert['severity']): string {
  if (severity === 'critical') return 'bg-red-500/10 text-red-400 border-red-500/20';
  if (severity === 'warning') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
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
  onPlanRoute?: (item: MiningLicense) => void;
  linkedDealRoom?: DealRoom | null;
  onNavigateToDealRoom?: (dealRoomId: string) => void;
  onNavigateToEuProcurement?: (cpvBucket: string) => void;
  onOpenInvestigations?: () => void;
  onDealRoomLinked?: (room: DealRoom) => void;
}

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
  onPlanRoute,
  linkedDealRoom: linkedDealRoomProp,
  onNavigateToDealRoom,
  onNavigateToEuProcurement,
  onOpenInvestigations,
  onDealRoomLinked,
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
  const [isFindingContacts, setIsFindingContacts] = useState(false);
  const [contactAgentJob, setContactAgentJob] = useState<AgentJobResponse<ContactEnrichmentOutput> | null>(null);
  const [isLoadingRelationships, setIsLoadingRelationships] = useState(false);
  const [isValidatingOperator, setIsValidatingOperator] = useState(false);
  const [operatorValidationJob, setOperatorValidationJob] = useState<AgentJobResponse<OperatorValidationOutput> | null>(null);
  const [dealRoom, setDealRoom] = useState<DealRoom | null>(null);
  const [isLoadingDealRoom, setIsLoadingDealRoom] = useState(false);
  const [isCreatingDealRoom, setIsCreatingDealRoom] = useState(false);
  const [dealRoomError, setDealRoomError] = useState<string | null>(null);
  const [isLoadingDdReport, setIsLoadingDdReport] = useState(false);
  const [isLoadingLegalEvents, setIsLoadingLegalEvents] = useState(false);
  const [legalEventsError, setLegalEventsError] = useState<string | null>(null);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);
  const [aiSlowNetworkHint, setAiSlowNetworkHint] = useState(false);
  const aiRunInFlightRef = useRef(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [relationshipsError, setRelationshipsError] = useState<string | null>(null);
  const [selectedCommodity, setSelectedCommodity] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [scannedContract, setScannedContract] = useState<any>(null);
  const [isScanningContract, setIsScanningContract] = useState(false);
  const [contractFileName, setContractFileName] = useState('licensing_agreement_2026.pdf');
  const [scannedContractError, setScannedContractError] = useState<string | null>(null);



  // CRM edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<Partial<UserAnnotation>>({});

  const esgZone = useMemo(() => {
    if (!item) return null;
    return getEsgZoneIntersection(item.lat, item.lng);
  }, [item]);
  const isEsgRisk = esgZone !== null;

  const vesselAlertsViewport = useMemo(() => {
    if (item?.lat == null || item?.lng == null) return null;
    return licenseViewportBounds(item.lat, item.lng);
  }, [item?.lat, item?.lng]);

  const vesselAlertsTabActive = activeTab === 'vessel-alerts';

  const {
    data: maritimeFeedForAlerts,
    isLoading: maritimeAlertsLoading,
    error: maritimeAlertsError,
  } = useMaritimeVessels({
    enabled: vesselAlertsTabActive && item?.lat != null && item?.lng != null,
    viewport: vesselAlertsViewport,
    scope: 'all_vessels',
    maxVessels: 5000,
    captureWindowSeconds: 25,
  });

  const nearbyVesselSignals = useMemo(() => {
    if (item?.lat == null || item?.lng == null) return [];
    return findNearbyVessels(maritimeFeedForAlerts?.vessels ?? [], item.lat, item.lng);
  }, [item?.lat, item?.lng, maritimeFeedForAlerts?.vessels]);

  const maritimeSnapshotTotal =
    maritimeFeedForAlerts?.snapshot_vessel_count ??
    maritimeFeedForAlerts?.total_available ??
    maritimeFeedForAlerts?.vessels?.length ??
    0;

  const maritimeFeedIssue = useMemo(
    () =>
      resolveMaritimeFeedIssue(maritimeFeedForAlerts, {
        layerEnabled: true,
        vesselsInView: nearbyVesselSignals.length,
        snapshotTotal: maritimeSnapshotTotal,
      }),
    [maritimeFeedForAlerts, nearbyVesselSignals.length, maritimeSnapshotTotal],
  );

  const vesselAlerts = useMemo(
    () =>
      buildVesselAlerts({
        feed: maritimeFeedForAlerts,
        feedIssue: maritimeFeedIssue,
        licenseLat: item?.lat,
        licenseLng: item?.lng,
        nearbySignals: nearbyVesselSignals,
        esgZone,
        legalEvents,
      }),
    [
      maritimeFeedForAlerts,
      maritimeFeedIssue,
      item?.lat,
      item?.lng,
      nearbyVesselSignals,
      esgZone,
      legalEvents,
    ],
  );

  const proximityAlerts = useMemo(
    () => vesselAlerts.filter((alert) => alert.kind === 'vessel_proximity'),
    [vesselAlerts],
  );

  const systemAlerts = useMemo(
    () => vesselAlerts.filter((alert) => alert.kind !== 'vessel_proximity'),
    [vesselAlerts],
  );

  const maritimeStatusForAlerts = useMemo(
    () =>
      buildMaritimeStatusMessages(maritimeFeedForAlerts, {
        layerEnabled: true,
        vesselsInView: nearbyVesselSignals.length,
        snapshotTotal: maritimeSnapshotTotal,
        isLoading: maritimeAlertsLoading,
        hasError: Boolean(maritimeAlertsError),
      }),
    [
      maritimeFeedForAlerts,
      nearbyVesselSignals.length,
      maritimeSnapshotTotal,
      maritimeAlertsLoading,
      maritimeAlertsError,
    ],
  );

  const defaultLogs = useMemo(() => {
    if (!item) return [];
    return [
      {
        action: 'REGISTRY_SYNCED',
        details: `Concession registry coordinates synchronized from national cadastre databases for ${item.company || 'license'}.`,
        username: 'System CAD',
        timestamp: new Date(Date.now() - 48 * 3600 * 1000).toISOString()
      },
      ...(isEsgRisk && esgZone ? [{
        action: 'ESG_COMPLIANCE_ALERT',
        details: `Spatial containment alarm: overlap found inside protected area [${esgZone.name}]. Environmental compliance audit flagged.`,
        username: 'Sentinel Sat GIS',
        timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      }] : []),
    ];
  }, [item, isEsgRisk, esgZone]);

  const combinedLogs = useMemo(() => {
    const list = [...activityLogs, ...defaultLogs];
    return list.sort((a, b) => new Date(b.timestamp || b.created_at).getTime() - new Date(a.timestamp || a.created_at).getTime());
  }, [activityLogs, defaultLogs]);

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

  const currentStage = normalizeDealStage(annotation.stage);
  const lifecycleStep = dealStageIndex(currentStage);

  const checklistItems = useMemo(
    () => (item ? resolveChecklistItems(item.id, annotation.checklist) : []),
    [item?.id, annotation.checklist],
  );
  const checklistStats = useMemo(() => checklistProgress(checklistItems), [checklistItems]);
  const sourceTier = useMemo(() => sourceQualityTier(item || {}), [item]);
  const sourceQualityWarn = useMemo(() => sourceQualityWarning(sourceTier), [sourceTier]);
  const stageChecklistWarn = useMemo(
    () => checklistStageWarning(annotation.stage, checklistStats.pct),
    [annotation.stage, checklistStats.pct],
  );

  const ddChecklistComplete = useMemo(
    () =>
      DD_CHECKLIST_IDS.every((id) => checklistItems.find((it) => it.id === id)?.checked),
    [checklistItems],
  );

  const handleChecklistChange = (items: typeof checklistItems) => {
    if (!item) return;
    updateAnnotation(item.id, {
      checklist: items,
      checklistUpdatedAt: new Date().toISOString(),
    });
  };

  const suggestInvestigatingStage = () => {
    if (!item || currentStage === 'Investigating' || !ddChecklistComplete) return;
    toast.message(t('השלמת בדיקת נאותות', 'Due diligence items complete'), {
      description: t('לסמן כעסקה בחקירה?', 'Mark deal as Investigating?'),
      action: {
        label: t('חקירה', 'Investigating'),
        onClick: () => updateAnnotation(item.id, { stage: 'Investigating' }),
      },
      duration: 8000,
    });
  };
  const isOilAndGas = isOilAndGasLicense(item?.sector, commodityListLabel);
  const volumeUnit = getLicenseVolumeUnit(item?.sector, commodityListLabel);
  const heroImageUrl = item ? getLicenseHeroImageUrl(item) : '/assets/commodities/mining.png';
  const isStorageTerminal = item?.entityKind === 'storage_terminal';
  const isPortLogistics = item?.entityKind === 'port' || item?.entityKind === 'logistics_node';
  const oilCategory = inferOilCategory(effectiveCommodityRaw);
  const { data: storageTerminalDetails, isLoading: isLoadingStorageTerminal } =
    useStorageTerminalDetails(
      isStorageTerminal ? item?.id : undefined,
      Boolean(isOpen && isStorageTerminal && item?.id),
      isStorageTerminal ? item : undefined,
    );

  // Document AI state
  const defaultContractTemplate = useMemo(() => {
    if (!item) return '';
    const company = item.company || 'Acme Minerals Ltd';
    const country = item.country || 'Ghana';
    const id = item.id || 'GH-2026-001';
    const commodity = commodityListLabel;
    
    if (isOilAndGas) {
      return `PETROLEUM PRODUCTION SHARING AGREEMENT (PSA)
BETWEEN THE REPUBLIQUE OF ${country.toUpperCase()}
AND ${company.toUpperCase()} OIL & GAS CORP.

Ref Reference: PPSA-${id}-2026-X
Dated: January 18, 2026

WHEREAS the Contractor has requested rights for oil exploration and refining.
ARTICLE 14: FISCAL TERMS & ROYALTIES
14.1 The Contractor shall pay to the State a Royalty of 12.5% (twelve point five percent) of all Crude Oil produced and saved from the Contract Area.
14.2 The remaining profit oil shall be shared: 60% to the State and 40% to the Contractor.

ARTICLE 22: ENVIRONMENTAL COMPLIANCE AND PROTECTION
22.1 The Contractor shall comply with international petroleum industry standards.
22.2 WARNING: The exploratory block intersects high water-table zones. Special EPA secondary permits are required. Waste discharge in near-river zones is strictly prohibited. Failure to obtain EPA clearance will trigger immediate operational suspension.

ARTICLE 33: EXPENDITURE AND WORK COMMITMENT
33.1 The Contractor's minimum work commitment during the initial phase is $18,500,000 USD, including high-resolution 3D seismic acquisition.

ARTICLE 45: LOCAL LABOR AND CONTENT
45.1 Contractor agrees that a minimum of 45% (forty-five percent) of all technical and management personnel shall be citizens of ${country}. 
45.2 A mandatory training contribution of $150,000 USD per annum shall be paid directly to the Ministry of Petroleum Resources.`;
    } else {
      return `CONCESSION LEASE & MINING CONCESSION CONTRACT
MINISTRY OF LANDS AND NATURAL RESOURCES OF ${country.toUpperCase()}
GRANTED TO ${company.toUpperCase()} MINING GROUP

Reference Identification: MLC-${id}-GOLD
Valid From: February 10, 2026

TERMS AND DISCLOSURES:
SECTION 4. ROYALTIES AND TAXATION
4.1 The Lessee shall pay to the government of ${country} a Gross Revenue Royalty of 5.5% (five point five percent) on all ${commodity} sold or shipped.
4.2 State retains a 10% free-carried interest in all operations.

SECTION 9. ESG & ENVIRONMENTAL ADHERENCE
9.1 Lessee shall construct a secure tailings storage facility.
9.2 CAUTION: Operational boundaries must respect the local wildlife conservation buffer. Heavy machinery operations are prohibited within 500 meters of protected water sources. Runoff controls must pass quarterly inspector audits to maintain active license status.

SECTION 12. ANNUAL CAPITAL COMMITMENT
12.1 The Lessee is obligated to perform a minimum annual work program of $2,500,000 USD in active exploration, geological mapping, and drilling.

SECTION 18. LOCAL CONTENT COMPLIANCE
18.1 Lessee guarantees that at least 60% of all goods and professional services shall be procured from registered national subcontractors.
18.2 Citizens of ${country} must constitute at least 80% of the active manual labor force.`;
    }
  }, [item, isOilAndGas, commodityListLabel]);

  // Sync documentText with template if empty
  useEffect(() => {
    if (!documentText && defaultContractTemplate) {
      setDocumentText(defaultContractTemplate);
    }
  }, [defaultContractTemplate, documentText]);

  const scanContractWithAi = async () => {
    if (!item) return;
    setIsScanningContract(true);
    setScannedContractError(null);
    try {
      const response = await fetch(`${API_BASE}/api/ai/analyze-document`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: documentText,
          license_id: item.id,
          filename: contractFileName,
        }),
      });
      const data = await response.json();
      if (data.status === 'success') {
        setScannedContract(data);
        const newLog = {
          action: 'CONTRACT_AI_SCANNED',
          details: `Document AI contract scanner completed analysis for contract '${contractFileName}' (Royalty: ${data.contract_details?.royalty_rate ?? 'N/A'}, ESG: ${data.contract_details?.esg_compliance_rating ?? 'N/A'}).`,
          username: 'Doc AI Engine',
          timestamp: new Date().toISOString()
        };
        setActivityLogs(prev => [newLog, ...prev]);
      } else {
        setScannedContractError(data.message || 'Scanning failed.');
      }
    } catch (err: any) {
      setScannedContractError(err.message || 'Error communicating with server.');
    } finally {
      setIsScanningContract(false);
    }
  };

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

  const runContactAgent = async () => {
    if (!item || isFindingContacts) return;
    setIsFindingContacts(true);
    setContactsError(null);
    try {
      const job = await runContactEnrichmentAgent(item.id, item.entityKind || 'license');
      setContactAgentJob(job);
      if (Array.isArray(job.output?.contacts)) {
        setEntityContacts(job.output.contacts);
      }
    } catch {
      setContactsError('Contact agent could not complete. Existing source-backed contacts remain unchanged.');
    } finally {
      setIsFindingContacts(false);
    }
  };

  const runOperatorAgent = async () => {
    if (!item || isValidatingOperator) return;
    setIsValidatingOperator(true);
    setRelationshipsError(null);
    try {
      const job = await runOperatorValidationAgent(item.id, item.entityKind || 'license');
      setOperatorValidationJob(job);
    } catch {
      setRelationshipsError('Operator validation agent could not complete.');
    } finally {
      setIsValidatingOperator(false);
    }
  };

  const openOrCreateDealRoom = async () => {
    if (!item || isCreatingDealRoom) return;
    if (dealRoom) {
      if (onNavigateToDealRoom) {
        onNavigateToDealRoom(dealRoom.id);
      } else {
        setActiveTab('deal-room');
      }
      return;
    }
    setIsCreatingDealRoom(true);
    setDealRoomError(null);
    try {
      const created = await createDealRoom({
        entityId: item.id,
        entityKind: item.entityKind || 'license',
        title: `${item.company} Investigation`,
      });
      setDealRoom(created);
      onDealRoomLinked?.(created);
      if (onNavigateToDealRoom) {
        onNavigateToDealRoom(created.id);
      } else {
        setActiveTab('deal-room');
      }
    } catch {
      setDealRoomError('Could not create deal room for this entity.');
    } finally {
      setIsCreatingDealRoom(false);
    }
  };

  useEffect(() => {
    if (!isAnalyzing) {
      setAiSlowNetworkHint(false);
      return;
    }
    const t = window.setTimeout(() => setAiSlowNetworkHint(true), 12_000);
    return () => {
      window.clearTimeout(t);
    };
  }, [isAnalyzing]);

  useEffect(() => {
    let isCancelled = false;
    if (!isOpen || !item) {
      setDealRoom(null);
      setDealRoomError(null);
      setIsLoadingDealRoom(false);
      return () => {
        isCancelled = true;
      };
    }
    setIsLoadingDealRoom(true);
    setDealRoomError(null);
    listDealRooms({ entityId: item.id, entityKind: item.entityKind || 'license', includeArchived: true })
      .then((rooms) => {
        if (!isCancelled) setDealRoom(rooms[0] ?? null);
      })
      .catch(() => {
        if (!isCancelled) setDealRoomError('Could not load deal room state.');
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingDealRoom(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [isOpen, item?.id, item?.entityKind]);

  useEffect(() => {
    if (linkedDealRoomProp) setDealRoom(linkedDealRoomProp);
  }, [linkedDealRoomProp?.id, linkedDealRoomProp]);

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
        setAiAnalysis('');
        setAiAnalysisError('No saved intelligence scan yet. Run the scan manually after configuring an AI provider.');
      })
      .catch(() => {
        if (!isCancelled) {
          setLatestDdReport(null);
          setAiAnalysis('');
          setAiAnalysisError('Saved intelligence could not be loaded. Run the scan manually after configuring an AI provider.');
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
      setContactAgentJob(null);
      setContactsError(null);
      setIsLoadingContacts(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoadingContacts(true);
    setContactAgentJob(null);
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
      setOperatorValidationJob(null);
      setRelationshipsError(null);
      setIsLoadingRelationships(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoadingRelationships(true);
    setOperatorValidationJob(null);
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
  const isAiOrWebDiscoveredPhone = (discoveredBy?: string | null) =>
    discoveredBy === 'ai' || discoveredBy === 'web';
  const sourceBackedPhoneContact = publicBusinessContacts.find(
    (contact) =>
      contact.contactType === 'phone' && !isAiOrWebDiscoveredPhone(contact.discoveredBy || 'open_data')
  );
  const aiDiscoveredPhoneContacts = publicBusinessContacts.filter(
    (contact) => contact.contactType === 'phone' && isAiOrWebDiscoveredPhone(contact.discoveredBy)
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
        .map((role) => roleLabelMap[role] || role.replace(/_/g, ' '))
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
                <motion.div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white uppercase italic tracking-tight truncate">
                    {item.company}
                  </h2>
                  {item.company && <GleifLeiLink companyName={item.company} variant="compact" />}
                  {item.company && (
                    <CompanyRegistryLinks
                      companyName={item.company}
                      country={item.country}
                      variant="compact"
                    />
                  )}
                </motion.div>
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
                      {item.sector.replace(/_/g, ' ')}
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
                  {dealRoom && (
                    <Badge
                      className="bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25 text-[9px] font-black h-5 px-2 uppercase shrink-0 max-w-[min(100%,280px)] truncate"
                      title={dealRoom.title}
                    >
                      {t('בחדר עסקאות', 'In Deal Room')}: {dealRoom.title}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              {onAddToDueDiligence && onRemoveFromDueDiligence && (
                <div className="hidden sm:flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-amber-500/20 text-amber-500 hover:bg-amber-500/10"
                    onClick={() => {
                      // Stub functionality for the UX demo
                      window.alert(`Pinned ${item.name} to Workspace!`);
                    }}
                  >
                    <LucidePin className="w-4 h-4 mr-2" />
                    Workspace
                  </Button>
                  <AddToDueDiligenceButton
                    compact
                    isInQueue={isInDdQueue}
                    onAdd={onAddToDueDiligence}
                    onRemove={onRemoveFromDueDiligence}
                  />
                </div>
              )}
              {onPlanRoute && item && (
                <Button
                  onClick={() => onPlanRoute(item)}
                  className="h-10 text-[10px] font-black uppercase tracking-widest bg-amber-500 hover:bg-amber-600 text-slate-950 px-3 sm:px-6 flex items-center gap-2 shadow-lg"
                >
                  📍 {t('תכנן מסלול', 'Plan Route')}
                </Button>
              )}
              <Button
                onClick={openOrCreateDealRoom}
                disabled={isCreatingDealRoom || isLoadingDealRoom}
                variant={dealRoom ? 'outline' : 'default'}
                className={`h-10 text-[10px] font-black uppercase tracking-widest px-3 sm:px-6 flex items-center gap-2 ${
                  dealRoom
                    ? 'border-black/10 dark:border-white/10 text-slate-600 dark:text-slate-300'
                    : 'bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200'
                }`}
              >
                {dealRoom
                  ? onNavigateToDealRoom
                    ? t('צפה בחקירות', 'View in Investigations')
                    : t('פתח חדר', 'Open Deal Room')
                  : t('הוסף לחדר', 'Add to Deal Room')}
              </Button>
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
            {dealRoomError && (
              <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-bold text-red-600 dark:text-red-300">
                {dealRoomError}
              </div>
            )}
            {onAddToDueDiligence && onRemoveFromDueDiligence && (
              <div className="sm:hidden mb-6 flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full justify-center border-amber-500/20 text-amber-500 hover:bg-amber-500/10"
                  onClick={() => {
                    window.alert(`Pinned ${item.name} to Workspace!`);
                  }}
                >
                  <LucidePin className="w-4 h-4 mr-2" />
                  Pin to Workspace
                </Button>
                <AddToDueDiligenceButton
                  isInQueue={isInDdQueue}
                  onAdd={onAddToDueDiligence}
                  onRemove={onRemoveFromDueDiligence}
                />
              </div>
            )}
            {/* Deal stage strip — single source: annotation.stage (6 canonical stages) */}
            <div className="mb-6 md:mb-10 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                    {t('שלב עסקה', 'Deal stage')}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white uppercase">
                      {currentStage}
                    </span>
                    {checklistStats.total > 0 && (
                      <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-none text-[9px] font-black">
                        {t('רשימת ביצוע', 'Checklist')}: {checklistStats.done}/{checklistStats.total}
                      </Badge>
                    )}
                  </div>
                  {ddChecklistComplete && currentStage !== 'Investigating' && (
                    <button
                      type="button"
                      onClick={() => updateAnnotation(item.id, { stage: 'Investigating' })}
                      className="mt-2 text-left text-[9px] font-black uppercase tracking-widest text-amber-500 hover:text-amber-400"
                    >
                      {t('DD הושלם — סמן כחקירה', 'DD complete — mark as Investigating')}
                    </button>
                  )}
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {LIFECYCLE_STEPS.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          updateAnnotation(item.id, { stage: dealStageAtIndex(i) })
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

            {(sourceQualityWarn || stageChecklistWarn) && (
              <div className="mb-6 space-y-2">
                {sourceQualityWarn && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] font-semibold text-amber-900 dark:text-amber-100">
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-300 block mb-1">
                      {t('איכות מקור', 'Source quality')}: {sourceQualityLabel(sourceTier)}
                    </span>
                    {sourceQualityWarn}
                  </div>
                )}
                {stageChecklistWarn && (
                  <div className="rounded-2xl border border-slate-400/30 bg-slate-500/10 px-4 py-3 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    {stageChecklistWarn}
                  </div>
                )}
              </div>
            )}

            {/* Tabs */}
            <nav className="flex gap-0.5 sm:gap-1 border-b border-black/5 dark:border-white/5 mb-6 md:mb-10 overflow-x-auto no-scrollbar pointer-events-auto">
              {['overview', 'network-graph', 'deal-room', 'operations', 'exports-imports', 'gov-tenders', 'supply-chain', 'trade-evidence', 'news', 'satellite', 'owners', 'counterparties', 'vessel-alerts', 'intelligence', 'raw-evidence', 'document-ai', 'human-notes', 'execution', 'logs'].map(tab => {
                const tabLabels: Record<string, string> = {
                  'overview': 'Overview',
                  'network-graph': 'Network Graph',
                  'deal-room': 'Deal Room',
                  'operations': 'Operations',
                  'exports-imports': 'Exports and Imports',
                  'gov-tenders': 'Gov Spending & Tenders',
                  'supply-chain': 'Global Supply Chain',
                  'trade-evidence': 'Trade Evidence',
                  'news': 'News',
                  'satellite': 'Satellite',
                  'owners': 'Ownership',
                  'counterparties': 'Counterparties',
                  'vessel-alerts': 'Vessel Alerts',
                  'intelligence': 'AI Due Diligence',
                  'raw-evidence': 'Raw Evidence',
                  'document-ai': 'Document AI',
                  'human-notes': 'Human Notes',
                  'execution': 'Execution Checklist',
                  'logs': 'Audit Logs'
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

            {/* NETWORK GRAPH TAB */}
            {activeTab === 'network-graph' && (
              <GraphExplorer
                nodeId={item.legacy_id || item.id}
                nodeType={item.type === 'company' || item.type === 'vessel' ? 'organization' : 'asset'} // Adjust based on item model
              />
            )}

            {/* DEAL ROOM TAB */}
            {activeTab === 'deal-room' && (
              dealRoom ? (
                <DealRoomPanel
                  dealRoom={dealRoom}
                  entity={item}
                  onDealRoomChange={setDealRoom}
                />
              ) : (
                <div className="max-w-3xl rounded-3xl border border-black/5 bg-black/[0.03] p-8 text-center dark:border-white/10 dark:bg-white/[0.04]">
                  <p className="text-sm font-bold text-slate-500">
                    {isLoadingDealRoom ? 'Loading deal room...' : 'No deal room exists for this entity yet.'}
                  </p>
                  <Button
                    onClick={openOrCreateDealRoom}
                    disabled={isCreatingDealRoom}
                    className="mt-4 rounded-xl bg-amber-500 text-[10px] font-black uppercase tracking-widest text-slate-950 hover:bg-amber-600"
                  >
                    {isCreatingDealRoom ? 'Creating...' : 'Create Deal Room'}
                  </Button>
                </div>
              )
            )}

            {/* EXECUTION TAB */}
            {activeTab === 'execution' && (
              <div className="grid grid-cols-12 gap-6 md:gap-10">
                {/* Left: Checklist */}
                <div className="col-span-12 lg:col-span-7 space-y-6">
                  <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-6 md:p-8">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                      <LucideShieldCheck className="w-4 h-4 text-emerald-500" /> Execution Checklist
                    </h4>
                    <ExecutionChecklist
                      dealId={item.id}
                      dealLabel={item.company}
                      items={checklistItems}
                      onItemsChange={(next) => {
                        handleChecklistChange(next);
                        const ddDone = DD_CHECKLIST_IDS.every((id) =>
                          next.find((it) => it.id === id)?.checked,
                        );
                        if (
                          ddDone &&
                          normalizeDealStage(annotation.stage) !== 'Investigating'
                        ) {
                          suggestInvestigatingStage();
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Right: Lead Value + Fee Note */}
                <div className="col-span-12 lg:col-span-5 space-y-6">
                  {/* Lead Value Score */}
                  <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-6 md:p-8">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
                      <LucideZap className="w-4 h-4 text-amber-500" /> {t('עדיפות ליד', 'Lead priority')}
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-4 leading-relaxed">
                      {t(
                        'תג עדיפות פנימי לדירוג בתור — לא קשור לשלב העסקה.',
                        'Internal priority for queue ranking — separate from deal stage.',
                      )}
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
              <div className="space-y-4">
                {item.id && (
                  <CountryCommoditySnapshotCard
                    entityId={item.id}
                    entityKind={item.entityKind || 'license'}
                    variant="full"
                    onViewPartners={() => setActiveTab('trade-evidence')}
                  />
                )}
                {(isOilAndGas || item.commodity) && item.id && (
                  <EntityTradeFlowsPanel entityId={item.id} entityKind="license" />
                )}
                {isOilAndGas
                  ? <OilTradeContext country={item.country} category={oilCategory} />
                  : <TradeContext item={item} />}
              </div>
            )}

            {/* OPERATIONS TAB */}
            {activeTab === 'operations' && item && (
              <OperationsTab
                item={item}
                annotation={annotation}
                terminalDetails={terminalDetails}
                commodityListLabel={commodityListLabel}
                volumeUnit={volumeUnit}
                pipelineStageLabel={currentStage}
                isOilAndGas={isOilAndGas}
                isPortLogistics={isPortLogistics}
                isStorageTerminal={isStorageTerminal}
                isLoadingStorageTerminal={isLoadingStorageTerminal}
                isEsgRisk={isEsgRisk}
                esgZone={esgZone}
                entityRelationships={entityRelationships}
                isLoadingRelationships={isLoadingRelationships}
                relationshipsError={relationshipsError}
                roleSummary={roleSummary}
                latestDdReport={latestDdReport}
                isLoadingDdReport={isLoadingDdReport}
                ddLastRunLabel={ddLastRunLabel}
                onOpenIntelligenceTab={() => setActiveTab('intelligence')}
              />
            )}

            {/* LOGS TAB */}
            {activeTab === 'logs' && (
              <div className="space-y-6 max-w-3xl mx-auto px-4 py-2">
                <div className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-4 mb-6">
                  <div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                      {t('יומן פעילות וביקורת', 'Activity & Audit Log')}
                    </h3>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5">
                      {item.company} • {t('יומן כרונולוגי מאובטח', 'Secured Chronological Timeline')}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-black/10 dark:border-white/10 text-slate-500 dark:text-slate-400 font-bold uppercase text-[9px]">
                    {combinedLogs.length} {t('אירועים', 'Events')}
                  </Badge>
                </div>

                {combinedLogs.length === 0 ? (
                  <div className="text-center py-20 text-slate-500 text-sm font-bold bg-black/5 dark:bg-white/5 rounded-3xl border border-black/5 dark:border-white/5">
                    {t('אין פעילות רשומה', 'No recorded activity for this license yet.')}
                  </div>
                ) : (
                  <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-4 pl-8 space-y-8">
                    {combinedLogs.map((log: any, i: number) => {
                      const act = (log.action || '').toUpperCase();
                      let badgeColor = 'bg-amber-500/20 text-amber-500 border-amber-500/30';
                      let dotColor = 'bg-amber-500 ring-amber-500/20';
                      
                      if (act.includes('ALERT') || act.includes('RISK') || act.includes('WARNING')) {
                        badgeColor = 'bg-red-500/10 text-red-500 border-red-500/20';
                        dotColor = 'bg-red-500 ring-red-500/20 animate-pulse';
                      } else if (act.includes('SYNC') || act.includes('LOAD')) {
                        badgeColor = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
                        dotColor = 'bg-emerald-500 ring-emerald-500/20';
                      } else if (act.includes('AI') || act.includes('SCAN')) {
                        badgeColor = 'bg-blue-500/10 text-blue-500 border-blue-500/20';
                        dotColor = 'bg-blue-500 ring-blue-500/20';
                      } else if (act.includes('NOTE') || act.includes('EDIT') || act.includes('USER')) {
                        badgeColor = 'bg-purple-500/10 text-purple-500 border-purple-500/20';
                        dotColor = 'bg-purple-500 ring-purple-500/20';
                      }

                      return (
                        <div key={i} className="relative group">
                          {/* Timeline Dot Connector */}
                          <div className={`absolute -left-[41px] top-1.5 w-4 h-4 rounded-full border-4 border-slate-900 dark:border-slate-950 ring-4 ${dotColor} shrink-0 transition-transform duration-300 group-hover:scale-125 z-10`} />
                          
                          {/* Log Card */}
                          <div className="p-5 bg-white/50 dark:bg-slate-950/40 backdrop-blur-md rounded-2xl border border-black/5 dark:border-white/5 shadow-sm transition-all duration-300 hover:shadow-md hover:border-black/10 dark:hover:border-white/10">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <Badge className={`border font-black text-[9px] uppercase px-2 h-5 tracking-wider ${badgeColor}`}>
                                {log.action.replace(/_/g, ' ')}
                              </Badge>
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
                                {new Date(log.timestamp || log.created_at).toLocaleString()}
                              </span>
                            </div>
                            
                            <p className="text-sm text-slate-800 dark:text-slate-200 font-semibold leading-relaxed">
                              {log.details}
                            </p>
                            
                            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-black/5 dark:border-white/5 text-[9px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-widest">
                              <span>BY:</span>
                              <span className="text-slate-700 dark:text-slate-300">{log.username || 'System'}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* VESSEL ALERTS TAB (PILLAR C) */}
            {activeTab === 'vessel-alerts' && item && (
              <div className="space-y-6 max-w-4xl mx-auto">
                <Card className="bg-slate-900/50 dark:bg-slate-950/50 border-black/10 dark:border-white/10 rounded-3xl p-6 shadow-lg">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <Badge className="bg-cyan-500/10 text-cyan-400 border-none font-black text-[9px] px-2.5 h-5 mb-3">
                        {t('מקור AIS', 'AIS source')}
                      </Badge>
                      <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                        {maritimeStatusForAlerts
                          ? t(maritimeStatusForAlerts.headlineHe, maritimeStatusForAlerts.headlineEn)
                          : t('מעקב כלי שיט', 'Vessel watch')}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed max-w-2xl">
                        {maritimeStatusForAlerts
                          ? t(maritimeStatusForAlerts.detailHe, maritimeStatusForAlerts.detailEn)
                          : t(
                              'טוען מצב מאגר AIS סביב הרישיון…',
                              'Loading AIS feed status around this license…',
                            )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest">
                        {t('עודכן', 'Updated')}
                      </p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {fmtAlertTimestamp(
                          maritimeFeedForAlerts?.data_as_of,
                          t('לא זמין', 'Unavailable'),
                        )}
                      </p>
                      <p className="text-[9px] text-slate-500 mt-1">
                        {maritimeFeedForAlerts?.source || 'maritime_intel'}
                      </p>
                    </div>
                  </div>
                  {maritimeAlertsError && (
                    <p className="mt-4 text-[10px] text-red-500 font-bold">
                      {String((maritimeAlertsError as Error)?.message || maritimeAlertsError)}
                    </p>
                  )}
                  {maritimeStatusForAlerts?.sparseWarningHe && maritimeStatusForAlerts.sparseWarningEn && (
                    <p className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[10px] text-amber-700 dark:text-amber-300">
                      {t(maritimeStatusForAlerts.sparseWarningHe, maritimeStatusForAlerts.sparseWarningEn)}
                    </p>
                  )}
                </Card>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                        {t('התרעות מבוססות נתונים', 'Data-driven alerts')}
                      </h4>
                      <p className="text-[9px] text-slate-400">
                        {t(
                          'רק אותות מ-AIS, כיסוי, ESG ו-OpenSanctions — ללא אירועי הדגמה',
                          'Only AIS coverage, proximity, ESG, and OpenSanctions signals — no demo events',
                        )}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-cyan-500/20 text-cyan-400 text-[9px] font-bold">
                      {vesselAlerts.length} {t('התרעות', 'Alerts')}
                    </Badge>
                  </div>

                  {maritimeAlertsLoading && !maritimeFeedForAlerts ? (
                    <Card className="p-8 rounded-3xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5">
                      <div className="flex items-center gap-3">
                        <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
                          {t('טוען התרעות ימיות…', 'Loading maritime alerts…')}
                        </p>
                      </div>
                    </Card>
                  ) : vesselAlerts.length === 0 ? (
                    <Card className="p-8 rounded-3xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5">
                      <div className="flex items-start gap-3">
                        <LucideShip className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                            {t('אין התרעות פעילות', 'No active alerts')}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                            {t(
                              'לא נמצאו כלי שיט AIS בטווח 150 ק"מ, דגלים מסנקציות, או בעיות כיסוי מעבר לסטטוס המאגר למעלה.',
                              'No AIS vessels within 150 km, sanctions flags, or coverage issues beyond the feed status above.',
                            )}
                          </p>
                        </div>
                      </div>
                    </Card>
                  ) : (
                    <div className="space-y-3">
                      {systemAlerts.map((alert) => (
                        <Card
                          key={alert.id}
                          className={`p-5 rounded-3xl border ${vesselAlertSeverityClass(alert.severity)}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <LucideAlertTriangle className="w-4 h-4 shrink-0" />
                                <h4 className="text-sm font-black uppercase tracking-wide">
                                  {t(alert.titleHe, alert.titleEn)}
                                </h4>
                              </div>
                              <p className="text-[10px] leading-relaxed opacity-90">
                                {t(alert.messageHe, alert.messageEn)}
                              </p>
                            </div>
                            <Badge className="font-black text-[8px] px-2 h-5 border-none shrink-0 uppercase">
                              {alert.severity}
                            </Badge>
                          </div>
                          <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-500">
                            <span>
                              {t('מקור', 'Source')}: {alert.sourceLabel}
                            </span>
                            <span>
                              {t('נצפה', 'Observed')}:{' '}
                              {fmtAlertTimestamp(alert.observedAt, t('לא זמין', 'Unavailable'))}
                            </span>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                        {t('קרבת AIS לרישיון', 'AIS proximity to license')}
                      </h4>
                      <p className="text-[9px] text-slate-400">
                        {t(
                          'כלי שיט אמיתיים בטווח 150 ק"מ (Haversine) — ללא מיקומי הדגמה',
                          'Real AIS vessels within 150 km (Haversine) — demo positions excluded',
                        )}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-cyan-500/20 text-cyan-400 text-[9px] font-bold">
                      {proximityAlerts.length} {t('קרובים', 'Nearby')}
                    </Badge>
                  </div>

                  {proximityAlerts.length === 0 ? (
                    <Card className="p-6 rounded-3xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5">
                      <p className="text-[10px] text-slate-500">
                        {t(
                          'אין כלי שיט AIS שמורים בטווח. נסו להרחיב את oil-live-intel-worker או לבדוק כיסוי המפרץ.',
                          'No persisted AIS vessels in range. Expand oil-live-intel-worker watches or check Gulf coverage.',
                        )}
                      </p>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {proximityAlerts.map((alert) => {
                        const signal = nearbyVesselSignals.find((entry) => entry.vessel.id === alert.vesselId);
                        const vessel = signal?.vessel;
                        const isCritical = alert.severity === 'critical';
                        return (
                          <Card
                            key={alert.id}
                            className={`p-5 rounded-3xl border transition-all duration-300 relative overflow-hidden flex flex-col justify-between min-h-[180px] shadow-sm
                              ${isCritical
                                ? 'bg-red-500/5 border-red-500/20'
                                : 'bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5'}`}
                          >
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0
                                  ${isCritical ? 'bg-red-500/20 text-red-500' : 'bg-cyan-500/10 text-cyan-400'}`}>
                                  <LucideShip className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <h4 className="text-sm font-black text-slate-900 dark:text-white truncate uppercase">
                                    {alert.vesselName || vessel?.mmsi || t('לא ידוע', 'Unknown')}
                                  </h4>
                                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider truncate">
                                    {[vessel?.ship_type_label, vessel?.mmsi ? `MMSI ${vessel.mmsi}` : null]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </p>
                                </div>
                              </div>
                              <Badge className={`font-black text-[9px] px-2 h-5 border-none shrink-0
                                ${isCritical ? 'bg-red-500 text-white' : 'bg-cyan-500/10 text-cyan-400'}`}>
                                {alert.distanceKm?.toFixed(1)} km
                              </Badge>
                            </div>
                            <p className="text-[10px] text-slate-500 leading-relaxed">
                              {t(alert.messageHe, alert.messageEn)}
                            </p>
                            <div className="mt-4 pt-3 border-t border-black/5 dark:border-white/5 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-500">
                              <span>
                                {t('מקור', 'Source')}: {alert.sourceLabel}
                              </span>
                              <span>
                                {t('נצפה', 'Observed')}:{' '}
                                {fmtAlertTimestamp(alert.observedAt, t('לא זמין', 'Unavailable'))}
                              </span>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* GOV SPENDING & TENDERS — entity-specific US awards + EU TED only */}
            {activeTab === 'gov-tenders' && item && (
              <LicenseeProcurementSection
                item={item}
                active={activeTab === 'gov-tenders'}
                onNavigateToEuProcurement={onNavigateToEuProcurement}
                onOpenInvestigations={onOpenInvestigations}
              />
            )}

            {/* GLOBAL SUPPLY CHAIN & VALUE FLOW TAB */}
            {activeTab === 'supply-chain' && item && (
              <SupplyChainPanel
                item={item}
                entityRelationships={entityRelationships}
                isLoadingRelationships={isLoadingRelationships}
                onOpenExportsTab={() => setActiveTab('exports-imports')}
                onOpenGovTab={() => setActiveTab('gov-tenders')}
              />
            )}

            {activeTab === 'trade-evidence' && item && (
              <FreeTradeEvidencePanel
                item={item}
                commodityLabel={commodityListLabel}
                onOpenExportsTab={() => setActiveTab('exports-imports')}
              />
            )}

            {/* SATELLITE SITE TAB */}
            {activeTab === 'satellite' && item && (
              <SatelliteSitePanel item={item} esgZone={esgZone} isEsgRisk={isEsgRisk} />
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl text-[10px] font-black uppercase"
                      onClick={runOperatorAgent}
                      disabled={isValidatingOperator}
                    >
                      {isValidatingOperator ? 'Validating...' : 'Validate operator'}
                    </Button>
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

                  {operatorValidationJob?.output && (
                    <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.07] p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Badge className="border-none bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 text-[9px] font-black uppercase">
                          {operatorValidationJob.output.recommendation}
                        </Badge>
                        <Badge className="border-none bg-white/70 text-slate-600 dark:bg-slate-950/50 dark:text-slate-300 text-[9px] font-black uppercase">
                          {operatorValidationJob.output.score}/100
                        </Badge>
                        {operatorValidationJob.cached && (
                          <Badge className="border-none bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-[9px] font-black uppercase">
                            Cached
                          </Badge>
                        )}
                      </div>
                      {operatorValidationJob.output.summary && (
                        <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                          {operatorValidationJob.output.summary}
                        </p>
                      )}
                      {operatorValidationJob.output.findings.length > 0 && (
                        <ul className="mt-3 space-y-1.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                          {operatorValidationJob.output.findings.slice(0, 4).map((finding, index) => (
                            <li key={`${finding.code}-${index}`}>
                              <span className="font-black uppercase text-cyan-600 dark:text-cyan-300">{finding.severity}</span>
                              {' · '}
                              {finding.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
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
                  <motion.div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <SpecItem label="Record origin" value={terminalDetails.recordOrigin || 'N/A'} />
                    <SpecItem label="Primary Source" value={terminalDetails.sourceName || 'Manual / local'} />
                    <SpecItem label="Source Class" value={sourceKindLabel || 'Unknown'} />
                    <SpecItem label="Source ID" value={terminalDetails.sourceId || 'N/A'} />
                    <SpecItem label="Coverage State" value={coverageStateLabel || 'N/A'} />
                    <SpecItem label="Source URL" value={terminalDetails.sourceUrl || 'N/A'} />
                    <SpecItem label="Record URL" value={terminalDetails.sourceRecordUrl || 'N/A'} />
                    <SpecItem label="Source Updated" value={terminalDetails.sourceUpdatedAt || 'N/A'} />
                    <SpecItem label="Last Synced" value={terminalDetails.lastSyncedAt || 'N/A'} />
                  </motion.div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {terminalDetails.sourceRecordUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 text-[10px] font-black uppercase tracking-widest"
                        onClick={() => window.open(terminalDetails.sourceRecordUrl!, '_blank', 'noopener,noreferrer')}
                      >
                        {t('אמת במקור', 'Verify at source')}
                      </Button>
                    )}
                    {item.country && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 text-[10px] font-black uppercase tracking-widest"
                        onClick={() => {
                          const regionParam = item.country
                            ? `&country=${encodeURIComponent(item.country)}`
                            : '';
                          window.open(
                            `${API_BASE}/api/open-data/coverage/world?region=all${regionParam}`,
                            '_blank',
                            'noopener,noreferrer'
                          );
                        }}
                      >
                        {t('כיסוי מדינה', 'Country coverage')}
                      </Button>
                    )}
                  </div>
                  {terminalDetails.provenanceNote && (
                    <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {terminalDetails.provenanceNote}
                    </p>
                  )}
                  {item?.company && <SecFilingsLink companyName={item.company} />}
                  {item?.company && <GleifLeiLink companyName={item.company} />}
                  {item?.company && (
                    <CompanyRegistryLinks companyName={item.company} country={item.country} />
                  )}
                </div>
                {item.country && <CountryCoveragePanel country={item.country} />}
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
                    <code className="font-mono">OPENSANCTIONS_API_KEY</code>,{' '}
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
                      <LucidePhone className="w-4 h-4 text-emerald-500" /> Phones from AI / web fetch
                    </h4>
                    {(ddDiscoveredPhones.length > 0 || aiDiscoveredPhoneContacts.length > 0) && (
                      <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black uppercase">
                        {Math.max(ddDiscoveredPhones.length, aiDiscoveredPhoneContacts.length)} on file
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    These numbers were located by the AI during a DD run, or by the contact agent’s optional web fetch,
                    and persisted to <code className="font-mono">entity_contacts</code> with{' '}
                    <code className="font-mono">discovered_by='ai'</code> or{' '}
                    <code className="font-mono">discovered_by='web'</code>.
                    They show up everywhere a public business phone is rendered — including the dossier card
                    and the map popup — but stay clearly distinguishable from cadastre-backed numbers so an
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

            {/* DOCUMENT AI TAB */}
            {activeTab === 'document-ai' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl">
                {/* Left side: Document Editor Simulation */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      Contract Document Simulator
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-bold bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-full px-3 py-1 font-mono">
                        {contractFileName}
                      </span>
                    </div>
                  </div>

                  <div className="relative border border-black/10 dark:border-white/10 rounded-3xl bg-slate-900/40 dark:bg-slate-950/40 p-6 shadow-inner font-mono text-xs leading-relaxed text-slate-300 h-[500px] overflow-y-auto no-scrollbar">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-500 opacity-60" />
                    
                    <textarea
                      value={documentText}
                      onChange={(e) => setDocumentText(e.target.value)}
                      className="w-full h-full bg-transparent border-none outline-none focus:ring-0 text-xs text-slate-300 dark:text-slate-200 resize-none font-mono font-medium leading-6 no-scrollbar"
                      placeholder="Paste your mining license contract or petroleum agreement text dump here..."
                    />
                  </div>

                  <div className="flex items-center gap-4">
                    <Button
                      onClick={scanContractWithAi}
                      disabled={isScanningContract || !documentText.trim()}
                      className="flex-1 bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black uppercase tracking-widest text-[10px] h-12 rounded-2xl shadow-xl transition-all relative overflow-hidden group border-none"
                    >
                      {isScanningContract ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                          Parsing Clauses...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          <LucideBrain className="w-4 h-4 text-slate-950" />
                          Scan Contract with Document AI
                        </span>
                      )}
                    </Button>
                    
                    <Button
                      onClick={() => {
                        setDocumentText(defaultContractTemplate);
                        setScannedContract(null);
                        setScannedContractError(null);
                      }}
                      disabled={isScanningContract}
                      className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-slate-400 dark:text-slate-300 hover:bg-black/10 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white font-black uppercase tracking-widest text-[10px] h-12 px-6 rounded-2xl transition-colors shrink-0"
                    >
                      Reset Draft
                    </Button>
                  </div>
                </div>

                {/* Right side: Intelligence Hub HUD */}
                <div className="lg:col-span-5 space-y-6">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    AI Legal Intelligence Hub
                  </p>

                  {scannedContractError && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-2xl flex items-start gap-3">
                      <LucideAlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Extraction failed</p>
                        <p className="opacity-80 mt-0.5">{scannedContractError}</p>
                      </div>
                    </div>
                  )}

                  {!scannedContract && !isScanningContract && !scannedContractError && (
                    <div className="flex flex-col items-center justify-center text-center p-12 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl h-[450px]">
                      <div className="p-4 bg-slate-900/10 dark:bg-white/5 rounded-full mb-4">
                        <LucideUploadCloud className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                        Ready for Contract Scanning
                      </h4>
                      <p className="text-xs text-slate-500 max-w-[280px]">
                        Paste or edit the contract text on the left, then click the AI scanner to perform instant compliance extraction.
                      </p>
                    </div>
                  )}

                  {isScanningContract && (
                    <div className="flex flex-col items-center justify-center text-center p-12 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl h-[450px] relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 to-transparent animate-pulse" />
                      <div className="w-16 h-16 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin mb-6" />
                      <h4 className="text-sm font-black text-amber-500 uppercase tracking-widest mb-1">
                        Executing OCR & Legal Scan
                      </h4>
                      <p className="text-xs text-slate-400 max-w-[280px]">
                        Analyzing royalty percentages, spatial wildlife restrictions, and financial spending obligations...
                      </p>
                    </div>
                  )}

                  {scannedContract && !isScanningContract && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl p-6 space-y-6"
                    >
                      <div className="flex items-center justify-between pb-4 border-b border-black/5 dark:border-white/5">
                        <div className="flex items-center gap-2">
                          <LucideShieldCheck className="w-5 h-5 text-emerald-500 animate-bounce" />
                          <span className="text-sm font-black uppercase text-slate-900 dark:text-white tracking-wider">
                            Legal Extraction Verified
                          </span>
                        </div>
                        <Badge className="bg-amber-500/10 text-amber-500 border-none text-[8px] font-black uppercase px-2 py-0.5">
                          {scannedContract.provider || 'AI Extraction'}
                        </Badge>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">
                            Contract Reference ID
                          </p>
                          <p className="text-xs font-bold text-slate-900 dark:text-white bg-black/10 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl px-3 py-2 select-all font-mono">
                            {scannedContract.license_id_reference || 'N/A'}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">
                              Fiscal Royalty Rate
                            </p>
                            <p className="text-xs font-black text-slate-900 dark:text-white bg-black/10 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl px-3 py-2">
                              {scannedContract.royalty_rate || 'N/A'}
                            </p>
                          </div>

                          <div>
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">
                              ESG Rating / Status
                            </p>
                            <div className="flex items-center gap-2 bg-black/10 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl px-3 py-2">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  scannedContract.environmental_rating === 'A'
                                    ? 'bg-emerald-500'
                                    : scannedContract.environmental_rating === 'B'
                                      ? 'bg-yellow-500'
                                      : scannedContract.environmental_rating === 'C'
                                        ? 'bg-orange-500'
                                        : 'bg-red-500 animate-ping'
                                }`}
                              />
                              <span className="text-xs font-black text-slate-900 dark:text-white">
                                {scannedContract.environmental_rating || 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">
                            ESG Rationale
                          </p>
                          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 bg-black/10 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl px-3 py-2 font-medium">
                            {scannedContract.environmental_rationale || 'N/A'}
                          </p>
                        </div>

                        <div>
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">
                            Annual Expenditure Target
                          </p>
                          <p className="text-xs font-bold text-slate-900 dark:text-white bg-black/10 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl px-3 py-2 font-mono">
                            {scannedContract.annual_work_commitment || 'N/A'}
                          </p>
                        </div>

                        <div>
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">
                            Local Content Guarantees
                          </p>
                          <p className="text-xs font-bold text-slate-900 dark:text-white bg-black/10 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl px-3 py-2">
                            {scannedContract.local_content_requirement || 'N/A'}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
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

                  {item.id && (
                    <CountryCommoditySnapshotCard
                      entityId={item.id}
                      entityKind={item.entityKind || 'license'}
                      variant="full"
                      onViewPartners={() => setActiveTab('trade-evidence')}
                    />
                  )}

                  {(item.company || item.operatorName) && (
                    <CompanyContactEnvelope
                      companyName={item.company || item.operatorName || ''}
                      country={item.country || ''}
                      operatorName={item.operatorName}
                    />
                  )}

                  {(item.phoneNumber || publicPhoneContact || privateLeadPhone !== '—') && (
                    <Card className="bg-emerald-500/10 border border-emerald-500/25 rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20">
                        <LucidePhone className="h-6 w-6 text-emerald-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-300">
                          {t('טלפון מפעיל / חברה', 'Operator / company phone')}
                        </p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white break-all">
                          {publicPhoneContact?.value || item.phoneNumber || privateLeadPhone}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1">
                          {publicPhoneContact
                            ? t('מאגר entity_contacts או רישום פתוח', 'From entity_contacts or open registry')
                            : item.phoneNumber
                              ? t('משדה הרישיון ב-Postgres', 'From license record in Postgres')
                              : t('הערת ליד פנימית', 'Internal lead note')}
                        </p>
                      </div>
                    </Card>
                  )}

                  {isEsgRisk && esgZone && (
                    <Card className="bg-red-500/10 border-red-500/20 rounded-3xl p-6 mb-6 overflow-hidden relative shadow-[0_12px_40px_rgba(239,68,68,0.15)] flex flex-col md:flex-row gap-6 items-center">
                      <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 to-transparent pointer-events-none" />
                      <div className="w-14 h-14 bg-red-500/20 border border-red-500/30 text-red-500 rounded-2xl flex items-center justify-center shrink-0 animate-pulse">
                        <LucideAlertTriangle className="w-8 h-8" />
                      </div>
                      <div className="flex-1 text-center md:text-left">
                        <Badge className="bg-red-500 hover:bg-red-600 text-white font-black text-[9px] px-2.5 h-5 mb-2 border-none">
                          {t('חריגת שימור קריטית', 'CRITICAL ENVIRONMENTAL INTERSECTION')}
                        </Badge>
                        <h4 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                          {t('הצטלבות עם אזור שימור: ', 'INTERSECTION DETECTED: ') + esgZone.name}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                          {esgZone.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-3">
                        <Badge variant="outline" className="border-red-500/40 text-red-500 font-bold text-[10px] px-3 py-1 bg-red-500/5">
                          {t('סיכון: גבוה מאוד', 'Risk Level: CRITICAL')}
                        </Badge>
                      </div>
                    </Card>
                  )}

                  <GoldBodLicensePanel item={item} commodityLabel={commodityListLabel} />

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
                          value={terminalDetails.entitySubtype.replace(/_/g, ' ')}
                        />
                      )}
                      {isStorageTerminal && (
                        <SpecItem
                          label={t('מפעיל', 'Operator')}
                          value={formatStorageOperatorLabel(
                            terminalDetails.operatorName,
                            t('לא מתויג', STORAGE_OPERATOR_UNTAGGED),
                          )}
                        />
                      )}
                      {isStorageTerminal && formatStorageOwnerLabel(terminalDetails.ownerName) && (
                        <SpecItem
                          label={t('בעלים', 'Owner')}
                          value={terminalDetails.ownerName || '—'}
                        />
                      )}
                      {isStorageTerminal && formatStorageSubstanceLabel(terminalDetails) && (
                        <SpecItem
                          label={t('חומר', 'Substance')}
                          value={formatStorageSubstanceLabel(terminalDetails) || '—'}
                        />
                      )}
                      {!isStorageTerminal && terminalDetails.operatorName && (
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
                            isAiOrWebDiscoveredPhone(publicPhoneContact.discoveredBy)
                              ? t('טלפון (גילוי AI / רשת)', 'Public Phone (AI / web)')
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
                    {!isStorageTerminal && (
                      <div className="mb-4 rounded-2xl border border-amber-500/15 bg-amber-500/[0.06] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                              Company Contact Agent
                            </p>
                            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                              Reads structured fields from the cadastre row first. When phone, email, or website is still
                              missing and <code className="font-mono text-[9px]">GOOGLE_CSE_API_KEY</code> +{' '}
                              <code className="font-mono text-[9px]">GOOGLE_CSE_CX</code> (or{' '}
                              <code className="font-mono text-[9px]">SERPAPI_API_KEY</code>) is set, the backend runs a
                              bounded search + HTML fetch (mailto/tel/text only — no guessing).
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-xl text-[10px] font-black uppercase"
                            onClick={runContactAgent}
                            disabled={isFindingContacts}
                          >
                            {isFindingContacts ? 'Searching...' : 'Find contacts'}
                          </Button>
                        </div>
                        {contactAgentJob?.output && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Badge className="border-none bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-[9px] font-black uppercase">
                              {contactAgentJob.output.contacts.length} found
                            </Badge>
                            {contactAgentJob.output.not_found.map((kind) => (
                              <Badge key={kind} className="border-none bg-slate-500/10 text-slate-500 text-[9px] font-black uppercase">
                                {kind} not found
                              </Badge>
                            ))}
                            {contactAgentJob.output.web_discovery?.engine &&
                              contactAgentJob.output.web_discovery.engine !== 'none' && (
                                <Badge className="border-none bg-violet-500/10 text-violet-600 dark:text-violet-300 text-[9px] font-black uppercase">
                                  Web: {contactAgentJob.output.web_discovery.engine}
                                </Badge>
                              )}
                            {contactAgentJob.cached && (
                              <Badge className="border-none bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 text-[9px] font-black uppercase">
                                Cached
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="space-y-3">
                      {isStorageTerminal ? (
                        <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
                          <div className="space-y-2">
                            <ReadRow label={t('תת-סוג', 'Subtype')} value={terminalDetails.entitySubtype?.replace(/_/g, ' ') || '—'} />
                            <ReadRow
                              label={t('מפעיל', 'Operator')}
                              value={formatStorageOperatorLabel(
                                terminalDetails.operatorName,
                                t('לא מתויג', STORAGE_OPERATOR_UNTAGGED),
                              )}
                            />
                            <ReadRow
                              label={t('בעלים', 'Owner')}
                              value={formatStorageOwnerLabel(terminalDetails.ownerName) || '—'}
                            />
                            <ReadRow
                              label={t('חומר', 'Substance')}
                              value={formatStorageSubstanceLabel(terminalDetails) || '—'}
                            />
                            <ReadRow label={t('נמל קרוב', 'Nearby Port')} value={terminalDetails.nearbyPort?.name || '—'} />
                            <ReadRow label={t('מרחק לנמל', 'Port Distance')} value={terminalDetails.nearbyPort?.distance_km != null ? `${terminalDetails.nearbyPort.distance_km} km` : '—'} />
                            <ReadRow label={t('קיבולת מסומנת', 'Tagged Capacity')} value={terminalDetails.capacityText || '—'} />
                            <ReadRow label={t('הסבר ביטחון', 'Confidence Note')} value={terminalDetails.confidenceNote || '—'} wide />
                          </div>
                          {storageTerminalOsmTagSummary(storageTerminalDetails?.rawPayload).length > 0 && (
                            <div className="mt-4 border-t border-black/5 dark:border-white/5 pt-4">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                {t('תגי OSM', 'OSM tags')}
                              </p>
                              <div className="space-y-1">
                                {storageTerminalOsmTagSummary(storageTerminalDetails?.rawPayload).map((tag) => (
                                  <p key={tag.key} className="text-[10px] text-slate-500 break-words">
                                    <span className="font-semibold text-slate-700 dark:text-slate-300">{tag.key}</span>
                                    {': '}
                                    {tag.value}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}
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

                  {/* Deal signal (qualification heat — not workflow stage) */}
                  <Card className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-3xl p-8">
                    <h4 className="text-[12px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-3">
                      <LucideZap className="w-4 h-4 text-emerald-500" />{' '}
                      {t('אות עסקה', 'Deal signal')}
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-4 leading-relaxed">
                      {t(
                        'חום ההזדמנות (עסקה / בדיקה / ליד) — נפרד משלב העסקה למעלה.',
                        'Opportunity heat (Deal / Assay / Lead) — separate from deal stage above.',
                      )}
                    </p>
                    <div className="grid grid-cols-3 gap-3 mb-4">
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
                    <div className="pt-4 border-t border-black/5 dark:border-white/5">
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">
                        {t('עדיפות ליד', 'Lead priority')}
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {(['high', 'medium', 'low'] as LeadValue[]).map((v) => {
                          const isActive = (annotation.leadValue || 'medium') === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateAnnotation(item.id, { leadValue: v });
                              }}
                              className={`py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all ${
                                isActive
                                  ? 'bg-amber-500 text-slate-950 border-amber-500'
                                  : 'bg-black/5 dark:bg-white/5 text-slate-500 border-black/10 dark:border-white/10'
                              }`}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
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
                          label={t('שלב עסקה', 'Deal stage')}
                          value={currentStage}
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
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          {t(
                            'שלב העסקה נערך בשורת השלבים למעלה.',
                            'Deal stage is edited in the strip at the top of the dossier.',
                          )}{' '}
                          <span className="font-bold text-slate-600 dark:text-slate-300">{currentStage}</span>
                        </p>
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
    case 'curated_reference':
      return 'Curated reference';
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
      return contactType.replace(/_/g, ' ');
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
                {event.discoveredBy.replace(/_/g, ' ')}
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
