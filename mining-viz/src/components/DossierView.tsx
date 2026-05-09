import { useState, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
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
  Camera as LucideCamera,
  Share2 as LucideShare2,
  Pencil as LucidePencil,
  Check as LucideCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AiIntelligenceReport } from './AiIntelligenceReport';
import TradeContext from './TradeContext';

interface DossierViewProps {
  isOpen: boolean;
  onClose: () => void;
  item: MiningLicense | null;
  annotation: UserAnnotation;
  marketPrices: any[];
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
}

const KANBAN_STAGES = ['New', 'Contacted', 'Diligence', 'Verified', 'Closed'] as const;

const LIFECYCLE_STEPS = [
  { id: 'New', label: 'Lead' },
  { id: 'Contacted', label: 'LOI Sent' },
  { id: 'Diligence', label: 'Due Diligence' },
  { id: 'Closed', label: 'Closed Deal' },
] as const;

// Map Kanban stage → lifecycle step index (0-3)
const STAGE_TO_LIFECYCLE: Record<string, number> = {
  New: 0,
  Contacted: 1,
  Diligence: 2,
  Verified: 2,
  Closed: 3,
};

// Clicking a lifecycle step sets this Kanban stage
const LIFECYCLE_TO_STAGE: Record<number, string> = {
  0: 'New',
  1: 'Contacted',
  2: 'Diligence',
  3: 'Closed',
};

