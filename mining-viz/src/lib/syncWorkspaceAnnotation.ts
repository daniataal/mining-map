import { getWorkspaceMap, updateWorkspaceEntity } from '../api/brokerWorkspaceApi';
import type { UserAnnotation } from '../types';
import { BROKER_WORKSPACE_ENABLED } from './brokerWorkspaceFlag';

/** Mirror dossier deal signal / stage onto workspace entity when license is in active workspace. */
export async function syncWorkspaceAnnotation(
  licenseId: string,
  updates: Partial<UserAnnotation>,
): Promise<void> {
  if (!BROKER_WORKSPACE_ENABLED) return;
  const wsId = localStorage.getItem('broker_active_workspace_id');
  if (!wsId || (!updates.status && !updates.stage)) return;
  try {
    const map = await getWorkspaceMap(wsId);
    const entity = map.entities.find((e) => e.ref_kind === 'license' && e.ref_id === licenseId);
    if (!entity) return;
    await updateWorkspaceEntity(wsId, entity.id, {
      deal_signal: updates.status as 'good' | 'maybe' | 'bad' | undefined,
      dd_stage: updates.stage,
    });
  } catch {
    // Non-blocking — workspace API may be unavailable offline
  }
}
