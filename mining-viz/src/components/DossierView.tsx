import { useState, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { LucideX, LucideMapPin, LucideShieldCheck, LucideFileText, LucideBrain, LucideGlobe, LucideMessageSquare, LucidePlus, LucideTrash2, LucideExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface DossierViewProps {
  item: MiningLicense | null;
  annotation: UserAnnotation;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  onClose: () => void;
  onOpenPopup?: (item: MiningLicense) => void;
  isOpen: boolean;
}

export default function DossierView({ item, annotation, updateAnnotation, onClose, onOpenPopup, isOpen }: DossierViewProps) {
    const { t, isRtl } = useI18n();
    const [newNote, setNewNote] = useState('');
    const [uploading, setUploading] = useState(false);
    const [files, setFiles] = useState<any[]>([]);
    const [aiReport, setAiReport] = useState<string | null>(null);
    const [loadingAi, setLoadingAi] = useState(false);

    const API_BASE = import.meta.env.VITE_API_BASE ||
        (window.location.protocol === 'https:' ? '' : `http://${window.location.hostname}:8000`);

    const fetchFileList = () => {
        if (!item?.id) return;
        fetch(`${API_BASE}/licenses/${item.id}/files`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setFiles(data);
                else setFiles([]);
            })
            .catch(() => setFiles([]));
    };

    useEffect(() => {
        if (isOpen && item) {
            setFiles([]);
            setAiReport(null);
            fetchFileList();
        }
    }, [isOpen, item]);

    if (!item) return null;

    const verification = annotation?.verification || {};
    const activityLog = (annotation?.activityLog as any[]) || [];

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !item) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        fetch(`${API_BASE}/licenses/${item.id}/files`, {
            method: 'POST',
            body: formData
        })
            .then(res => res.json())
            .then(newFile => {
                if (!newFile.error) {
                    setFiles(prev => [newFile, ...prev]);
                }
            })
            .finally(() => {
                setUploading(false);
                e.target.value = '';
            });
    };

    const addNote = () => {
        if (!newNote.trim()) return;
        const note = {
            id: Date.now(),
            text: newNote,
            date: new Date().toISOString()
        };
        updateAnnotation(item.id, { activityLog: [note, ...activityLog] });
        setNewNote('');
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-slate-950/20 backdrop-blur-sm z-[100]"
                    />

                    {/* Panel */}
                    <motion.div
                        initial={{ x: isRtl ? -500 : 500, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: isRtl ? -500 : 500, opacity: 0 }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className={`fixed top-4 bottom-4 ${isRtl ? 'left-4' : 'right-4'} w-[420px] bg-slate-950/80 backdrop-blur-3xl border border-white/5 shadow-[0_0_50px_rgba(0,0,0,0.5)] z-[101] flex flex-col rounded-3xl overflow-hidden`}
                    >
                        <header className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5 backdrop-blur-md sticky top-0 z-10">
                            <div>
                                <h2 className="text-xl font-black text-slate-50 uppercase italic tracking-tight">{item.company}</h2>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-500 bg-amber-500/5 font-black uppercase tracking-widest px-1.5 h-4">
                                    {item.id}
                                  </Badge>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{item.region}, {item.country}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" onClick={onClose} className="h-10 w-10 text-slate-500 hover:text-slate-200 hover:bg-white/5 rounded-full transition-all">
                                    <LucideX className="w-5 h-5" />
                                </Button>
                            </div>
                        </header>

                        <ScrollArea className="flex-1">
                            <div className="p-8 space-y-10">
                                {/* Overview */}
                                <section className="space-y-4">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">{t("סקירה טקטית", "Tactical Overview")}</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 shadow-inner">
                                            <p className="text-[9px] uppercase font-black text-slate-500 tracking-widest mb-1.5">{t("סוג רישיון", "License Class")}</p>
                                            <p className="text-sm font-black text-slate-100 uppercase italic tracking-tight">{annotation.licenseType || item.licenseType}</p>
                                        </div>
                                        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 shadow-inner">
                                            <p className="text-[9px] uppercase font-black text-slate-500 tracking-widest mb-1.5">{t("סחורה", "Commodity")}</p>
                                            <p className="text-sm font-black text-amber-500 uppercase italic tracking-tight">{annotation.commodity || item.commodity}</p>
                                        </div>
                                        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 shadow-inner">
                                            <p className="text-[9px] uppercase font-black text-slate-500 tracking-widest mb-1.5">{t("אזור פעילות", "Region Hub")}</p>
                                            <p className="text-sm font-black text-slate-100 uppercase italic tracking-tight">{item.region}</p>
                                        </div>
                                        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 shadow-inner">
                                            <p className="text-[9px] uppercase font-black text-slate-500 tracking-widest mb-1.5">{t("סטטוס אימות", "Trust Score")}</p>
                                            <Badge className="bg-emerald-500/20 text-emerald-500 border-none font-black text-[10px] px-2 h-5">VERIFIED</Badge>
                                        </div>
                                    </div>
                                </section>

                                {/* Intelligence Dashboard */}
                                <section className="relative group">
                                    <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                                    <div className="relative p-6 rounded-2xl bg-slate-950 border border-white/10 space-y-4">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="flex items-center gap-2 text-indigo-400">
                                              <LucideBrain className="w-5 h-5 shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
                                              <h3 className="font-black uppercase tracking-widest text-xs italic">{t("מודיעין Gemini", "Gemini Intelligence OS")}</h3>
                                          </div>
                                          <Badge variant="outline" className="text-[9px] border-indigo-500/30 text-indigo-400 bg-indigo-500/5 px-2 h-5 font-black">AI LIVE</Badge>
                                        </div>
                                        <p className="text-[11px] font-medium text-slate-400 leading-relaxed italic">
                                            {t("מנוע הבינה המלאכותית מנתח כעת נתונים גיאוגרפיים, רגולטוריים והיסטוריים עבור ישות זו.", "Deep-learning analysis active. Synthesizing geospatial, regulatory, and historical data for this entity.")}
                                        </p>
                                        <div className="flex gap-3 pt-2">
                                            <Button className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-slate-950 font-black uppercase tracking-widest text-[10px] h-10 shadow-[0_0_20px_rgba(99,102,241,0.3)] transition-all active:scale-95">
                                                <LucideBrain className="w-4 h-4 mr-2" />
                                                {t("הפק דו\"ח", "Execute Dossier")}
                                            </Button>
                                            <Button variant="ghost" className="flex-1 border border-white/10 text-white hover:bg-white/5 text-[10px] font-black uppercase tracking-widest h-10">
                                                <LucideExternalLink className="w-4 h-4 mr-2" />
                                                {t("מקורות", "Source Data")}
                                            </Button>
                                        </div>
                                    </div>
                                </section>

                                {/* Verification Checklist */}
                                <section className="space-y-4">
                                    <div className="flex items-center gap-2 text-slate-300">
                                        <LucideShieldCheck className="w-4 h-4 text-emerald-500" />
                                        <h3 className="text-xs font-bold uppercase tracking-wider">{t("רשימת אימות", "Verification Checklist")}</h3>
                                    </div>
                                    <div className="space-y-2">
                                        {['govMatch', 'taxClearance', 'siteVisit', 'videoCall'].map((key) => (
                                            <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 border border-slate-800 hover:bg-slate-800/50 transition-colors">
                                                <span className="text-sm text-slate-300">
                                                    {key === 'govMatch' && t("התאמה למסד נתונים רשמי", "Official Gov Database Match")}
                                                    {key === 'taxClearance' && t("אישור מס תקף", "Valid Tax Clearance")}
                                                    {key === 'siteVisit' && t("ביקור פיזי באתר", "Physical Site Visit")}
                                                    {key === 'videoCall' && t("שיחת וידאו עם הבעלים", "Video Call with Owner")}
                                                </span>
                                                <input 
                                                    type="checkbox" 
                                                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                                                    checked={verification[key] || false}
                                                    onChange={() => {
                                                        updateAnnotation(item.id, { 
                                                            verification: { ...verification, [key]: !verification[key] } 
                                                        });
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                {/* Documents */}
                                <section className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-slate-300">
                                            <LucideFileText className="w-4 h-4 text-blue-500" />
                                            <h3 className="text-xs font-bold uppercase tracking-wider">{t("מסמכים", "Documents")}</h3>
                                        </div>
                                        <label className="cursor-pointer">
                                            <div className="flex items-center gap-1 text-[10px] font-bold text-blue-500 hover:text-blue-400 uppercase tracking-tight">
                                                <LucidePlus className="w-3 h-3" /> {t("העלה", "Upload")}
                                            </div>
                                            <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                                        </label>
                                    </div>
                                    <div className="space-y-2">
                                        {files.map(file => (
                                            <div key={file.id} className="flex items-center justify-between p-2 px-3 rounded-lg bg-slate-800/20 border border-slate-800">
                                                <a 
                                                    href={`${API_BASE}${file.url}`} 
                                                    target="_blank" 
                                                    rel="noreferrer"
                                                    className="text-xs font-medium text-blue-400 hover:underline flex items-center gap-2 truncate pr-4"
                                                >
                                                    <LucideFileText className="w-3 h-3 flex-shrink-0" />
                                                    {file.filename}
                                                </a>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-600 hover:text-red-500">
                                                    <LucideTrash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ))}
                                        {files.length === 0 && <p className="text-[11px] text-slate-600 italic text-center py-4">{t("אין מסמכים שהועלו", "No documents uploaded")}</p>}
                                    </div>
                                </section>

                                {/* Activity Log */}
                                <section className="space-y-4">
                                    <div className="flex items-center gap-2 text-slate-300">
                                        <LucideMessageSquare className="w-4 h-4 text-slate-400" />
                                        <h3 className="text-xs font-bold uppercase tracking-wider">{t("יומן פעילות", "Activity Log")}</h3>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="relative">
                                            <textarea 
                                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm focus:ring-1 focus:ring-slate-700 outline-none min-h-[100px]"
                                                placeholder={t("הוסף הערה...", "Add a note...")}
                                                value={newNote}
                                                onChange={e => setNewNote(e.target.value)}
                                            />
                                            <Button 
                                                size="sm" 
                                                className="absolute bottom-2 right-2 h-7 text-[10px] bg-slate-800 hover:bg-slate-700"
                                                onClick={addNote}
                                            >
                                                {t("הוסף", "Add")}
                                            </Button>
                                        </div>
                                        <div className="space-y-4 pt-2">
                                            {activityLog.map((log: any) => (
                                                <div key={log.id} className="border-l border-slate-800 pl-4 space-y-1">
                                                    <p className="text-[10px] font-bold text-slate-600">{new Date(log.date).toLocaleString()}</p>
                                                    <p className="text-xs text-slate-300 leading-relaxed">{log.text}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </ScrollArea>

                        <footer className="p-4 border-t border-slate-800 bg-slate-900/50">
                            <Button className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold">
                                <LucideGlobe className="w-4 h-4 mr-2" />
                                {t("יצוא לבורסה", "Export to Marketplace")}
                            </Button>
                        </footer>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
