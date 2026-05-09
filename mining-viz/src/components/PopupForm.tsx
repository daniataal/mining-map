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
        <div className="flex flex-col w-[320px] bg-slate-900 overflow-hidden text-slate-100 p-0 rounded-lg">
            <header className="p-4 bg-slate-800/50 border-b border-slate-700 flex items-center justify-between">
                <div className="flex-1 pr-4">
                    <h3 className="font-bold text-sm truncate">{item.company}</h3>
                    <p className="text-[10px] text-slate-400">{item.region}, {item.country}</p>
                </div>
                {isEditing ? (
                    <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-500" onClick={handleSave}>
                            <LucideCheck className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400" onClick={() => setIsEditing(false)}>
                            <LucideX className="w-4 h-4" />
                        </Button>
                    </div>
                ) : (
                    <Button size="sm" variant="outline" className="h-7 text-[10px] border-slate-700 bg-slate-800" onClick={() => setIsEditing(true)}>
                        <LucideEdit className="w-3 h-3 mr-1" /> {t("ערוך", "Edit")}
                    </Button>
                )}
            </header>

            <div className="p-4 space-y-4">
                {/* Status Quick Actions */}
                <div className="grid grid-cols-3 gap-1">
                    {['good', 'maybe', 'bad'].map((status) => (
                        <Button 
                            key={status}
                            variant="outline" 
                            size="sm"
                            className={`h-8 text-[10px] font-bold border-slate-800 transition-all ${
                                annotation.status === status 
                                ? (status === 'good' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/50' : 
                                   status === 'maybe' ? 'bg-amber-500/10 text-amber-500 border-amber-500/50' : 
                                   'bg-red-500/10 text-red-500 border-red-500/50')
                                : 'bg-slate-950 text-slate-500 hover:text-slate-300'
                            }`}
                            onClick={() => updateAnnotation(item.id, { status: annotation.status === status ? undefined : status as any })}
                        >
                            {status === 'good' ? 'GO' : status === 'maybe' ? 'MAYBE' : 'NO'}
                        </Button>
                    ))}
                </div>

                {isMobile && onOpenDossier && (
                    <Button className="w-full bg-blue-600 hover:bg-blue-700 text-xs font-bold h-9" onClick={onOpenDossier}>
                        <LucideFileText className="w-3 h-3 mr-2" />
                        {t("צפה בתיק המלא", "View Full Dossier")}
                    </Button>
                )}

                {/* AI Research */}
                {!aiAnalysis && !loadingAi && (
                    <Button 
                        className="w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold text-[10px] h-9 shadow-lg shadow-indigo-500/20"
                        onClick={igniteGemini}
                    >
                        <LucideBrain className="w-3 h-3 mr-2" />
                        {t("הפעל בינה מלאכותית", "Ignite Gemini Intelligence")}
                    </Button>
                )}

                {loadingAi && (
                    <div className="flex items-center justify-center p-2 bg-slate-950 rounded-lg border border-slate-800 animate-pulse">
                        <span className="text-[10px] text-indigo-400 font-bold">{t("מנתח נתונים...", "Analyzing Intelligence...")}</span>
                    </div>
                )}

                <AnimatePresence>
                    {aiAnalysis && (
                        <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="bg-slate-950 border border-slate-800 rounded-lg p-3 relative"
                        >
                            <button className="absolute top-2 right-2 text-slate-500 hover:text-slate-300" onClick={() => setAiAnalysis(null)}>
                                <LucideX className="w-3 h-3" />
                            </button>
                            <p className="text-[9px] font-bold text-indigo-400 uppercase mb-2">{t("ניתוח AI", "AI Analysis")}</p>
                            <div className="text-[10px] text-slate-300 leading-relaxed max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                                {aiAnalysis}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Fields */}
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-3">
                    <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase">{t("סוג רישיון", "License Type")}</label>
                        {isEditing ? (
                            <Input className="h-7 text-xs bg-slate-900 border-slate-700" value={formData.licenseType} onChange={e => setFormData({...formData, licenseType: e.target.value})} />
                        ) : (
                            <p className="text-xs font-medium text-slate-200">{formData.licenseType || 'Unknown'}</p>
                        )}
                    </div>
                    <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase">{t("סחורה", "Commodity")}</label>
                        {isEditing ? (
                            <Input className="h-7 text-xs bg-slate-900 border-slate-700" value={formData.commodity} onChange={e => setFormData({...formData, commodity: e.target.value})} />
                        ) : (
                            <p className="text-xs font-medium text-amber-500">{formData.commodity || 'Unknown'}</p>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[9px] font-bold text-slate-500 uppercase">{t("כמות (ק\"ג)", "Qty (kg)")}</label>
                            {isEditing ? (
                                <Input type="number" className="h-7 text-xs bg-slate-900 border-slate-700" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} />
                            ) : (
                                <p className="text-xs font-medium text-slate-200">{formData.quantity || '-'}</p>
                            )}
                        </div>
                        <div>
                            <label className="text-[9px] font-bold text-slate-500 uppercase">{t("מחיר ($)", "Price ($)")}</label>
                            {isEditing ? (
                                <Input type="number" className="h-7 text-xs bg-slate-900 border-slate-700" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                            ) : (
                                <p className="text-xs font-medium text-slate-200">{formData.price || '-'}</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="bg-slate-800/30 border border-slate-800 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2 text-slate-400">
                        <LucideUser className="w-3 h-3" />
                        <span className="text-[10px] font-bold uppercase">{t("פרטי התקשרות", "Contact Details")}</span>
                    </div>
                    {isEditing ? (
                        <div className="space-y-2">
                            <Input className="h-7 text-xs bg-slate-950 border-slate-700" placeholder={t("שם", "Name")} value={formData.contactPerson} onChange={e => setFormData({...formData, contactPerson: e.target.value})} />
                            <Input className="h-7 text-xs bg-slate-950 border-slate-700" placeholder={t("טלפון", "Phone")} value={formData.phoneNumber} onChange={e => setFormData({...formData, phoneNumber: e.target.value})} />
                        </div>
                    ) : (
                        <div className="text-xs space-y-1">
                            <p className="text-slate-200 font-medium">{formData.contactPerson || t("אין איש קשר", "No contact info")}</p>
                            {formData.phoneNumber && <a href={`tel:${formData.phoneNumber}`} className="text-blue-400 hover:underline flex items-center gap-1">
                                <LucidePhone className="w-2 h-2" /> {formData.phoneNumber}
                            </a>}
                        </div>
                    )}
                </div>

                {isEditing && (
                    <Button variant="ghost" className="w-full text-red-500 hover:text-red-400 hover:bg-red-500/10 text-[10px] h-8" onClick={onDelete}>
                        <LucideTrash2 className="w-3 h-3 mr-1" />
                        {t("מחק רישיון", "Delete License")}
                    </Button>
                )}
            </div>
        </div>
    );
}
