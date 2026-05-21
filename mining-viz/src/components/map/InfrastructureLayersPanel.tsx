import { Layers } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { Checkbox } from '../ui/checkbox';
import type { OsmPetroleumLayerId } from '../../lib/osmPetroleumLayers';

const LAYER_LABELS: Record<OsmPetroleumLayerId, [string, string]> = {
  pipelines: ['צינורות', 'Pipelines'],
  refineries: ['זיקוק', 'Refineries'],
  storage_terminals: ['מאגרי אחסון', 'Tank storage'],
};

type Props = {
  visibility: Record<OsmPetroleumLayerId, boolean>;
  onChange: (layerId: OsmPetroleumLayerId, visible: boolean) => void;
};

export default function InfrastructureLayersPanel({ visibility, onChange }: Props) {
  const { t } = useI18n();
  const ids = Object.keys(LAYER_LABELS) as OsmPetroleumLayerId[];

  return (
    <div className="pointer-events-auto rounded-lg border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 shadow-md p-2.5 max-w-[200px]">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1 mb-2">
        <Layers className="w-3 h-3" />
        {t('תשתיות', 'Infrastructure')}
      </p>
      <ul className="space-y-1.5">
        {ids.map((id) => (
          <li key={id} className="flex items-center gap-2">
            <Checkbox
              id={`infra-${id}`}
              checked={visibility[id]}
              onCheckedChange={(v) => onChange(id, v === true)}
            />
            <label
              htmlFor={`infra-${id}`}
              className="text-[10px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {t(LAYER_LABELS[id][0], LAYER_LABELS[id][1])}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
