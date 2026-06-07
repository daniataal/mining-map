import {
  LucideAnchor,
  LucideBuilding2,
  LucideFactory,
  LucideShip,
  LucideTrash2,
  LucideUserCheck,
  LucideUsers,
} from 'lucide-react';
import { STAGE_BADGE_COLORS, normalizeDealStage } from '../../lib/dealWorkflow';
import type { WorkspaceEntity } from '../../api/brokerWorkspaceApi';
import {
  isBuyerEntity,
  isFacilityEntity,
  isSupplierEntity,
  normalizedWorkspaceEntityType,
  workspaceEntityRoleLabel,
} from '../../lib/brokerWorkspaceRoles';

type Props = {
  entities: WorkspaceEntity[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onRemove: (id: string) => void;
};

const signalDot: Record<string, string> = {
  good: 'bg-emerald-500',
  maybe: 'bg-amber-500',
  bad: 'bg-red-500',
};

function entityIcon(entity: WorkspaceEntity) {
  const type = normalizedWorkspaceEntityType(entity);
  const ref = String(entity.ref_kind || '').toLowerCase();
  if (type.includes('buyer')) return LucideUsers;
  if (type.includes('supplier')) return LucideUserCheck;
  if (type.includes('vessel') || ref.includes('vessel')) return LucideShip;
  if (type.includes('route') || type.includes('port') || type.includes('terminal')) return LucideAnchor;
  if (type.includes('facility') || type.includes('refinery')) return LucideFactory;
  return LucideBuilding2;
}

function EntityRow({
  entity,
  selected,
  onToggleSelect,
  onRemove,
}: {
  entity: WorkspaceEntity;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const stage = normalizeDealStage(entity.dd_stage);
  const Icon = entityIcon(entity);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onToggleSelect(entity.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggleSelect(entity.id);
        }
      }}
      className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/45 ${
        selected
          ? 'border-amber-500/50 bg-amber-500/10'
          : 'border-black/5 hover:border-amber-500/30 hover:bg-amber-500/5 dark:border-white/5'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(entity.id)}
        onClick={(event) => event.stopPropagation()}
        className="shrink-0"
        aria-label={`Select ${entity.display_name}`}
      />
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <div className={`h-2 w-2 shrink-0 rounded-full ${signalDot[entity.deal_signal] ?? 'bg-slate-400'}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{entity.display_name}</p>
        <p className="text-[10px] uppercase tracking-wider text-slate-400">
          {workspaceEntityRoleLabel(entity)}
          {entity.in_dd_queue && ' · DD'}
        </p>
        <span
          className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${STAGE_BADGE_COLORS[stage]}`}
        >
          {stage}
        </span>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(entity.id);
        }}
        className="p-1 text-slate-400 hover:text-red-500"
        aria-label={`Remove ${entity.display_name}`}
      >
        <LucideTrash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function EntityGroup({
  title,
  entities,
  empty,
  selectedIds,
  onToggleSelect,
  onRemove,
}: {
  title: string;
  entities: WorkspaceEntity[];
  empty: string;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
        <span className="rounded-full bg-slate-950/5 px-2 py-0.5 text-[9px] font-black text-slate-500 dark:bg-white/10">
          {entities.length}
        </span>
      </div>
      {entities.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/10 px-3 py-3 text-xs text-slate-500 dark:border-white/10">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {entities.map((entity) => (
            <EntityRow
              key={entity.id}
              entity={entity}
              selected={selectedIds.includes(entity.id)}
              onToggleSelect={onToggleSelect}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkspaceEntityList({ entities, selectedIds, onToggleSelect, onRemove }: Props) {
  const loose = entities.filter((entity) => !entity.packed_into_pack_id);
  if (loose.length === 0) {
    return (
      <p className="rounded-xl border border-dashed py-4 text-center text-sm text-slate-500">
        No entities on map. Search existing licenses, add a buyer, or add a custom license.
      </p>
    );
  }

  const suppliers = loose.filter(isSupplierEntity);
  const buyers = loose.filter(isBuyerEntity);
  const facilities = loose.filter(isFacilityEntity);

  return (
    <div className="space-y-4">
      <EntityGroup
        title="Suppliers / origins"
        entities={suppliers}
        empty="Add a supplier or origin license."
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onRemove={onRemove}
      />
      <EntityGroup
        title="Buyers / destinations"
        entities={buyers}
        empty="Add a buyer or destination."
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onRemove={onRemove}
      />
      <EntityGroup
        title="Facilities, ports, vessels, route stops"
        entities={facilities}
        empty="Optional: add ports, terminals, vessels, refineries, storage or route stops."
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onRemove={onRemove}
      />
    </div>
  );
}
