import { useMemo } from 'react';
import { usePortLogisticsDetails } from '../lib/api';
import { MiningLicense } from '../types';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { useI18n } from '../lib/i18n';
import {
  AlertTriangle as IconAlert,
  Anchor as IconAnchor,
  ExternalLink as IconExternalLink,
  FileSearch as IconFileSearch,
  PackageSearch as IconPackageSearch,
  TrainFront as IconTrain,
} from 'lucide-react';

interface PortLogisticsPanelProps {
  item: MiningLicense;
  section?: 'summary' | 'evidence' | 'all';
  enabled?: boolean;
}

function fmtSeenAt(value?: string | null): string {
  if (!value) return 'Timestamp unavailable';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function fmtDistance(distanceKm?: number | null): string {
  if (distanceKm == null) return 'Distance n/a';
  if (distanceKm >= 1000) return `${(distanceKm / 1000).toFixed(1)}k km`;
  return `${distanceKm.toFixed(1)} km`;
}

function fmtConfidence(score?: number | null): string {
  if (score == null) return 'Unscored';
  return `${Math.round(score * 100)}% confidence`;
}

export default function PortLogisticsPanel({
  item,
  section = 'all',
  enabled = true,
}: PortLogisticsPanelProps) {
  const { t } = useI18n();
  const isEnabled = enabled && Boolean(item.entityKind === 'port' || item.entityKind === 'logistics_node');
  const { data, isLoading, error } = usePortLogisticsDetails(item.id, isEnabled);

  const visibleSections = useMemo(() => {
    if (section === 'all') return new Set(['summary', 'evidence']);
    return new Set([section]);
  }, [section]);

  if (!isEnabled) return null;

  if (isLoading) {
    return (
      <Card className="bg-white/5 border-white/5 rounded-3xl p-5">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
              {t('טוען הקשר לוגיסטי', 'Loading logistics context')}
            </p>
            <p className="text-[10px] text-slate-500">
              {t('UN/LOCODE · OpenStreetMap · GDELT', 'UN/LOCODE · OpenStreetMap · GDELT')}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-red-500/5 border-red-500/10 rounded-3xl p-5">
        <div className="flex items-start gap-3">
          <IconAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-400">
              {t('שגיאת לוגיסטיקה', 'Logistics detail failed')}
            </p>
            <p className="text-[10px] text-slate-400">{String((error as Error)?.message || error)}</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const showSummary = visibleSections.has('summary');
  const showEvidence = visibleSections.has('evidence');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(data.sourceLabels || []).map((label) => (
          <Badge key={label} className="bg-cyan-500/10 text-cyan-400 border-none text-[8px] font-black uppercase">
            {label}
          </Badge>
        ))}
        <span className="text-[9px] text-slate-500 uppercase tracking-widest ml-auto">
          {t('עודכן', 'Updated')} {fmtSeenAt(data.dataAsOf || data.sourceUpdatedAt || data.lastSyncedAt)}
        </span>
      </div>

      {showSummary && (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <IconAnchor className="w-4 h-4 text-cyan-400" />
            <h4 className="text-[11px] font-black uppercase tracking-widest text-cyan-400">
              {t('תמונת לוגיסטיקה', 'Logistics Snapshot')}
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Subtype</p>
              <p className="text-sm font-bold text-slate-100">{data.licenseType}</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">UN/LOCODE</p>
              <p className="text-sm font-bold text-slate-100">{data.locode || 'Not published'}</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Match Quality</p>
              <p className="text-sm font-bold text-slate-100">{fmtConfidence(data.confidenceScore)}</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Nearby Port</p>
              <p className="text-sm font-bold text-slate-100">{data.nearbyPort?.name || 'This record is itself a port anchor'}</p>
            </div>
          </div>

          {data.nearbyInfrastructure.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <IconTrain className="w-4 h-4 text-emerald-400" />
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                  {t('תשתית קרובה', 'Nearby Infrastructure')}
                </p>
              </div>
              {data.nearbyInfrastructure.map((link) => (
                <div key={link.id} className="rounded-2xl border border-white/5 bg-black/10 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-100 truncate">
                        {link.label}
                      </p>
                      <p className="mt-1 text-[9px] text-slate-500">
                        {[link.kind.replaceAll('_', ' '), fmtDistance(link.distance_km)].filter(Boolean).join(' · ')}
                      </p>
                      {link.summary && (
                        <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">{link.summary}</p>
                      )}
                    </div>
                    {link.url && (
                      <Button asChild variant="ghost" className="h-8 px-3 text-[9px] font-black uppercase tracking-widest text-cyan-400 hover:text-cyan-300">
                        <a href={link.url} target="_blank" rel="noopener noreferrer">
                          <IconExternalLink className="w-3.5 h-3.5 mr-1.5" />
                          OSM
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                {t('אין תשתית קרובה', 'No nearby mapped infrastructure')}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                {t(
                  'לא נמצאה כרגע תשתית OSM סמוכה ברדיוס הקבוע.',
                  'No nearby OSM infrastructure was found inside the current detail radius.'
                )}
              </p>
            </div>
          )}
        </Card>
      )}

      {showEvidence && (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <IconFileSearch className="w-4 h-4 text-indigo-400" />
            <h4 className="text-[11px] font-black uppercase tracking-widest text-indigo-400">
              {t('ראיות גולמיות', 'Raw Evidence')}
            </h4>
          </div>

          {data.evidence.length > 0 ? (
            <div className="space-y-3">
              {data.evidence.map((item) => (
                <a
                  key={item.id}
                  href={item.url || '#'}
                  target={item.url ? '_blank' : undefined}
                  rel={item.url ? 'noopener noreferrer' : undefined}
                  className="block rounded-2xl border border-white/5 bg-black/10 p-4 hover:bg-black/20 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-100 leading-relaxed">
                        {item.title}
                      </p>
                      <p className="mt-1 text-[9px] text-slate-500">
                        {[item.source_label, fmtSeenAt(item.seen_at)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Badge className="bg-indigo-500/10 text-indigo-400 border-none text-[8px] font-black uppercase shrink-0">
                      {item.evidence_type.replaceAll('_', ' ')}
                    </Badge>
                  </div>
                  {item.summary && (
                    <p className="mt-2 text-[10px] text-slate-400">{item.summary}</p>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
              <div className="flex items-start gap-3">
                <IconPackageSearch className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                    {t('אין ראיות פתוחות', 'No open evidence yet')}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {t(
                      'לא נמצאו כרגע מקורות פתוחים נוספים עבור הצומת הזה.',
                      'No additional open-source evidence was found for this node yet.'
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="bg-black/10 border-white/5 rounded-3xl p-4">
        <div className="flex items-start gap-3">
          <IconAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">
              {t('הערות כיסוי', 'Coverage notes')}
            </p>
            {(data.limitations || []).map((itemText, index) => (
              <p key={`${itemText}-${index}`} className="text-[10px] text-slate-400 leading-relaxed">
                {itemText}
              </p>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
