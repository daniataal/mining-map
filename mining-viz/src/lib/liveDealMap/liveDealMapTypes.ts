export type LiveDealFeatureKind =
  | 'terminal'
  | 'vessel'
  | 'opportunity'
  | 'cargo'
  | 'trade_flow'
  | 'license'
  | 'server_cluster'
  | 'storage_terminal'
  | 'tank_farm'
  | 'refinery'
  | 'oil_field'
  | 'infrastructure';

export type LiveDealTier =
  | 'live'
  | 'live_ais'
  | 'macro'
  | 'synthetic'
  | 'inferred'
  | 'historic'
  | 'user_upload'
  | string;

export type LiveDealLatLng = [number, number];

export type LiveDealBaseFeature = {
  uid: string;
  id: string;
  kind: LiveDealFeatureKind;
  title: string;
  subtitle?: string;
  tier?: LiveDealTier;
  confidence?: number;
  sourceCount?: number;
  dealScore?: number;
  styleKey?: string;
  payload?: unknown;
  data?: unknown;
};

export type LiveDealPointFeature = LiveDealBaseFeature & {
  shape: 'point';
  lat: number;
  lng: number;
  heading?: number;
};

export type LiveDealArcFeature = LiveDealBaseFeature & {
  shape: 'arc';
  positions: LiveDealLatLng[];
  color?: string;
  weight?: number;
  opacity?: number;
  dashArray?: string;
  popupLat: number;
  popupLng: number;
};

export type LiveDealMapFeature = LiveDealPointFeature | LiveDealArcFeature;

export type LiveDealViewport = {
  south: number;
  west: number;
  north: number;
  east: number;
};
