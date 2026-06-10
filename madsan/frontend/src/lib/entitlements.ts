import { authFetchOpts } from "@/lib/auth";
import { API_BASE } from "@/lib/layers";

export const FEATURE = {
  dealVerification: "deal_verification",
  dealPackExport: "deal_pack_export",
  dealWatch: "deal_watch",
  mapPremiumLayers: "map_premium_layers",
  supplierDiscovery: "supplier_discovery",
  supplierPortal: "supplier_portal",
  apiAccess: "api_access",
} as const;

export type FeatureKey = (typeof FEATURE)[keyof typeof FEATURE];

export type MeResponse = {
  uid?: string;
  tid?: string;
  role?: string;
  plan?: string;
  entitlements?: Partial<Record<FeatureKey, boolean>>;
};

export function canUse(me: MeResponse | null | undefined, feature: FeatureKey): boolean {
  return !!me?.entitlements?.[feature];
}

export async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/core/auth/me`, authFetchOpts);
    if (!res.ok) return null;
    return (await res.json()) as MeResponse;
  } catch {
    return null;
  }
}
