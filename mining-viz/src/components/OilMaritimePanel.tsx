import { MaritimeVessel } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import MaritimeContextPanel from './MaritimeContextPanel';
import { useI18n } from '../lib/i18n';
import {
  Anchor as IconAnchor,
  Ship as IconShip,
  X as IconX,
} from 'lucide-react';

interface OilMaritimePanelProps {
  vessel: MaritimeVessel;
  onClose: () => void;
}

function fmtValue(value?: string | number | null, fallback = 'N/A'): string {
  if (value == null || value === '') return fallback;
  return String(value);
}

export default function OilMaritimePanel({ vessel, onClose }: OilMaritimePanelProps) {
  const { t } = useI18n();

  return (
    <Card className="w-[380px] max-h-[calc(100vh-120px)] overflow-hidden bg-white/95 dark:bg-slate-950/95 border border-black/10 dark:border-white/10 rounded-3xl shadow-2xl backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-3 p-5 border-b border-black/5 dark:border-white/5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
              <IconShip className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
                {t('מעקב ימי', 'Maritime Watch')}
              </p>
              <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                {vessel.vessel_name}
              </h3>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge className="bg-slate-950/10 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-none text-[8px] font-black uppercase">
              MMSI {vessel.mmsi}
            </Badge>
            {vessel.imo && (
              <Badge className="bg-slate-950/10 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-none text-[8px] font-black uppercase">
                IMO {vessel.imo}
              </Badge>
            )}
            <Badge className="bg-cyan-500/10 text-cyan-400 border-none text-[8px] font-black uppercase">
              {vessel.ship_type_label || 'Vessel'}
            </Badge>
          </div>
        </div>

        <Button
          onClick={onClose}
          variant="ghost"
          className="h-9 w-9 p-0 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <IconX className="w-4 h-4" />
        </Button>
      </div>

      <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(100vh-220px)]">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Observed</p>
            <p className="text-[10px] font-bold text-slate-900 dark:text-white">
              {new Date(vessel.observed_at).toLocaleString()}
            </p>
          </div>
          <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Speed</p>
            <p className="text-[10px] font-bold text-slate-900 dark:text-white">
              {fmtValue(vessel.speed_knots != null ? `${vessel.speed_knots} kn` : null)}
            </p>
          </div>
          <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4 col-span-2">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Coordinates</p>
            <p className="text-[10px] font-bold text-slate-900 dark:text-white">
              {vessel.lat.toFixed(4)}, {vessel.lng.toFixed(4)}
            </p>
          </div>
          <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4 col-span-2">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Destination</p>
            <p className="text-[10px] font-bold text-slate-900 dark:text-white">
              {fmtValue(vessel.destination, t('לא דווח', 'Not reported in current watch'))}
            </p>
          </div>
        </div>

        {vessel.nearest_port && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 mb-1">
              <IconAnchor className="w-4 h-4 text-emerald-400" />
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                {t('עוגן נמל קרוב', 'Nearest port context')}
              </p>
            </div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{vessel.nearest_port.name}</p>
            <p className="text-[10px] text-slate-500">
              {[vessel.nearest_port.unlocode, vessel.nearest_port.country_iso2].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}

        <MaritimeContextPanel
          query={{
            vessel_name: vessel.vessel_name,
            mmsi: vessel.mmsi,
            imo: vessel.imo || '',
            destination: vessel.destination || '',
            lat: vessel.lat,
            lng: vessel.lng,
          }}
          section="all"
        />
      </div>
    </Card>
  );
}
