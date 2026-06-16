/** Cookie-session auth: always send cookies; never persist JWT in browser storage. */
import { apiBase, isLocalDevApi } from "@/lib/layers";

export { isLocalDevApi };
import type { MeResponse } from "@/lib/entitlements";

export const authFetchOpts: RequestInit = { credentials: "include" };

const LEGACY_TOKEN_KEYS = [
  "madsan_access_token",
  "madsan_token",
  "madsan_access",
  "madsan_refresh",
  "access_token",
  "refresh_token",
  "jwt_token",
];

/** Remove header/localStorage JWT leftovers from pre-cookie auth. */
export function clearLegacyAuthTokens(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_TOKEN_KEYS) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // ignore private-mode / blocked storage
    }
  }
}

/** Turn raw API error bodies into short user-facing messages. */
export function parseAuthError(raw: string): string {
  const text = raw.trim();
  if (!text) return "Authentication failed";
  if (text === "invalid credentials") return "Invalid email or password";
  if (text === "email already registered") return "This email is already registered — sign in instead";
  if (text === "unauthorized") return "Session expired — sign in again";
  if (text === "bad request") return "Please check your input and try again";
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export async function fetchSession(): Promise<MeResponse | null> {
  try {
    const res = await fetch(`${apiBase()}/api/core/auth/me`, authFetchOpts);
    if (!res.ok) return null;
    return (await res.json()) as MeResponse;
  } catch {
    return null;
  }
}

export async function loginWithPassword(email: string, password: string): Promise<string | null> {
  const res = await fetch(`${apiBase()}/api/core/auth/login`, {
    ...authFetchOpts,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return parseAuthError(await res.text());
  return null;
}

export async function registerAccount(opts: {
  email: string;
  password: string;
  displayName: string;
  tenantSlug?: string;
}): Promise<string | null> {
  const res = await fetch(`${apiBase()}/api/core/auth/register`, {
    ...authFetchOpts,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: opts.email,
      password: opts.password,
      display_name: opts.displayName,
      tenant_slug: opts.tenantSlug || "default",
    }),
  });
  if (!res.ok) return parseAuthError(await res.text());
  return null;
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch(`${apiBase()}/api/core/auth/logout`, { ...authFetchOpts, method: "POST" });
  } catch {
    // cookie clear is best-effort when API is down
  }
}
