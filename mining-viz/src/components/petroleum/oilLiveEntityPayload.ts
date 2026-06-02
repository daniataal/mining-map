import type { OilLiveDrawerTab, OilLiveEntityKind } from '../../features/live-data/OilLiveEntityDrawer';

export type OilLiveEntityClickPayload = {
  entityKind: OilLiveEntityKind;
  entityId: string;
  opportunityId?: string;
  title?: string;
  subtitle?: string;
  /** Opens entity drawer on Trading workflow tab (MAD-46 §8). */
  initialDrawerTab?: OilLiveDrawerTab;
};
