/** Cookie-session auth: always send cookies; never persist JWT in browser storage. */
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
