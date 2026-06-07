import type { WorkspaceEntity } from '../api/brokerWorkspaceApi';

export type WorkspaceEntityRoleGroup = 'supplier' | 'buyer' | 'facility';

export function normalizedWorkspaceEntityType(entity: Pick<WorkspaceEntity, 'entity_type'>): string {
  return String(entity.entity_type || '').trim().toLowerCase();
}

export function workspaceEntityRoleGroup(entity: Pick<WorkspaceEntity, 'entity_type'>): WorkspaceEntityRoleGroup {
  const type = normalizedWorkspaceEntityType(entity);
  if (type.includes('buyer')) return 'buyer';
  if (type.includes('supplier')) return 'supplier';
  return 'facility';
}

export function isSupplierEntity(entity: Pick<WorkspaceEntity, 'entity_type'>): boolean {
  return workspaceEntityRoleGroup(entity) === 'supplier';
}

export function isBuyerEntity(entity: Pick<WorkspaceEntity, 'entity_type'>): boolean {
  return workspaceEntityRoleGroup(entity) === 'buyer';
}

export function isFacilityEntity(entity: Pick<WorkspaceEntity, 'entity_type'>): boolean {
  return workspaceEntityRoleGroup(entity) === 'facility';
}

export function selectedDealPackCounts(
  entities: WorkspaceEntity[],
  selectedIds: readonly string[],
): { suppliers: number; buyers: number; facilities: number; total: number } {
  const selected = new Set(selectedIds);
  return entities.reduce(
    (acc, entity) => {
      if (entity.packed_into_pack_id || !selected.has(entity.id)) return acc;
      acc.total += 1;
      const role = workspaceEntityRoleGroup(entity);
      if (role === 'supplier') acc.suppliers += 1;
      else if (role === 'buyer') acc.buyers += 1;
      else acc.facilities += 1;
      return acc;
    },
    { suppliers: 0, buyers: 0, facilities: 0, total: 0 },
  );
}

export function dealPackHasRequiredParties(
  entities: WorkspaceEntity[],
  selectedIds: readonly string[],
): boolean {
  const counts = selectedDealPackCounts(entities, selectedIds);
  return counts.suppliers > 0 && counts.buyers > 0;
}

export function resolveSelectedRouteEndpointIds(
  entities: WorkspaceEntity[],
  selectedIds: readonly string[],
): [string, string] | null {
  const selected = new Set(selectedIds);
  const selectedEntities = entities.filter(
    (entity) => !entity.packed_into_pack_id && selected.has(entity.id),
  );

  if (selectedEntities.length === 2) {
    return [selectedEntities[0].id, selectedEntities[1].id];
  }

  const supplier = selectedEntities.find(isSupplierEntity);
  const buyer = selectedEntities.find(isBuyerEntity);
  if (supplier && buyer) return [supplier.id, buyer.id];

  return null;
}

export function workspaceEntityRoleLabel(entity: Pick<WorkspaceEntity, 'entity_type'>): string {
  const type = normalizedWorkspaceEntityType(entity);
  if (type === 'route_stop') return 'Route stop';
  if (type === 'custom_pin') return 'Pin';
  if (type === 'facility') return 'Facility';
  if (type === 'supplier') return 'Supplier';
  if (type === 'buyer') return 'Buyer';
  return type ? type.replace(/_/g, ' ') : 'Entity';
}
