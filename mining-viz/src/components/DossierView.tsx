import { useState } from 'react';
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

  // Live Price Calculation
  const goldPriceObj = marketPrices.find(p => p.symbol === 'XAU/USD');
  const rawGoldPrice = goldPriceObj ? parseFloat(goldPriceObj.price.replace(/,/g, '')) : 68450;
  const discount = 0.12; // 12%
  const logistics = 2400;
  const netProfit = (rawGoldPrice * (1 - discount)) - logistics;

  useEffect(() => {
    if (isOpen && item && !aiAnalysis) {
      const fetchAnalysis = async () => {
        setIsAnalyzing(true);
        try {
          const res = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context: `Analyze mining potential for ${item.company} in ${item.region}, ${item.country}. Commodity: ${item.commodity}. License Type: ${item.licenseType}.`,
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
      fetchAnalysis();
    }
  }, [isOpen, item, aiAnalysis]);

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

            {/* Tactical Grid Overview */}
            <div className="grid grid-cols-12 gap-8">
               
               {/* Left Column: Media & Primary Info */}
               <div className="col-span-12 lg:col-span-8 space-y-8">
                  {/* Hero Visual Card */}
                  <Card className="bg-white/5 border-white/5 overflow-hidden rounded-3xl">
                     <div className="h-[400px] w-full relative">
                        <img 
                          src="/Users/daniatallah/.gemini/antigravity/brain/3f50e707-6647-4760-8fc6-045d71a31ff2/mining_site_satellite_identification_1778315251596.png" 
                          className="w-full h-full object-cover grayscale-[20%] hover:grayscale-0 transition-all duration-1000"
                          alt="Hero identification"
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
                        <SpecItem label={t("נקודת מגע", "Primary Contact")} value={annotation.contactPerson || t("חסוי", "Confidential")} />
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
                        <Button className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-[10px] shadow-2xl">
                           {t("הפק דוח מודיעין מלא", "Execute Full Intelligence Dossier")}
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
                        
                        <Button className="w-full h-12 bg-white text-slate-950 hover:bg-slate-200 font-black uppercase tracking-widest text-[10px] mt-4 shadow-2xl">
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
                              <span className="text-sm font-black text-white">{annotation.contactPerson || t("לא ידוע", "Not Identified")}</span>
                           </div>
                           <Button size="icon" variant="ghost" className="h-10 w-10 text-slate-400 hover:text-white">
                              <LucideUser className="w-4 h-4" />
                           </Button>
                        </div>
                        <a 
                          href={annotation.phoneNumber ? `tel:${annotation.phoneNumber}` : '#'}
                          className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors"
                        >
                           <div className="flex flex-col">
                              <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{t("טלפון", "Phone Line")}</span>
                              <span className="text-sm font-black text-white">{annotation.phoneNumber || '--- --- ---'}</span>
                           </div>
                           <div className="h-10 w-10 flex items-center justify-center text-emerald-500">
                              <LucidePhone className="w-4 h-4" />
                           </div>
                        </a>
                     </div>
                  </Card>
               </div>
            </div>
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