export default function DossierView({
  isOpen,
  onClose,
  item,
  annotation,
  marketPrices,
  updateAnnotation,
}: DossierViewProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('overview');
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingLOI, setIsGeneratingLOI] = useState(false);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);

  // CRM edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<Partial<UserAnnotation>>({});

  // Live Gold price (troy oz → kg)
  const goldPriceObj = marketPrices.find(p => p.symbol === 'GOLD/oz');
  const goldPricePerOz = goldPriceObj
    ? parseFloat(goldPriceObj.price.replace(/[$,]/g, ''))
    : 3326;
  const rawGoldPricePerKg = goldPricePerOz * 32.1507;
  const discount = 0.12;
  const logistics = 2400;
  const netGoldProfit = rawGoldPricePerKg * (1 - discount) - logistics;

  // Silver price for reference (troy oz → kg)
  const silverPriceObj = marketPrices.find(p => p.symbol === 'SILVER/oz');
  const silverPricePerOz = silverPriceObj
    ? parseFloat(silverPriceObj.price.replace(/[$,]/g, ''))
    : 32.5;
  const silverPricePerKg = silverPricePerOz * 32.1507;

  // Current pipeline stage
  const currentStage = annotation.stage || 'New';
  const lifecycleStep = STAGE_TO_LIFECYCLE[currentStage] ?? 0;

  const runAiAnalysis = async () => {
    if (!item) return;
    setAiAnalysis('');
    setIsAnalyzing(true);
    const API_BASE =
      import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:8000`;
    try {
      const token = localStorage.getItem('mining_token');
      const res = await fetch(`${API_BASE}/api/ai/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: `Analyze the mining potential, risks, and opportunities for ${item.company} located in ${item.region}, ${item.country}. Primary commodity: ${item.commodity}. License type: ${item.licenseType}. License ID: ${item.id}.

Output requirements:
- Use Markdown only. Start with "## License snapshot" and 4–6 short bullet lines (company, location, commodity, lease type, license ID, status note).
- Then "## Mining potential", "## Risk rating" (give X/10 and a compact table: Category | Score | One-line why), and "## Recommendation" (numbered steps, plain language).
- Keep paragraphs to 2–4 sentences. Avoid dense pipe tables except the risk matrix. Flag items that must be verified with authorities.`,
          context: { type: 'DOSSIER', item_id: item.id },
        }),
      });
      const data = await res.json();
      setAiAnalysis(
        data.analysis || data.response || 'No tactical data available for this site.'
      );
    } catch (_) {
      setAiAnalysis('Intelligence link failed. Manual verification recommended.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (isOpen && item) {
      if (!aiAnalysis) runAiAnalysis();
      const API_BASE =
        import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:8000`;
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
                    {item.commodity}
                  </Badge>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate">
                    {item.region}, {item.country}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
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
              {['overview', 'trade', 'logs', 'tech-specs', 'owners', 'intelligence', 'news'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 sm:px-6 py-3 sm:py-4 text-[10px] font-black uppercase tracking-widest transition-all relative z-10 whitespace-nowrap min-h-[44px]
                  ${activeTab === tab ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  {tab === 'trade'
                    ? t('מסחר וכלכלה', 'Trade Context')
                    : tab.replace('-', ' ')}
                  {activeTab === tab && (
                    <motion.div
                      layoutId="tab-underline"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500"
                    />
                  )}
                </button>
              ))}
            </nav>

            {/* TRADE TAB */}
            {activeTab === 'trade' && (
              <TradeContext item={item} />
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
                  value={item.commodity || 'N/A'}
                  isGold={item.commodity?.toLowerCase().includes('gold')}
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
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Registered Operator
                  </p>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase">{item.company}</h3>
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
              </div>
            )}

            {/* INTELLIGENCE TAB */}
            {activeTab === 'intelligence' && (
              <div className="max-w-3xl space-y-6">
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-3xl p-8">
                  <h4 className="text-[12px] font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <LucideBrain className="w-4 h-4" /> AI Intelligence Report
                  </h4>
                  <div className="min-h-[150px] w-full max-h-[min(70vh,640px)] overflow-y-auto pr-1">
                    {isAnalyzing ? (
                      <div className="flex min-h-[150px] flex-col items-center justify-center gap-3">
                        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[10px] font-black text-indigo-400 uppercase animate-pulse">
                          Analyzing Intelligence...
                        </span>
                      </div>
                    ) : aiAnalysis.trim() ? (
                      <AiIntelligenceReport content={aiAnalysis} />
                    ) : (
                      <p className="text-sm text-slate-400 leading-relaxed py-4">
                        {t('אין ניתוח עדיין. לחץ להרצה.', 'No analysis yet. Use the button below to run a scan.')}
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={runAiAnalysis}
                    disabled={isAnalyzing}
                    className="mt-6 w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-[10px]"
                  >
                    {isAnalyzing ? 'Analyzing...' : 'Re-Run Intelligence Scan'}
                  </Button>
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
                    title: `${item.commodity} market news`,
                    url: `https://www.google.com/search?q=${encodeURIComponent(item.commodity + ' mining market')}&tbm=nws`,
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
                        src={
                          item.commodity?.toLowerCase().includes('gold')
                            ? '/assets/commodities/gold.png'
                            : item.commodity?.toLowerCase().includes('diamond')
                            ? '/assets/commodities/diamond.png'
                            : '/assets/commodities/satellite.png'
                        }
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
                        value={item.commodity}
                        isGold={item.commodity?.toLowerCase().includes('gold')}
                      />
                      <SpecItem label={t('אזור', 'Region')} value={item.region} />
                      <SpecItem label={t('מדינה', 'Country')} value={item.country} />
                      <SpecItem
                        label={t('בעלות', 'Ownership Status')}
                        value={t('פרטי', 'Private Entity')}
                      />
                      <SpecItem
                        label={t('נפח מוערך', 'Estimated Volume')}
                        value={`${annotation.quantity ?? item.capacity ?? 0} KG`}
                      />
                      <SpecItem
                        label={t('שווי מוערך', 'Estimated Valuation')}
                        value={`$${(annotation.price ?? item.pricePerKg ?? 0).toLocaleString()}`}
                      />
                      <SpecItem
                        label={t('נקודת מגע', 'Primary Contact')}
                        value={
                          annotation.contactPerson ||
                          item.contactPerson ||
                          t('חסוי', 'Confidential')
                        }
                      />
                      {(item.phoneNumber || annotation.phoneNumber) && (
                        <SpecItem
                          label={t('טלפון', 'Phone')}
                          value={annotation.phoneNumber || item.phoneNumber || ''}
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
                        {isAnalyzing ? (
                          <div className="flex min-h-[120px] flex-col items-center justify-center gap-3">
                            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[10px] font-black text-indigo-400 uppercase animate-pulse">
                              {t('מנתח...', 'Analyzing Intelligence...')}
                            </span>
                          </div>
                        ) : aiAnalysis.trim() ? (
                          <AiIntelligenceReport content={aiAnalysis} className="text-left" />
                        ) : (
                          <p className="text-xs text-slate-500 leading-relaxed py-2">
                            {t(
                              'הרץ סריקה לקבלת סיכום',
                              'Run a scan to see a readable briefing here.'
                            )}
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={runAiAnalysis}
                        disabled={isAnalyzing}
                        className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-[10px] shadow-2xl"
                      >
                        {isAnalyzing
                          ? t('מנתח...', 'Analyzing...')
                          : t('הרץ שוב', 'Re-Run Intelligence Scan')}
                      </Button>
                    </div>
                  </Card>

                  {/* Gold ROI Engine */}
                  <Card className="bg-emerald-500/10 border-emerald-500/20 rounded-3xl p-8 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <LucideZap className="w-20 h-20 text-emerald-500" />
                    </div>
                    <h4 className="text-[12px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                      <LucideBrain className="w-4 h-4" />{' '}
                      {t('מחשבון רווח - זהב', 'Gold ROI Engine')}
                    </h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center bg-white/60 dark:bg-slate-950/60 p-3 rounded-xl border border-black/5 dark:border-white/5">
                        <span className="text-[9px] font-black text-slate-500 uppercase">
                          {t('מחיר זהב (LIVE)', 'Gold Market (LIVE)')}
                        </span>
                        <span className="text-xs font-black text-amber-500 dark:text-amber-400">
                          ${rawGoldPricePerKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} / KG
                        </span>
                      </div>
                      <div className="flex justify-between items-center bg-white/60 dark:bg-slate-950/60 p-3 rounded-xl border border-black/5 dark:border-white/5">
                        <span className="text-[9px] font-black text-slate-500 uppercase">
                          {t('מחיר כסף (REF)', 'Silver Ref (LIVE)')}
                        </span>
                        <span className="text-xs font-black text-slate-500 dark:text-slate-400">
                          ${silverPricePerKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} / KG
                        </span>
                      </div>
                      <div className="flex justify-between items-center bg-white/60 dark:bg-slate-950/60 p-3 rounded-xl border border-black/5 dark:border-white/5">
                        <span className="text-[9px] font-black text-slate-500 uppercase">
                          {t('דיסקאונט מקומי', 'Local Discount')}
                        </span>
                        <span className="text-xs font-black text-emerald-500 dark:text-emerald-400">- 12%</span>
                      </div>
                      <div className="flex justify-between items-center bg-white/60 dark:bg-slate-950/60 p-3 rounded-xl border border-black/5 dark:border-white/5">
                        <span className="text-[9px] font-black text-slate-500 uppercase">
                          {t('לוגיסטיקה ומיסים', 'Logistics & Taxes')}
                        </span>
                        <span className="text-xs font-black text-red-400">
                          ${logistics.toLocaleString()} / KG
                        </span>
                      </div>
                      <div className="pt-3 border-t border-black/5 dark:border-white/5">
                        <div className="flex justify-between items-end">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black text-slate-500 uppercase">
                              {t('רווח נקי - זהב', 'Est. Net Profit (Gold)')}
                            </span>
                            <span className="text-2xl font-black text-emerald-500">
                              $
                              {netGoldProfit.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}{' '}
                              / KG
                            </span>
                          </div>
                          <Badge className="bg-emerald-500 text-slate-950 font-black text-[10px] mb-1">
                            HIGH MARGIN
                          </Badge>
                        </div>
                      </div>
                      <Button
                        onClick={() => {
                          setIsGeneratingLOI(true);
                          setTimeout(() => {
                            const loi = `LETTER OF INTENT\n\nDate: ${new Date().toLocaleDateString()}\n\nRE: Mining License Acquisition — ${item.company}\n\nTo Whom It May Concern,\n\nWe hereby express our intent to enter into a formal acquisition agreement for the following mining license:\n\nCompany: ${item.company}\nLicense ID: ${item.id}\nCommodity: ${item.commodity}\nRegion: ${item.region}, ${item.country}\nLicense Type: ${item.licenseType}\nEst. Net Profit (Gold): $${netGoldProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} / KG\n\nThis letter is non-binding and subject to due diligence.\n\nSincerely,\n[Your Name]\n[Company]`;
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
                      {t('מודיעין קשר', 'Contact Intelligence')}
                    </h4>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-black/5 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
                            {t('איש קשר', 'Direct Lead')}
                          </span>
                          <span className="text-sm font-black text-slate-900 dark:text-white">
                            {annotation.contactPerson ||
                              item.contactPerson ||
                              t('לא ידוע', 'Not Identified')}
                          </span>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-10 w-10 text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        >
                          <LucideUser className="w-4 h-4" />
                        </Button>
                      </div>
                      <a
                        href={
                          annotation.phoneNumber || item.phoneNumber
                            ? `tel:${annotation.phoneNumber || item.phoneNumber}`
                            : '#'
                        }
                        className="flex items-center justify-between p-4 bg-black/5 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                      >
                        <div className="flex flex-col">
                          <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
                            {t('טלפון', 'Phone Line')}
                          </span>
                          <span className="text-sm font-black text-slate-900 dark:text-white">
                            {annotation.phoneNumber || item.phoneNumber || '--- --- ---'}
                          </span>
                        </div>
                        <div className="h-10 w-10 flex items-center justify-center text-emerald-500">
                          <LucidePhone className="w-4 h-4" />
                        </div>
                      </a>
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
