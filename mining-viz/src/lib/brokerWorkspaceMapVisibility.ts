import type { WorkspaceEntity } from '../api/brokerWorkspaceApi';
import { INTELLIGENCE_COLORS } from './intelligenceColors';

/** License ids represented as loose or packed workspace entities — hide from global license layer. */
export function workspaceHiddenLicenseIds(
  entities: WorkspaceEntity[],
  packedEntityIds: Set<string>,
): Set<string> {
  const hidden = new Set<string>();
  for (const e of entities) {
    if (e.ref_kind !== 'license' || !e.ref_id) continue;
    if (e.packed_into_pack_id || packedEntityIds.has(e.id)) {
      hidden.add(e.ref_id);
    }
  }
  return hidden;
}

export function entityMarkerColor(signal: string, inDd: boolean, stage: string): string {
  if (signal === 'good') return inDd ? '#16a34a' : INTELLIGENCE_COLORS.supplierGood;
  if (signal === 'bad') return INTELLIGENCE_COLORS.risk;
  if (stage === 'Investigating' || stage === 'Escalated') return INTELLIGENCE_COLORS.oilGas;
  return INTELLIGENCE_COLORS.clusterBase;
}
