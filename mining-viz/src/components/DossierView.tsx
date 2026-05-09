import { useState, useEffect, useMemo } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { 
  X as LucideX, 
  Brain as LucideBrain, 
  MapPin as LucideMapPin, 
  ShieldCheck as LucideShieldCheck, 
  Zap as LucideZap, 
  User as LucideUser, 
  Phone as LucidePhone, 
  Camera as LucideCamera, 
  Share2 as LucideShare2 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface DossierViewProps {
  isOpen: boolean;
  onClose: () => void;
  item: MiningLicense | null;
  annotation: UserAnnotation;
  marketPrices: any[];
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
}

export default function DossierView({
  isOpen,
  onClose,
  item,
  annotation,
  marketPrices,
  updateAnnotation
}: DossierViewProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('overview');
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [news, setNews] = useState<any[]>([]);

  // Live Price Calculation
  const goldPriceObj = marketPrices.find(p => p.symbol === 'XAU/USD');
  const rawGoldPrice = goldPriceObj ? parseFloat(goldPriceObj.price.replace(/,/g, '')) : 68450;
  const discount = 0.12; // 12%
  const logistics = 2400;
  const netProfit = (rawGoldPrice * (1 - discount)) - logistics;

  const runAiAnalysis = async () => {
    if (!item) return;
    setAiAnalysis("");
    setIsAnalyzing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/ai/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: `Analyze the mining potential, risks, and opportunities for ${item.company} located in ${item.region}, ${item.country}. Primary commodity: ${item.commodity}. License type: ${item.licenseType}. License ID: ${item.id}. Provide a detailed tactical assessment.`,
          type: 'DOSSIER'
        })
      });
      const data = await res.json();
      setAiAnalysis(data.analysis || data.response || "No tactical data available for this site.");
    } catch (err) {
      setAiAnalysis("Intelligence link failed. Manual verification recommended.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (isOpen && item) {
      if (!aiAnalysis) runAiAnalysis();
      // Fetch activity logs for this license
      fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/activity/logs?limit=50`)
        .then(r => r.json())
        .then(logs => setActivityLogs(logs.filter((l: any) => l.details?.includes(item.id) || l.details?.includes(item.company))))
        .catch(() => {});
    }
  }, [isOpen, item]);

  if (!item) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-3xl overflow-y-auto"
        >
          {/* Top Bar (Full Width) */}
          <header className="sticky top-0 z-10 w-full h-16 bg-slate-950/80 border-b border-white/5 flex items-center justify-between px-8 backdrop-blur-md">
            <div className="flex items-center gap-6">
              <div className="flex flex-col">
                <h2 className="text-xl font-black text-white uppercase italic tracking-tight">{item.company}</h2>
                <div className="flex items-center gap-2">
                   <Badge className="bg-amber-500/10 text-amber-500 border-none text-[9px] font-black h-4 px-1.5 uppercase">
                     {item.commodity}
                   </Badge>
                   <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{item.region}, {item.country}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <Button variant="outline" className="h-10 border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 px-6 text-slate-300">
                <LucideShare2 className="w-3.5 h-3.5 mr-2" /> {t("שתף", "Share Report")}
              </Button>
              <Button onClick={onClose} variant="ghost" className="h-10 w-10 p-0 text-slate-500 hover:text-white hover:bg-white/5 rounded-full">
                <LucideX className="w-6 h-6" />
              </Button>
            </div>
          </header>

          <main className="max-w-[1400px] mx-auto p-10 pb-32">
            {/* Deal Execution Workflow Tracker */}
            <div className="mb-10 bg-white/5 border border-white/10 rounded-2xl p-6 flex items-center justify-between">
               <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("סטטוס עסקה", "Deal Lifecycle")}</span>
                  <div className="flex items-center gap-2">
                     <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                     <span className="text-xs font-bold text-white uppercase">{t("מכין הצעה", "Drafting Proposal (LOI)")}</span>
                  </div>
               </div>
               
               <div className="flex gap-4">
                  {[
                    { id: 'lead', label: 'Lead' },
                    { id: 'loi', label: 'LOI Sent' },
                    { id: 'dd', label: 'Due Diligence' },
                    { id: 'closed', label: 'Closed Deal' }
                  ].map((step, i) => (
                    <div key={step.id} className="flex items-center gap-3">
                       <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all
                         ${i === 1 ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-lg shadow-amber-500/20' : 'bg-white/5 text-slate-500 border-white/5'}`}>
                          <span className="opacity-50">{i + 1}.</span> {step.label}
                       </div>
                       {i < 3 && <div className="w-4 h-px bg-white/10" />}
                    </div>
                  ))}
               </div>
            </div>

            {/* Main Tabs (MarineTraffic Style) */}
            <nav className="flex gap-1 border-b border-white/5 mb-10 overflow-x-auto no-scrollbar">
               {['overview', 'logs', 'tech-specs', 'owners', 'intelligence', 'news'].map((tab) => (
                 <button
                   key={tab}
                   onClick={() => setActiveTab(tab)}
                   className={`px-6 py-4 text-[10px] font-black uppercase tracking-widest transition-all relative
                   ${activeTab === tab ? 'text-amber-500' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   {tab.replace('-', ' ')}
                   {activeTab === tab && (
                     <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
                   )}
                 </button>
               ))}
            </nav>

            {/* ── LOGS TAB ── */}
            {activeTab === 'logs' && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Activity Log — {item.company}</p>
                {activityLogs.length === 0 ? (
                  <div className="text-center py-16 text-slate-600 text-sm font-bold">No recorded activity for this license yet.</div>
                ) : activityLogs.map((log: any, i: number) => (
                  <div key={i} className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">{log.action}</span>
                      <span className="text-sm text-white font-medium">{log.details}</span>
                      <span className="text-[9px] text-slate-500">{log.username} · {new Date(log.timestamp || log.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── TECH SPECS TAB ── */}
            {activeTab === 'tech-specs' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-8 bg-white/5 border border-white/5 rounded-3xl p-8">
                <SpecItem label="License ID" value={`#${item.id}`} />
                <SpecItem label="License Type" value={item.licenseType || 'N/A'} />
                <SpecItem label="Commodity" value={item.commodity || 'N/A'} isGold={item.commodity?.toLowerCase().includes('gold')} />
                <SpecItem label="Status" value={item.status || 'N/A'} />
                <SpecItem label="Country" value={item.country || 'N/A'} />
                <SpecItem label="Region" value={item.region || 'N/A'} />
                <SpecItem label="Coordinates" value={`${item.lat?.toFixed(4)}, ${item.lng?.toFixed(4)}`} />
                {item.dateIssued && <SpecItem label="Date Issued" value={item.dateIssued} />}
                {item.phoneNumber && <SpecItem label="Phone" value={item.phoneNumber} />}
                {item.contactPerson && <SpecItem label="Contact" value={item.contactPerson} />}
              </div>
            )}

            {/* ── OWNERS TAB ── */}
            {activeTab === 'owners' && (
              <div className="space-y-4 max-w-2xl">
                <div className="p-6 bg-white/5 border border-white/5 rounded-3xl space-y-5">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Registered Operator</p>
                  <h3 className="text-2xl font-black text-white uppercase">{item.company}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <SpecItem label="Country" value={item.country || 'N/A'} />
                    <SpecItem label="Region" value={item.region || 'N/A'} />
                    <SpecItem label="Contact Person" value={item.contactPerson || annotation.contactPerson || 'Not on record'} />
                    <SpecItem label="Phone" value={item.phoneNumber || annotation.phoneNumber || 'Not on record'} />
                  </div>
                </div>
              </div>
            )}

            {/* ── INTELLIGENCE TAB ── */}
            {activeTab === 'intelligence' && (
              <div className="max-w-3xl space-y-6">
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-3xl p-8">
                  <h4 className="text-[12px] font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <LucideBrain className="w-4 h-4" /> AI Intelligence Report
                  </h4>
                  <div className="min-h-[150px] flex items-center justify-center">
                    {isAnalyzing ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[10px] font-black text-indigo-400 uppercase animate-pulse">Analyzing Intelligence...</span>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-300 leading-relaxed">{aiAnalysis || 'No analysis yet. Click the button below to run.'}</p>
                    )}
                  </div>
                  <Button onClick={runAiAnalysis} disabled={isAnalyzing} className="mt-6 w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-[10px]">
                    {isAnalyzing ? 'Analyzing...' : 'Re-Run Intelligence Scan'}
                  </Button>
                </div>
              </div>
            )}

            {/* ── NEWS TAB ── */}
            {activeTab === 'news' && (
              <div className="max-w-3xl space-y-4">
                {[
                  { title: `Search news about ${item.company}`, url: `https://www.google.com/search?q=${encodeURIComponent(item.company + ' mining')}&tbm=nws`, source: 'Google News' },
                  { title: `${item.commodity} market news`, url: `https://www.google.com/search?q=${encodeURIComponent(item.commodity + ' mining market')}&tbm=nws`, source: 'Google News' },
                  { title: `Mining news: ${item.country}`, url: `https://www.google.com/search?q=${encodeURIComponent(item.country + ' mining industry news')}&tbm=nws`, source: 'Google News' },
                ].map((item, i) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between p-5 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-colors group">
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">{item.source}</span>
                      <span className="text-sm font-bold text-white group-hover:text-amber-400 transition-colors">{item.title}</span>
                    </div>
                    <LucideShare2 className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors shrink-0 ml-4" />
                  </a>
                ))}
              </div>
            )}

            {/* ── OVERVIEW TAB (existing grid) ── */}
            {activeTab === 'overview' && (
               
               {/* Left Column: Media & Primary Info */}
               <div className="col-span-12 lg:col-span-8 space-y-8">
                  {/* Hero Visual Card */}
                  <Card className="bg-white/5 border-white/5 overflow-hidden rounded-3xl">
                     <div className="h-[400px] w-full relative">
                        <img 
                          src={item.commodity?.toLowerCase().includes('gold') ? '/assets/commodities/gold.png' : item.commodity?.toLowerCase().includes('diamond') ? '/assets/commodities/diamond.png' : '/assets/commodities/satellite.png'}
                          className="w-full h-full object-cover grayscale-[20%] hover:grayscale-0 transition-all duration-1000"
                          alt="Commodity Visual"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                        <div className="absolute bottom-8 left-8 right-8 flex justify-between items-end">
                           <div className="space-y-2">
                              <Badge className="bg-amber-500 text-slate-950 border-none font-black text-[10px] px-3 h-6 uppercase tracking-widest">
                                {t("פעיל", "Live Status: Operational")}
                              </Badge>
                              <h3 className="text-3xl font-black text-white uppercase italic">{item.company}</h3>
                           </div>
                           <Button className="bg-white/10 backdrop-blur-md hover:bg-white/20 border border-white/10 text-[10px] font-black uppercase tracking-widest h-12 px-8 text-white">
                             <LucideCamera className="w-4 h-4 mr-2" /> {t("גלריית תמונות", "Photo Gallery (12)")}
                           </Button>
                        </div>
                     </div>
                  </Card>

                  {/* General Specs Table */}
                  <Card className="bg-white/5 border-white/5 rounded-3xl p-8">
                     <h4 className="text-[12px] font-black text-slate-400 uppercase tracking-[0.2em] mb-8 flex items-center gap-3">
                        <LucideShieldCheck className="w-4 h-4 text-emerald-500" /> {t("מפרט טכני", "Technical Specifications")}
                     </h4>
                     <div className="grid grid-cols-2 md:grid-cols-3 gap-y-8 gap-x-12">
                        <SpecItem label={t("סוג רשיון", "License Type")} value={item.licenseType || 'ML'} />
                        <SpecItem label={t("מזהה רשיון", "License ID")} value={`#${item.id.slice(0, 8)}`} />
                        <SpecItem label={t("סחורה עיקרית", "Main Commodity")} value={item.commodity} isGold={item.commodity?.toLowerCase().includes('gold')} />
                        <SpecItem label={t("אזור", "Region")} value={item.region} />
                        <SpecItem label={t("מדינה", "Country")} value={item.country} />
                        <SpecItem label={t("בעלות", "Ownership Status")} value={t("פרטי", "Private Entity")} />
                        <SpecItem label={t("נפח מוערך", "Estimated Volume")} value={`${annotation.quantity || 0} KG`} />
                        <SpecItem label={t("שווי מוערך", "Estimated Valuation")} value={`$${annotation.price?.toLocaleString() || '0'}`} />
                        <SpecItem label={t("נקודת מגע", "Primary Contact")} value={item.contactPerson || annotation.contactPerson || t("חסוי", "Confidential")} />
                        {item.phoneNumber && <SpecItem label={t("טלפון", "Phone")} value={item.phoneNumber} />}
                        {item.dateIssued && <SpecItem label={t("תאריך הנפקה", "Date Issued")} value={item.dateIssued} />}
                     </div>
                  </Card>
               </div>

               {/* Right Column: AI Intelligence & Insights */}
               <div className="col-span-12 lg:col-span-4 space-y-8">
                  {/* AI OS Dashboard */}
                  <Card className="bg-indigo-500/10 border-indigo-500/20 rounded-3xl p-8 relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-4 opacity-20">
                        <LucideZap className="w-24 h-24 text-indigo-500" />
                     </div>
                     <h4 className="text-[12px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                        <LucideBrain className="w-4 h-4" /> {t("מודיעין Gemini", "Gemini Intelligence OS")}
                     </h4>
                      <div className="space-y-6">
                        <div className="bg-slate-950/60 backdrop-blur-md rounded-2xl p-5 border border-indigo-500/20 min-h-[120px] flex items-center justify-center">
                           {isAnalyzing ? (
                             <div className="flex flex-col items-center gap-3">
                               <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                               <span className="text-[10px] font-black text-indigo-400 uppercase animate-pulse">{t("מנתח...", "Analyzing Intelligence...")}</span>
                             </div>
                           ) : (
                             <p className="text-xs text-slate-300 leading-relaxed font-medium">
                               {aiAnalysis}
                             </p>
                           )}
                        </div>
                        <Button onClick={runAiAnalysis} disabled={isAnalyzing} className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-[10px] shadow-2xl">
                           {isAnalyzing ? t("מנתח...", "Analyzing...") : t("הרץ שוב", "Re-Run Intelligence Scan")}
                        </Button>
                     </div>
                  </Card>

                  {/* Entrepreneur Profit Calculator */}
                  <Card className="bg-emerald-500/10 border-emerald-500/20 rounded-3xl p-8 relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-4 opacity-10">
                        <LucideZap className="w-20 h-20 text-emerald-500" />
                     </div>
                     <h4 className="text-[12px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                        <LucideBrain className="w-4 h-4" /> {t("מחשבון רווח יזמי", "Entrepreneur ROI Engine")}
                     </h4>
                     <div className="space-y-4">
                        <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-xl border border-white/5">
                           <span className="text-[9px] font-black text-slate-500 uppercase">{t("מחיר שוק (LIVE)", "Market Price (LIVE)")}</span>
                           <span className="text-xs font-black text-white">${rawGoldPrice.toLocaleString()} / KG</span>
                        </div>
                        <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-xl border border-white/5">
                           <span className="text-[9px] font-black text-slate-500 uppercase">{t("דיסקאונט מקומי", "Local Discount")}</span>
                           <span className="text-xs font-black text-emerald-400">- 12%</span>
                        </div>
                        <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-xl border border-white/5">
                           <span className="text-[9px] font-black text-slate-500 uppercase">{t("לוגיסטיקה ומיסים", "Logistics & Taxes")}</span>
                           <span className="text-xs font-black text-red-400">${logistics.toLocaleString()} / KG</span>
                        </div>
                        
                        <div className="pt-4 border-t border-white/5 mt-2">
                           <div className="flex justify-between items-end">
                              <div className="flex flex-col">
                                 <span className="text-[10px] font-black text-slate-400 uppercase">{t("רווח פוטנציאלי", "Est. Net Profit")}</span>
                                 <span className="text-2xl font-black text-emerald-500">${netProfit.toLocaleString(undefined, {maximumFractionDigits: 0})} / KG</span>
                              </div>
                              <Badge className="bg-emerald-500 text-slate-950 font-black text-[10px] mb-1">HIGH MARGIN</Badge>
                           </div>
                        </div>
                        
                        <Button onClick={() => {
                           const loi = `LETTER OF INTENT\n\nDate: ${new Date().toLocaleDateString()}\n\nRE: Mining License Acquisition — ${item.company}\n\nTo Whom It May Concern,\n\nWe hereby express our intent to enter into a formal acquisition agreement for the following mining license:\n\nCompany: ${item.company}\nLicense ID: ${item.id}\nCommodity: ${item.commodity}\nRegion: ${item.region}, ${item.country}\nLicense Type: ${item.licenseType}\nEstimated Net Profit: $${netProfit.toLocaleString(undefined, {maximumFractionDigits: 0})} / KG\n\nThis letter is non-binding and subject to due diligence.\n\nSincerely,\n[Your Name]\n[Company]`;
                           const blob = new Blob([loi], { type: 'text/plain' });
                           const url = URL.createObjectURL(blob);
                           const a = document.createElement('a'); a.href = url; a.download = `LOI_${item.company.replace(/\s+/g, '_')}.txt`; a.click();
                        }} className="w-full h-12 bg-white text-slate-950 hover:bg-slate-200 font-black uppercase tracking-widest text-[10px] mt-4 shadow-2xl">
                           {t("צור מכתב כוונות (LOI)", "Generate LOI Contract")}
                        </Button>
                     </div>
                  </Card>

                  {/* Contact Intelligence */}
                  <Card className="bg-white/5 border-white/5 rounded-3xl p-8">
                     <h4 className="text-[12px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                        <LucideUser className="w-4 h-4 text-amber-500" /> {t("מודיעין קשר", "Contact Intelligence")}
                     </h4>
                     <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                           <div className="flex flex-col">
                              <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{t("איש קשר", "Direct Lead")}</span>
                              <span className="text-sm font-black text-white">{item.contactPerson || annotation.contactPerson || t("לא ידוע", "Not Identified")}</span>
                           </div>
                           <Button size="icon" variant="ghost" className="h-10 w-10 text-slate-400 hover:text-white">
                              <LucideUser className="w-4 h-4" />
                           </Button>
                        </div>
                        <a 
                          href={(item.phoneNumber || annotation.phoneNumber) ? `tel:${item.phoneNumber || annotation.phoneNumber}` : '#'}
                          className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors"
                        >
                           <div className="flex flex-col">
                              <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{t("טלפון", "Phone Line")}</span>
                              <span className="text-sm font-black text-white">{item.phoneNumber || annotation.phoneNumber || '--- --- ---'}</span>
                           </div>
                           <div className="h-10 w-10 flex items-center justify-center text-emerald-500">
                              <LucidePhone className="w-4 h-4" />
                           </div>
                        </a>
                     </div>
                  </Card>
               </div>
            </div>
            )} {/* end overview */}
           </main>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SpecItem({ label, value, isGold }: { label: string, value: string, isGold?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
      <span className={`text-[13px] font-black uppercase tracking-tight ${isGold ? 'text-amber-400 underline decoration-amber-500/30 underline-offset-4' : 'text-slate-200'}`}>
        {value}
      </span>
    </div>
  );
}
