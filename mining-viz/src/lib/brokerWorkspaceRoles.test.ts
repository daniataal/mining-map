import { describe, expect, it } from 'vitest';
import type { WorkspaceEntity } from '../api/brokerWorkspaceApi';
import {
  dealPackHasRequiredParties,
  resolveSelectedRouteEndpointIds,
  selectedDealPackCounts,
  workspaceEntityRoleGroup,
} from './brokerWorkspaceRoles';

function entity(id: string, entity_type: string): WorkspaceEntity {
  return {
    id,
    workspace_id: 'ws-1',
    entity_type,
    ref_kind: 'custom',
    display_name: id,
    lat: 1,
    lng: 1,
    deal_signal: 'maybe',
    dd_stage: 'New',
    in_dd_queue: false,
    created_at: '',
    updated_at: '',
  };
}

describe('brokerWorkspaceRoles', () => {
  it('groups optional route and facility entities separately from supplier and buyer', () => {
    expect(workspaceEntityRoleGroup(entity('s', 'supplier'))).toBe('supplier');
    expect(workspaceEntityRoleGroup(entity('b', 'buyer'))).toBe('buyer');
    expect(workspaceEntityRoleGroup(entity('p', 'route_stop'))).toBe('facility');
    expect(workspaceEntityRoleGroup(entity('f', 'facility'))).toBe('facility');
  });

  it('requires a supplier and buyer before a deal can be packed', () => {
    const entities = [
      entity('supplier-1', 'supplier'),
      entity('port-1', 'route_stop'),
      entity('buyer-1', 'buyer'),
    ];

    expect(dealPackHasRequiredParties(entities, ['supplier-1', 'port-1'])).toBe(false);
    expect(dealPackHasRequiredParties(entities, ['supplier-1', 'buyer-1'])).toBe(true);
    expect(selectedDealPackCounts(entities, ['supplier-1', 'buyer-1', 'port-1'])).toEqual({
      suppliers: 1,
      buyers: 1,
      facilities: 1,
      total: 3,
    });
  });

  it('draws routes between exactly two selected workspace points', () => {
    const entities = [
      entity('supplier-1', 'supplier'),
      entity('port-1', 'route_stop'),
      entity('buyer-1', 'buyer'),
    ];

    expect(resolveSelectedRouteEndpointIds(entities, ['supplier-1', 'port-1'])).toEqual([
      'supplier-1',
      'port-1',
    ]);
  });

  it('uses the supplier and buyer as route endpoints when optional entities are also selected', () => {
    const entities = [
      entity('supplier-1', 'supplier'),
      entity('port-1', 'route_stop'),
      entity('buyer-1', 'buyer'),
      entity('storage-1', 'facility'),
    ];

    expect(
      resolveSelectedRouteEndpointIds(entities, [
        'supplier-1',
        'port-1',
        'buyer-1',
        'storage-1',
      ]),
    ).toEqual(['supplier-1', 'buyer-1']);
  });

  it('does not route from a supplier without a destination when more than two entities are selected', () => {
    const entities = [
      entity('supplier-1', 'supplier'),
      entity('port-1', 'route_stop'),
      entity('storage-1', 'facility'),
    ];

    expect(resolveSelectedRouteEndpointIds(entities, ['supplier-1', 'port-1', 'storage-1'])).toBeNull();
  });
});
