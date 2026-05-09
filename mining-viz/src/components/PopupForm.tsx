import { useI18n } from '../lib/i18n';
import { MiningLicense, UserAnnotation } from '../types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { MapPin as LucideMapPin, Phone as LucidePhone } from 'lucide-react';

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
    const commodity = (item.commodity || annotation.commodity || '').toLowerCase();
    const isGold = commodity.includes('gold');
    const isDiamond = commodity.includes('diamond');
    
    // Tactical Asset Selection (Portable)
    const heroImage = isGold 
      ? "/assets/commodities/gold.png"
      : isDiamond 
      ? "/assets/commodities/diamond.png"
      : "/assets/commodities/satellite.png";

    return (
        <div className="flex flex-col w-[320px] bg-slate-950 border border-white/10 overflow-hidden text-slate-100 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
            {/* 1. Visual Commodity Identification */}
            <div className="relative h-44 w-full overflow-hidden group">
                <img 
                  src={heroImage} 
                  alt="Commodity Visual"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-80" />
                <div className="absolute top-3 left-3 flex gap-2">
                   <Badge className="bg-slate-950/80 backdrop-blur-md border-white/10 text-[9px] font-black uppercase px-2 h-5 text-white">
                     {item.lat?.toFixed(4)}, {item.lng?.toFixed(4)}
                   </Badge>
                   {annotation.phoneNumber && (
                     <Badge className="bg-emerald-500 text-slate-950 border-none text-[9px] font-black uppercase px-2 h-5">
                       {t("קו פעיל", "ACTIVE LINE")}
                     </Badge>
                   )}
                </div>
            </div>

            {/* 2. Identification Details */}
            <div className="p-4 pt-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h3 className="font-black text-sm tracking-tight leading-tight text-white uppercase italic truncate">
                      {item.company}
                    </h3>
                    <div className="flex items-center mt-1">
                      <LucideMapPin className="w-2.5 h-2.5 mr-1 text-slate-500" />
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate">{item.region}</p>
                    </div>
                  </div>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${isGold ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'}`}>
                    <LucideMapPin className="w-4 h-4" />
                  </div>
                </div>

                {/* 3. Direct Action Protocol */}
                <div className="grid grid-cols-2 gap-2 mt-5">
                   <Button 
                     size="sm" 
                     className={`h-9 text-[9px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg transition-all
                       ${annotation.phoneNumber ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                     onClick={() => annotation.phoneNumber && (window.location.href = `tel:${annotation.phoneNumber}`)}
                   >
                     <LucidePhone className="w-3.5 h-3.5" />
                     {t("התקשר לליד", "Call Lead")}
                   </Button>
                   <Button 
                     size="sm" 
                     className="h-9 text-[9px] font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center gap-2"
                     onClick={onOpenDossier}
                   >
                     {t("פרטי רשיון", "License Details")}
                   </Button>
                </div>

                {/* 4. Technical Specs (Flexible) */}
                <div className="grid grid-cols-2 gap-px bg-white/5 border border-white/5 rounded-lg mt-5 overflow-hidden">
                    <div className="p-3 flex flex-col items-center justify-center min-h-[50px] text-center">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("סטטוס", "Status")}</span>
                       <span className="text-[10px] font-bold text-slate-200 uppercase tracking-tight leading-tight">{item.status || 'Active'}</span>
                    </div>
                    <div className="p-3 border-l border-white/5 flex flex-col items-center justify-center min-h-[50px] text-center">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("טלפון", "Phone")}</span>
                       <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tight leading-tight">{annotation.phoneNumber || '---'}</span>
                    </div>
                    <div className="p-3 border-t border-white/5 flex flex-col items-center justify-center min-h-[50px] text-center col-span-2">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("סחורה וסוג", "Commodity & Type")}</span>
                       <span className="text-[10px] font-bold text-white uppercase tracking-tight leading-tight break-words">
                         <span className="text-amber-500">{item.commodity}</span> • {item.licenseType || 'ML'}
                       </span>
                    </div>
                </div>

                <p className="mt-4 text-[9px] text-slate-600 font-bold text-center uppercase tracking-tighter">
                  ID: #{item.id.slice(0, 8)} • {t("עודכן לאחרונה: לפני שעה", "Last updated: 1h ago")}
                </p>
            </div>
        </div>
    );
}
