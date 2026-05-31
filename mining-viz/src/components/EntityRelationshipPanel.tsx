import { useMemo } from 'react';
import type { EntityRelationship } from '../types';
import { Badge } from './ui/badge';

interface EntityRelationshipPanelProps {
  relationships: EntityRelationship[];
  emptyTitle?: string;
  emptyMessage?: string;
}

const ROLE_META: Record<string, { label: string; badgeClass: string }> = {
  beneficial_owner: {
    label: 'Beneficial Owner',
    badgeClass: 'bg-fuchsia-500/10 text-fuchsia-400',
  },
  parent_company: {
    label: 'Parent Company',
    badgeClass: 'bg-violet-500/10 text-violet-400',
  },
  subsidiary: {
    label: 'Subsidiary',
    badgeClass: 'bg-violet-500/10 text-violet-300',
  },
  owner: {
    label: 'Owner',
    badgeClass: 'bg-cyan-500/10 text-cyan-400',
  },
  license_holder: {
    label: 'License Holder',
    badgeClass: 'bg-amber-500/10 text-amber-400',
  },
  operator: {
    label: 'Operator',
    badgeClass: 'bg-emerald-500/10 text-emerald-400',
  },
  manager: {
    label: 'Manager',
    badgeClass: 'bg-blue-500/10 text-blue-400',
  },
  charterer: {
    label: 'Charterer',
    badgeClass: 'bg-indigo-500/10 text-indigo-400',
  },
  trader: {
    label: 'Trader',
    badgeClass: 'bg-orange-500/10 text-orange-400',
  },
  counterparty: {
    label: 'Counterparty',
    badgeClass: 'bg-rose-500/10 text-rose-400',
  },
};

const ROLE_ORDER = [
  'beneficial_owner',
  'parent_company',
  'subsidiary',
  'owner',
  'license_holder',
  'operator',
  'manager',
  'charterer',
  'trader',
  'counterparty',
];

function formatConfidence(value?: number | null): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `${Math.round(value * 100)}% confidence`;
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export default function EntityRelationshipPanel({
  relationships,
  emptyTitle = 'No distinct role split found',
  emptyMessage = 'This source currently exposes a named company record, but not a clean owner/operator/holder breakdown we can verify yet.',
}: EntityRelationshipPanelProps) {
  const groupedRelationships = useMemo(() => {
    const groups = new Map<string, EntityRelationship[]>();
    for (const relationship of relationships) {
      const role = relationship.relationshipType || 'unknown';
      const existing = groups.get(role) || [];
      existing.push(relationship);
      groups.set(role, existing);
    }

    return Array.from(groups.entries())
      .sort((a, b) => {
        const aIndex = ROLE_ORDER.indexOf(a[0]);
        const bIndex = ROLE_ORDER.indexOf(b[0]);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      })
      .map(([role, items]) => ({
        role,
        meta: ROLE_META[role] || {
          label: role.replaceAll('_', ' '),
          badgeClass: 'bg-slate-500/10 text-slate-300',
        },
        items: [...items].sort((a, b) =>
          (a.targetName ?? '').localeCompare(b.targetName ?? '', undefined, { sensitivity: 'base' }),
        ),
      }));
  }, [relationships]);

  if (!groupedRelationships.length) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">{emptyTitle}</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groupedRelationships.map((group) => (
        <div
          key={group.role}
          className="rounded-2xl border border-black/5 dark:border-white/5 bg-white/60 dark:bg-slate-950/40 p-4"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <Badge className={`${group.meta.badgeClass} border-none text-[9px] font-black uppercase tracking-widest`}>
              {group.meta.label}
            </Badge>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              {group.items.length} {group.items.length === 1 ? 'signal' : 'signals'}
            </span>
          </div>

          <div className="space-y-3">
            {group.items.map((relationship) => {
              const confidenceLabel = formatConfidence(relationship.confidenceScore);
              const seenAt = formatDate(
                relationship.verifiedAt || relationship.lastSeenAt || relationship.effectiveDate
              );

              return (
                <div
                  key={relationship.id}
                  className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 dark:text-white break-words">
                        {relationship.targetName || relationship.targetEntityRef || 'Unknown entity'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {relationship.ownershipPct != null && (
                          <Badge className="bg-amber-500/10 text-amber-500 border-none text-[9px] font-black uppercase">
                            {relationship.ownershipPct}% stated
                          </Badge>
                        )}
                        {confidenceLabel && (
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[9px] font-black uppercase">
                            {confidenceLabel}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {relationship.sourceUrl && (
                      <a
                        href={relationship.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-black uppercase tracking-widest text-cyan-500 hover:text-cyan-400 shrink-0"
                      >
                        View source
                      </a>
                    )}
                  </div>

                  <div className="mt-3 space-y-1">
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {relationship.sourceName || 'Source-backed record'}
                      {seenAt ? ` · ${seenAt}` : ''}
                    </p>
                    {relationship.extractedFrom && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 break-all">
                        Source field: {relationship.extractedFrom}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
