import { useEffect, useRef } from 'react';
import { seedDefaultWorkspace } from '../api/brokerWorkspaceApi';
import { isSupplierDealSignal } from '../lib/suppliersPipeline';
import { loadDdQueue } from '../lib/dueDiligenceQueue';
import type { MiningLicense, UserAnnotation } from '../types';

const SEED_KEY = 'broker_workspace_seeded_v1';

export function useWorkspaceSeed(
  enabled: boolean,
  licenses: MiningLicense[],
  userAnnotations: Record<string, UserAnnotation>,
  onSeeded?: (workspaceId: string) => void,
) {
  const seededRef = useRef(false);

  useEffect(() => {
    if (!enabled || seededRef.current) return;
    if (localStorage.getItem(SEED_KEY) === '1') {
      seededRef.current = true;
      return;
    }
    seededRef.current = true;
    const ddIds = new Set(loadDdQueue().map((e) => e.id));
    const entities = licenses
      .filter((lic) => isSupplierDealSignal(userAnnotations[lic.id]))
      .map((lic) => ({
        ref_kind: 'license',
        ref_id: lic.id,
        display_name: lic.company || lic.id,
        lat: lic.lat ?? 0,
        lng: lic.lng ?? 0,
        deal_signal: 'good',
        dd_stage: userAnnotations[lic.id]?.stage ?? 'New',
        in_dd_queue: ddIds.has(lic.id),
      }));
    void seedDefaultWorkspace({ entities }).then((res) => {
      localStorage.setItem(SEED_KEY, '1');
      onSeeded?.(res.workspace_id);
    });
  }, [enabled, licenses, userAnnotations, onSeeded]);

  return { seeding: false };
}
