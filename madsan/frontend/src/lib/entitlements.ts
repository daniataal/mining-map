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
  return !!effectiveEntitlements(me)?.[feature];
}

/** Local dev: unlock pipelines MVT when API is localhost (matches backend dev JWT default). */
export function devGrantMapPremiumLayers(): boolean {
  const explicit = process.env.NEXT_PUBLIC_MADSAN_GRANT_MAP_PREMIUM_LAYERS;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8088").toLowerCase();
  return base.includes("localhost") || base.includes("127.0.0.1");
}

export function effectiveEntitlements(
  me: MeResponse | null | undefined,
): Partial<Record<FeatureKey, boolean>> | undefined {
  const ents: Partial<Record<FeatureKey, boolean>> = { ...me?.entitlements };
  if (devGrantMapPremiumLayers()) {
    ents[FEATURE.mapPremiumLayers] = true;
  }
  return Object.keys(ents).length > 0 ? ents : undefined;
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
