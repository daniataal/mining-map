import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { MapPin as LucideMapPin, Plus as LucidePlus } from 'lucide-react';

interface PopupFormProps {
  item: MiningLicense;
  annotation: UserAnnotation;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  onDelete: () => void;
  onOpenDossier?: () => void;
  isOpen: boolean;
}

export default function PopupForm({ 
  item, 
  annotation, 
  onOpenDossier
}: PopupFormProps) {
    const { t } = useI18n();
    const isGold = item.commodity?.toLowerCase().includes('gold') || annotation.commodity?.toLowerCase().includes('gold');

    return (
        <div className="flex flex-col w-[300px] bg-slate-950 border border-white/10 overflow-hidden text-slate-100 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
            {/* 1. Visual Identification Header */}
            <div className="relative h-40 w-full overflow-hidden group">
                <img 
                  src="/Users/daniatallah/.gemini/antigravity/brain/3f50e707-6647-4760-8fc6-045d71a31ff2/mining_site_satellite_identification_1778315251596.png" 
                  alt="Site Identification"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60" />
                <div className="absolute top-3 left-3 flex gap-2">
                   <Badge className="bg-slate-950/80 backdrop-blur-md border-white/10 text-[9px] font-black uppercase px-2 h-5 text-white">
                     {item.lat?.toFixed(4)}, {item.lng?.toFixed(4)}
                   </Badge>
                </div>
            </div>

            {/* 2. Identification Details */}
            <div className="p-4 pt-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-black text-sm tracking-tight leading-tight text-white uppercase italic truncate max-w-[180px]">
                      {item.company}
                    </h3>
                    <div className="flex items-center mt-1">
                      <LucideMapPin className="w-2.5 h-2.5 mr-1 text-slate-500" />
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{item.region}</p>
                    </div>
                  </div>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${isGold ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'}`}>
                    <LucideMapPin className="w-4 h-4" />
                  </div>
                </div>

                {/* 3. MarineTraffic Button Row */}
                <div className="grid grid-cols-2 gap-2 mt-5">
                   <Button 
                     variant="outline" 
                     size="sm" 
                     className="h-8 text-[9px] font-black uppercase tracking-widest border-slate-700 hover:bg-slate-800 flex items-center gap-2 text-slate-300"
                   >
                     <LucidePlus className="w-3 h-3" />
                     {t("הוסף לצי", "Add to Fleet")}
                   </Button>
                   <Button 
                     size="sm" 
                     className="h-8 text-[9px] font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center gap-2"
                     onClick={onOpenDossier}
                   >
                     {t("פרטי רשיון", "License Details")}
                   </Button>
                </div>

                {/* 4. Technical Specs (Grid) */}
                <div className="grid grid-cols-2 gap-px bg-white/5 border border-white/5 rounded-lg mt-5 overflow-hidden text-center">
                    <div className="p-2.5 flex flex-col items-center">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("סטטוס", "Status")}</span>
                       <span className="text-[10px] font-bold text-slate-200 uppercase tracking-tight">{item.status || 'Active'}</span>
                    </div>
                    <div className="p-2.5 border-l border-white/5 flex flex-col items-center">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("סחורה", "Commodity")}</span>
                       <span className="text-[10px] font-bold text-amber-500 uppercase tracking-tight">{item.commodity}</span>
                    </div>
                    <div className="p-2.5 border-t border-white/5 flex flex-col items-center">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("סוג", "Type")}</span>
                       <span className="text-[10px] font-bold text-slate-200 uppercase tracking-tight truncate w-full px-1">{item.licenseType || 'ML'}</span>
                    </div>
                    <div className="p-2.5 border-t border-l border-white/5 flex flex-col items-center">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("מזהה", "ID")}</span>
                       <span className="text-[10px] font-bold text-slate-200 uppercase tracking-tight">#{item.id.slice(0, 4)}</span>
                    </div>
                </div>

                <p className="mt-4 text-[9px] text-slate-600 font-bold text-center uppercase tracking-tighter">
                  {t("עודכן לאחרונה: לפני שעה, 12 דקות", "Last position received: 1h 12m ago")}
                </p>
            </div>
        </div>
    );
}
