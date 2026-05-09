import { useState, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { LucideEdit, LucideCheck, LucideX, LucideBrain, LucideTrash2, LucideFileText, LucidePhone, LucideUser } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PopupFormProps {
  item: MiningLicense;
  annotation: UserAnnotation;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  onDelete: () => void;
  commodities: string[];
  licenseTypes: string[];
  isMobile: boolean;
  onOpenDossier?: () => void;
  isOpen: boolean;
}

export default function PopupForm({ 
  item, 
  annotation, 
  updateAnnotation, 
  onDelete, 
  commodities, 
  licenseTypes, 
  isMobile, 
  onOpenDossier, 
  isOpen 
}: PopupFormProps) {
    const { t } = useI18n();
    const [isEditing, setIsEditing] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
    const [loadingAi, setLoadingAi] = useState(false);
    const [lbmaPricePerKg, setLbmaPricePerKg] = useState<number | null>(null);

    const API_BASE = import.meta.env.VITE_API_BASE ||
        (window.location.protocol === 'https:' ? '' : `http://${window.location.hostname}:8000`);

    const [formData, setFormData] = useState({
        comment: '',
        quantity: '',
        price: '',
        licenseType: '',
        commodity: '',
        phoneNumber: '',
        contactPerson: ''
    });

    useEffect(() => {
        if (!isOpen) setIsEditing(false);
    }, [isOpen]);

    useEffect(() => {
        if (!isEditing) {
            setFormData({
                comment: annotation.comment || '',
                quantity: annotation.quantity?.toString() || '',
                price: annotation.price?.toString() || '',
                licenseType: annotation.licenseType || item.licenseType || '',
                commodity: annotation.commodity || item.commodity || '',
                phoneNumber: annotation.phoneNumber || item.phoneNumber || '',
                contactPerson: annotation.contactPerson || item.contactPerson || ''
            });
        }
    }, [isEditing, annotation, item]);

    useEffect(() => {
        const commodity = formData.commodity || item.commodity || '';
        if (commodity.toLowerCase().includes('gold')) {
            fetch('https://data-asg.goldprice.org/dbXRates/USD')
                .then(res => res.json())
                .then(data => {
                    if (data.items && data.items.length > 0) {
                        const pricePerOz = data.items[0].xauPrice;
                        const pricePerKg = pricePerOz * 32.1507;
                        setLbmaPricePerKg(pricePerKg);
                    }
                })
                .catch(err => console.error("Failed to fetch gold price", err));
        }
    }, [formData.commodity, item.commodity]);

    const handleSave = () => {
        updateAnnotation(item.id, {
            comment: formData.comment,
            quantity: parseFloat(formData.quantity) || 0,
            price: parseFloat(formData.price) || 0,
            licenseType: formData.licenseType,
            commodity: formData.commodity,
            phoneNumber: formData.phoneNumber,
            contactPerson: formData.contactPerson
        });
        setIsEditing(false);
    };

    const igniteGemini = () => {
        setLoadingAi(true);
        const query = `Analyze the mining company "${item.company}" located in ${item.region}, ${item.country}. They are listed for commodity "${item.commodity}" with license type "${item.licenseType || 'Unknown'}". Verify their license status.`;

        fetch(`${API_BASE}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') setAiAnalysis(data.analysis);
                else setAiAnalysis("Could not generate report.");
            })
            .finally(() => setLoadingAi(false));
    };

    return (
        <div className="flex flex-col w-[340px] bg-slate-950/90 backdrop-blur-2xl border border-white/5 overflow-hidden text-slate-100 p-0 rounded-2xl shadow-2xl">
            <header className="p-5 bg-white/5 border-b border-white/5 flex items-center justify-between">
                <div className="flex-1 pr-4">
                    <h3 className="font-black text-sm tracking-tight leading-tight text-slate-50 uppercase italic">{item.company}</h3>
                    <div className="flex items-center mt-1">
                      <LucideMapPin className="w-2.5 h-2.5 mr-1 text-slate-500" />
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{item.region}, {item.country}</p>
                    </div>
                </div>
                {isEditing ? (
                    <div className="flex gap-1.5">
                        <Button size="icon" variant="ghost" className="h-8 w-8 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20" onClick={handleSave}>
                            <LucideCheck className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 bg-red-500/10 text-red-400 hover:bg-red-500/20" onClick={() => setIsEditing(false)}>
                            <LucideX className="w-4 h-4" />
                        </Button>
                    </div>
                ) : (
                    <Button size="sm" variant="ghost" className="h-8 px-3 text-[10px] font-bold uppercase border border-white/10 bg-white/5 hover:bg-white/10" onClick={() => setIsEditing(true)}>
                        <LucideEdit className="w-3 h-3 mr-1.5" /> {t("ערוך", "Edit")}
                    </Button>
                )}
            </header>

            <div className="p-5 space-y-5">
                {/* Status Quick Actions */}
                <div className="grid grid-cols-3 gap-1.5">
                    {['good', 'maybe', 'bad'].map((status) => (
                        <Button 
                            key={status}
                            variant="ghost" 
                            size="sm"
                            className={`h-9 text-[10px] font-black tracking-widest border transition-all duration-300 ${
                                annotation.status === status 
                                ? (status === 'good' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 
                                   status === 'maybe' ? 'bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : 
                                   'bg-red-500/20 text-red-400 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]')
                                : 'bg-white/5 border-white/5 text-slate-500 hover:text-slate-300 hover:bg-white/10'
                            }`}
                            onClick={() => updateAnnotation(item.id, { status: annotation.status === status ? undefined : status as any })}
                        >
                            {status === 'good' ? 'GO' : status === 'maybe' ? 'MAYBE' : 'NO'}
                        </Button>
                    ))}
                </div>

                {isMobile && onOpenDossier && (
                    <Button className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 text-[10px] font-black uppercase tracking-widest h-10" onClick={onOpenDossier}>
                        <LucideFileText className="w-3.5 h-3.5 mr-2" />
                        {t("צפה בתיק המלא", "View Full Dossier")}
                    </Button>
                )}

                {/* AI Research */}
                <div className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                    {!aiAnalysis && !loadingAi && (
                        <Button 
                            className="relative w-full bg-slate-950 hover:bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] h-10 border border-white/10"
                            onClick={igniteGemini}
                        >
                            <LucideBrain className="w-3.5 h-3.5 mr-2 text-indigo-400" />
                            {t("הפעל בינה מלאכותית", "Ignite Intelligence")}
                        </Button>
                    )}

                    {loadingAi && (
                        <div className="relative flex items-center justify-center h-10 bg-slate-950 rounded-xl border border-white/10 animate-pulse">
                            <span className="text-[10px] text-indigo-400 font-black tracking-widest uppercase">{t("מנתח נתונים...", "Analyzing Intelligence...")}</span>
                        </div>
                    )}
                </div>

                <AnimatePresence>
                    {aiAnalysis && (
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 relative"
                        >
                            <button className="absolute top-3 right-3 text-slate-500 hover:text-slate-300 transition-colors" onClick={() => setAiAnalysis(null)}>
                                <LucideX className="w-3.5 h-3.5" />
                            </button>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{t("ניתוח AI", "AI Intelligence Report")}</p>
                            </div>
                            <div className="text-[11px] text-slate-300 leading-relaxed max-h-[140px] overflow-y-auto pr-2 custom-scrollbar font-medium">
                                {aiAnalysis}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Data Grid */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/5 border border-white/5 rounded-xl p-3">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 block">{t("סוג רישיון", "License")}</label>
                        {isEditing ? (
                            <Input className="h-8 text-xs bg-slate-950 border-white/10 focus:border-amber-500/50" value={formData.licenseType} onChange={e => setFormData({...formData, licenseType: e.target.value})} />
                        ) : (
                            <p className="text-xs font-bold text-slate-200 truncate">{formData.licenseType || 'Unknown'}</p>
                        )}
                    </div>
                    <div className="bg-white/5 border border-white/5 rounded-xl p-3">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 block">{t("סחורה", "Commodity")}</label>
                        {isEditing ? (
                            <Input className="h-8 text-xs bg-slate-950 border-white/10 focus:border-amber-500/50" value={formData.commodity} onChange={e => setFormData({...formData, commodity: e.target.value})} />
                        ) : (
                            <p className="text-xs font-bold text-amber-500 truncate">{formData.commodity || 'Unknown'}</p>
                        )}
                    </div>
                </div>

                {/* Metrics */}
                <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex justify-between gap-4">
                    <div className="flex-1">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 block">{t("כמות (ק\"ג)", "Quantity")}</label>
                        {isEditing ? (
                            <Input type="number" className="h-8 text-xs bg-slate-950 border-white/10" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} />
                        ) : (
                            <p className="text-sm font-black text-slate-100">{formData.quantity || '-'}</p>
                        )}
                    </div>
                    <div className="w-px bg-white/5 h-8 self-center" />
                    <div className="flex-1">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 block">{t("מחיר ($)", "Valuation")}</label>
                        {isEditing ? (
                            <Input type="number" className="h-8 text-xs bg-slate-950 border-white/10" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                        ) : (
                            <p className="text-sm font-black text-slate-100">{formData.price || '-'}</p>
                        )}
                    </div>
                </div>

                <div className="bg-slate-900/50 border border-white/5 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-slate-500">
                        <LucideUser className="w-3.5 h-3.5" />
                        <span className="text-[9px] font-black uppercase tracking-widest">{t("פרטי התקשרות", "Direct Contact")}</span>
                    </div>
                    {isEditing ? (
                        <div className="space-y-2">
                            <Input className="h-8 text-xs bg-slate-950 border-white/10" placeholder={t("שם איש קשר", "Contact Name")} value={formData.contactPerson} onChange={e => setFormData({...formData, contactPerson: e.target.value})} />
                            <Input className="h-8 text-xs bg-slate-950 border-white/10" placeholder={t("מספר טלפון", "Phone Number")} value={formData.phoneNumber} onChange={e => setFormData({...formData, phoneNumber: e.target.value})} />
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <p className="text-xs text-slate-200 font-bold tracking-tight">{formData.contactPerson || t("אין איש קשר", "Confidential")}</p>
                            {formData.phoneNumber && (
                              <a href={`tel:${formData.phoneNumber}`} className="text-blue-400 hover:text-blue-300 transition-colors text-[11px] font-bold flex items-center gap-2 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20 w-fit">
                                <LucidePhone className="w-3 h-3" /> {formData.phoneNumber}
                              </a>
                            )}
                        </div>
                    )}
                </div>

                {isEditing && (
                    <Button variant="ghost" className="w-full text-red-500/60 hover:text-red-500 hover:bg-red-500/10 text-[9px] font-black uppercase tracking-widest h-8 transition-all" onClick={onDelete}>
                        <LucideTrash2 className="w-3 h-3 mr-2" />
                        {t("מחק רישיון", "Permanent Delete")}
                    </Button>
                )}
            </div>
        </div>
    );
}
