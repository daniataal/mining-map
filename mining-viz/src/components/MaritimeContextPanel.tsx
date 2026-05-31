import { useMemo } from 'react';
import {
  MaritimeContextQuery,
  useMaritimeContext,
} from '../lib/api';
import { normalizeMaritimeContextResponse } from '../lib/maritimeContextNormalize';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { useI18n } from '../lib/i18n';
import EntityRelationshipPanel from './EntityRelationshipPanel';
import {
  AlertTriangle as IconAlert,
  Anchor as IconAnchor,
  Building2 as IconBuilding,
  ExternalLink as IconExternalLink,
  FileSearch as IconFileSearch,
  Ship as IconShip,
} from 'lucide-react';

interface MaritimeContextPanelProps {
  query: MaritimeContextQuery;
  section?: 'all' | 'owners' | 'counterparties' | 'evidence';
  enabled?: boolean;
}

function fmtDistance(distanceKm?: number | null): string {
  if (distanceKm == null) return 'Distance n/a';
  if (distanceKm >= 1000) return `${(distanceKm / 1000).toFixed(1)}k km`;
  return `${distanceKm.toFixed(0)} km`;
}

function fmtConfidence(confidence?: number | null): string {
  if (confidence == null) return 'Unscored';
  return `${Math.round(confidence * 100)}% confidence`;
}

