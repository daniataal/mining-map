import { useI18n } from '../lib/i18n';
import { getLicenseHeroImageUrl } from '../lib/licenseHeroImage';
import { MiningLicense, UserAnnotation } from '../types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import AddToDueDiligenceButton from './AddToDueDiligenceButton';
import { MapPin as LucideMapPin, Phone as LucidePhone, Trash2 as LucideTrash2, AlertTriangle as LucideAlertTriangle } from 'lucide-react';

interface PopupFormProps {
  item: MiningLicense;
  annotation: UserAnnotation;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  onDelete: () => void;
  onOpenDossier?: () => void;
  isOpen: boolean;
  isInDdQueue?: boolean;
  onAddToDueDiligence?: () => void;
  onRemoveFromDueDiligence?: () => void;
  isEsgRisk?: boolean;
  esgZoneName?: string;
}

export default function PopupForm({
  item,
  annotation,
  onDelete,
  onOpenDossier,
  isInDdQueue = false,
  onAddToDueDiligence,
  onRemoveFromDueDiligence,
  isEsgRisk = false,
  esgZoneName,
}: PopupFormProps) {
    const { t } = useI18n();
    const commodity = (item.commodity || annotation.commodity || '').toLowerCase();
    const isGold = commodity.includes('gold');
    const isDiamond = commodity.includes('diamond');
    const sourceKindLabel = formatSourceKindLabel(item.sourceKind);
    const isManagedInfrastructureEntity = Boolean(item.entityKind && item.entityKind !== 'license');
    
    const heroImage = getLicenseHeroImageUrl(item);

    return (
        <div className="flex flex-col w-[320px] bg-white dark:bg-slate-950 border border-black/10 dark:border-white/10 overflow-hidden text-slate-800 dark:text-slate-100 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
            {/* 1. Visual Commodity Identification */}
            <div className="relative h-44 w-full overflow-hidden group">
                <img 
                  src={heroImage} 
                  alt="Commodity Visual"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 dark:from-slate-950 via-transparent to-transparent opacity-80" />
                <div className="absolute top-3 left-3 flex gap-2 flex-wrap max-w-[260px]">
                   <Badge className="bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-black/10 dark:border-white/10 text-[9px] font-black uppercase px-2 h-5 text-slate-900 dark:text-white">
                     {item.lat?.toFixed(4)}, {item.lng?.toFixed(4)}
                   </Badge>
                   {item.geoApproximated && (
                     <Badge
                       title={item.geoSource ? `Coords approximated via ${item.geoSource}` : 'Coords are an approximation, not the surveyed point'}
                       className="bg-amber-500/90 text-slate-950 border-none text-[9px] font-black uppercase px-2 h-5"
                     >
                       {t("מיקום משוער", "≈ APPROX LOCATION")}
                     </Badge>
                   )}
                   {isEsgRisk && (
                     <Badge className="bg-red-500 hover:bg-red-600 text-white animate-pulse border-none text-[8px] font-black uppercase px-2 h-5 flex items-center gap-1 shadow-lg shadow-red-500/20">
                       <LucideAlertTriangle className="w-3 h-3 text-white" />
                       {t("סיכון סביבתי", "ESG RISK ZONE")}
                     </Badge>
                   )}
                   {(item.phoneNumber || annotation.phoneNumber) && (
                     <Badge className="bg-emerald-500 text-slate-950 border-none text-[9px] font-black uppercase px-2 h-5">
                       {t("קו פעיל", "ACTIVE LINE")}
                     </Badge>
                   )}
                   {item.sourceName && (
                     <Badge className="bg-slate-950/80 text-white border-none text-[9px] font-black uppercase px-2 h-5">
                       {item.sourceName}
                     </Badge>
                   )}
                   {sourceKindLabel && (
                     <Badge className={getSourceKindBadgeClass(item.sourceKind)}>
                       {sourceKindLabel}
                     </Badge>
                   )}
                   {typeof item.confidenceScore === 'number' && (
                     <Badge
                       title={item.confidenceNote || 'Source confidence score'}
                       className="bg-emerald-500/90 text-slate-950 border-none text-[9px] font-black uppercase px-2 h-5"
                     >
                       {t('אמון', 'TRUST')} {(item.confidenceScore * 100).toFixed(0)}%
                     </Badge>
                   )}
                </div>
            </div>

            {/* 2. Identification Details */}
            <div className="p-4 pt-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h3 className="font-black text-sm tracking-tight leading-tight text-slate-900 dark:text-white uppercase italic truncate">
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
                       ${(item.phoneNumber || annotation.phoneNumber) ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                     onClick={() => { const ph = item.phoneNumber || annotation.phoneNumber; if (ph) window.location.href = `tel:${ph}`; }}
                   >
                     <LucidePhone className="w-3.5 h-3.5" />
                     {t("התקשר לליד", "Call Lead")}
                   </Button>
                   <Button 
                     size="sm" 
                     className="h-9 text-[9px] font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center gap-2"
                     onClick={onOpenDossier}
                   >
                     {t("פרטי נכס", "Open Dossier")}
                   </Button>
                </div>

                {onAddToDueDiligence && onRemoveFromDueDiligence && (
                  <div className="mt-2">
                    <AddToDueDiligenceButton
                      isInQueue={isInDdQueue}
                      onAdd={onAddToDueDiligence}
                      onRemove={onRemoveFromDueDiligence}
                    />
                  </div>
                )}

                {!isManagedInfrastructureEntity && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 h-9 text-[9px] font-black uppercase tracking-widest border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:border-red-500/30 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                    onClick={onDelete}
                  >
                    <LucideTrash2 className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                    {t('מחק רישיון', 'Delete license')}
                  </Button>
                )}

                {/* 4. Technical Specs (Flexible) */}
                <div className="grid grid-cols-2 gap-px bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-lg mt-5 overflow-hidden">
                    <div className="p-3 flex flex-col items-center justify-center min-h-[50px] text-center">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("סטטוס", "Status")}</span>
                       <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight leading-tight">{item.status || 'Active'}</span>
                    </div>
                    <div className="p-3 border-l border-black/5 dark:border-white/5 flex flex-col items-center justify-center min-h-[50px] text-center">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("טלפון", "Phone")}</span>
                       <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tight leading-tight">{item.phoneNumber || annotation.phoneNumber || '---'}</span>
                    </div>
                    <div className="p-3 border-t border-black/5 dark:border-white/5 flex flex-col items-center justify-center min-h-[50px] text-center col-span-2">
                       <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{t("סחורה וסוג", "Commodity & Type")}</span>
                       <span className="text-[10px] font-bold text-slate-900 dark:text-white uppercase tracking-tight leading-tight break-words">
                         <span className="text-amber-500">{item.commodity}</span> • {item.licenseType || 'ML'}
                       </span>
                    </div>
                    {isManagedInfrastructureEntity && (
                      <div className="p-3 border-t border-black/5 dark:border-white/5 flex flex-col items-center justify-center min-h-[50px] text-center col-span-2">
                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">
                          {t("מזהה והקשר", "Locator & Context")}
                        </span>
                        <span className="text-[10px] font-bold text-slate-900 dark:text-white uppercase tracking-tight leading-tight break-words">
                          {item.locode || '—'}
                          {item.nearbyPort?.name ? ` • ${item.nearbyPort.name}` : item.operatorName ? ` • ${item.operatorName}` : ''}
                        </span>
                      </div>
                    )}
                </div>

                <p className="mt-4 text-[9px] text-slate-400 dark:text-slate-600 font-bold text-center uppercase tracking-tighter">
                  ID: #{item.id.slice(0, 8)}
                  {item.lastSyncedAt ? ` • ${t("סונכרן", "Synced")} ${new Date(item.lastSyncedAt).toLocaleDateString()}` : ''}
                </p>
            </div>
        </div>
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
      return 'bg-cyan-500/90 text-slate-950 border-none text-[9px] font-black uppercase px-2 h-5';
    case 'global_open_fallback':
      return 'bg-violet-500/90 text-white border-none text-[9px] font-black uppercase px-2 h-5';
    case 'user_import_csv':
      return 'bg-amber-500/90 text-slate-950 border-none text-[9px] font-black uppercase px-2 h-5';
    default:
      return 'bg-slate-700/90 text-white border-none text-[9px] font-black uppercase px-2 h-5';
  }
}
