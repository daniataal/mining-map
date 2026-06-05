import { describe, expect, it } from 'vitest';
import { entityMarkerColor, workspaceHiddenLicenseIds } from './brokerWorkspaceMapVisibility';
import type { WorkspaceEntity } from '../api/brokerWorkspaceApi';

const base = (overrides: Partial<WorkspaceEntity>): WorkspaceEntity => ({
  id: 'e1',
  workspace_id: 'ws1',
  entity_type: 'supplier',
  ref_kind: 'license',
  ref_id: 'lic-1',
  display_name: 'Test',
  lat: 0,
  lng: 0,
  deal_signal: 'good',
  dd_stage: 'New',
  in_dd_queue: false,
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('brokerWorkspaceMapVisibility', () => {
  it('hides packed license refs from global layer', () => {
    const entities = [
      base({ id: 'e1', ref_id: 'lic-1', packed_into_pack_id: 'pack-1' }),
      base({ id: 'e2', ref_id: 'lic-2' }),
    ];
    const hidden = workspaceHiddenLicenseIds(entities, new Set(['e1']));
    expect(hidden.has('lic-1')).toBe(true);
    expect(hidden.has('lic-2')).toBe(false);
  });

  it('colors DD suppliers distinctly', () => {
    expect(entityMarkerColor('good', true, 'New')).toBe('#16a34a');
    expect(entityMarkerColor('good', false, 'New')).toBe('#22c55e');
    expect(entityMarkerColor('bad', false, 'New')).toBe('#ef4444');
  });
});