function fmtSeenAt(value?: string | null): string {
  if (!value) return 'Timestamp unavailable';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function MaritimeContextPanel({
  query,
  section = 'all',
  enabled = true,
}: MaritimeContextPanelProps) {
  const { t } = useI18n();
  const { data, isLoading, error } = useMaritimeContext(query, enabled);

  const visibleSections = useMemo(() => {
    if (section === 'all') return new Set(['owners', 'counterparties', 'evidence']);
    return new Set([section]);
  }, [section]);

  if (!enabled) return null;

  if (isLoading) {
    return (
      <Card className="bg-white/5 border-white/5 rounded-3xl p-5">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
              {t('טוען הקשר ימי', 'Loading maritime context')}
            </p>
            <p className="text-[10px] text-slate-500">
              {t('UN/LOCODE · GDELT · Wikidata · OpenCorporates', 'UN/LOCODE · GDELT · Wikidata · OpenCorporates')}
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
              {t('שגיאת מודיעין ימי', 'Maritime context failed')}
            </p>
            <p className="text-[10px] text-slate-400">{String((error as Error)?.message || error)}</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const ctx = normalizeMaritimeContextResponse(data);
  const showOwners = visibleSections.has('owners');
  const showCounterparties = visibleSections.has('counterparties');
  const showEvidence = visibleSections.has('evidence');
  const normalizedRelationships = ctx.relationships;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {ctx.source_labels.map((label) => (
          <Badge key={label} className="bg-cyan-500/10 text-cyan-400 border-none text-[8px] font-black uppercase">
            {label}
          </Badge>
        ))}
        <span className="text-[9px] text-slate-500 uppercase tracking-widest ml-auto">
          {t('עודכן', 'Updated')} {fmtSeenAt(ctx.data_as_of)}
        </span>
      </div>

      {showOwners && (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <IconBuilding className="w-4 h-4 text-cyan-400" />
            <div>
              <h4 className="text-[11px] font-black uppercase tracking-widest text-cyan-400">
                {t('בעלות ורישום', 'Ownership & Registry')}
              </h4>
              <p className="text-[9px] text-slate-500 mt-0.5">
                {t(
                  'הצלבה אוטומטית: MMSI/IMO → Wikidata → קישורי חברה',
                  'Auto cross-check: MMSI/IMO → Wikidata → company profile links',
                )}
              </p>
            </div>
          </div>

          {ctx.identity && (ctx.identity.owner || ctx.identity.operator) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {ctx.identity.operator && (
                <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-4 md:col-span-2">
                  <p className="text-[8px] font-black uppercase tracking-widest text-cyan-400 mb-1">
                    {t('מפעיל (מאומת פתוח)', 'Operator (open match)')}
                  </p>
                  <p className="text-sm font-bold text-slate-100">{ctx.identity.operator}</p>
                </div>
              )}
              {ctx.identity.owner && (
                <div className="rounded-2xl border border-white/5 bg-black/10 p-4 md:col-span-2">
                  <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    {t('בעלים', 'Owner')}
                  </p>
                  <p className="text-sm font-bold text-slate-100">{ctx.identity.owner}</p>
                </div>
              )}
            </div>
          )}

          {normalizedRelationships.length > 0 ? (
            <div className="mb-4">
              <EntityRelationshipPanel
                relationships={normalizedRelationships}
                emptyTitle="No maritime role split found"
                emptyMessage="No source-backed owner/operator split was found in the open maritime sources for this query."
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 mb-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">
                {t('אין התאמת בעלות פתוחה', 'No open ownership match')}
              </p>
              <p className="text-[10px] text-slate-400">
                {t(
                  'אין כרגע התאמת MMSI/IMO פתוחה במקורות החינמיים. מוצגים קישורי רישום להמשך בדיקה ידנית.',
                  'No MMSI/IMO ownership match was found in the open sources we can use here. Registry links below are provided for manual follow-up.'
                )}
              </p>
            </div>
          )}

          {ctx.identity && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Flag</p>
                <p className="text-sm font-bold text-slate-100">{ctx.identity.flag || 'Unknown'}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Registry Port</p>
                <p className="text-sm font-bold text-slate-100">{ctx.identity.registry_port || 'Unknown'}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-black/10 p-4 md:col-span-2">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Match Quality</p>
                <p className="text-sm font-bold text-slate-100">
                  {ctx.identity.matched_by || 'Open match'} · {fmtConfidence(ctx.identity.confidence)}
                </p>
              </div>
            </div>
          )}

          {ctx.company_links.length > 0 ? (
            <div className="space-y-2">
              {ctx.company_links.map((link) => (
                <a
                  key={`${link.label}-${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/10 px-4 py-3 hover:bg-black/20 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-100 truncate">{link.label}</p>
                    <p className="text-[9px] text-slate-500 truncate">{link.description || link.source_label}</p>
                  </div>
                  <IconExternalLink className="w-4 h-4 text-slate-500 shrink-0 ml-3" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-slate-500">{t('אין קישורי חברה פתוחים זמינים.', 'No open company links available.')}</p>
          )}
        </Card>
      )}

      {showCounterparties && (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <IconAnchor className="w-4 h-4 text-emerald-400" />
            <h4 className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
              {t('נמלים וצדדים נגדיים', 'Ports & Counterparty Proxies')}
            </h4>
          </div>

          <div className="space-y-3">
            {ctx.nearest_ports.length === 0 && ctx.counterparty_proxies.length === 0 ? (
              <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                  {t('אין נמלים או צדדים נגדיים', 'No ports or counterparty proxies')}
                </p>
                <p className="text-[10px] text-slate-500">
                  {t(
                    'לא נמצאו נמלים קרובים או פרוקסי צדדים נגדיים בנתונים הפתוחים.',
                    'No nearby ports or counterparty proxies were found in open data for this vessel.',
                  )}
                </p>
              </div>
            ) : null}
            {ctx.nearest_ports.map((port) => (
              <div key={`${port.unlocode || port.name}-${port.lat}-${port.lng}`} className="rounded-2xl border border-white/5 bg-black/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-100 truncate">
                      {port.name}
                    </p>
                    <p className="text-[9px] text-slate-500">
                      {[port.unlocode, port.country_iso2, port.subdivision].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-none text-[8px] font-black uppercase">
                    {fmtDistance(port.distance_km)}
                  </Badge>
                </div>
                <p className="mt-2 text-[10px] text-slate-400">
                  {port.role === 'energy_port'
                    ? t('נמל אנרגיה/טרמינל רלוונטי בנתונים הפתוחים.', 'Energy-relevant port/terminal detected in the open data.')
                    : t('עוגן לוגיסטי ימי כללי מהנתונים הפתוחים.', 'General maritime logistics anchor from open data.')}
                </p>
              </div>
            ))}

            {ctx.counterparty_proxies.map((proxy) => (
              <div key={proxy.id} className="rounded-2xl border border-white/5 bg-black/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-100">{proxy.label}</p>
                    <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">{proxy.description}</p>
                  </div>
                  <Badge className="bg-amber-500/10 text-amber-400 border-none text-[8px] font-black uppercase shrink-0">
                    {fmtConfidence(proxy.confidence)}
                  </Badge>
                </div>
                {proxy.url && (
                  <Button asChild variant="ghost" className="mt-3 h-8 px-3 text-[9px] font-black uppercase tracking-widest text-cyan-400 hover:text-cyan-300">
                    <a href={proxy.url} target="_blank" rel="noopener noreferrer">
                      <IconExternalLink className="w-3.5 h-3.5 mr-1.5" />
                      {t('פתח מקור', 'Open source')}
                    </a>
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">
              {t('מגבלת BOL', 'BOL limitation')}
            </p>
            <p className="text-[10px] text-slate-400 leading-relaxed">{ctx.bol_coverage_note}</p>
          </div>
        </Card>
      )}

      {showEvidence && (
        <Card className="bg-white/5 border-white/5 rounded-3xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <IconFileSearch className="w-4 h-4 text-indigo-400" />
            <h4 className="text-[11px] font-black uppercase tracking-widest text-indigo-400">
              {t('ראיות גולמיות', 'Raw Evidence')}
            </h4>
          </div>

          {ctx.evidence.length > 0 ? (
            <div className="space-y-3">
              {ctx.evidence.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-2xl border border-white/5 bg-black/10 p-4 hover:bg-black/20 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-100 leading-relaxed">
                        {item.title}
                      </p>
                      <p className="mt-1 text-[9px] text-slate-500">
                        {[item.source_label, item.source_domain, fmtSeenAt(item.seen_at)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Badge className="bg-indigo-500/10 text-indigo-400 border-none text-[8px] font-black uppercase shrink-0">
                      {item.evidence_type.replaceAll('_', ' ')}
                    </Badge>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">
                    {item.summary || t('קישור למקור גולמי לבדיקה ידנית.', 'Raw-source link for manual verification.')}
                  </p>
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
              <div className="flex items-start gap-3">
                <IconShip className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                    {t('אין ראיות חדשות', 'No recent maritime evidence')}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {t(
                      'לא נמצאו כרגע כתבות/אותות פתוחים התואמים לשאילתה.',
                      'No recent open-source articles matched this maritime query.'
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
              {t('היקף הכיסוי', 'Coverage notes')}
            </p>
            {ctx.limitations.map((item, index) => (
              <p key={`${item}-${index}`} className="text-[10px] text-slate-400 leading-relaxed">
                {item}
              </p>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
