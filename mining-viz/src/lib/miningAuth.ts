/** Keys cleared when a Bearer JWT is rejected (stale session). */
export const MINING_AUTH_STORAGE_KEYS = [
  'mining_token',
  'mining_role',
  'mining_username',
  'mining_userid',
  'token',
] as const;

/** Skip further GET /api/licenses/annotations after a 401 until logout or fresh login. */
let annotationsServerHydrationBlocked = false;

export type MiningUserRole = 'admin' | 'user';

export function getStoredMiningToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  const token =
    localStorage.getItem('mining_token')?.trim() || localStorage.getItem('token')?.trim();
  return token || null;
}

export function getStoredMiningRole(): MiningUserRole | null {
  if (typeof localStorage === 'undefined') return null;
  const role = localStorage.getItem('mining_role')?.trim();
  return role === 'admin' || role === 'user' ? role : null;
}

export function isMiningAdmin(role: MiningUserRole | null | undefined): boolean {
  return role === 'admin';
}

/** Client-side exp check only — invalid signature still requires server 401 handling. */
export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as { exp?: unknown };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return true;
  }
}

export function clearMiningAuthStorage(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of MINING_AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

export function resetAnnotationsHydrationSession(): void {
  annotationsServerHydrationBlocked = false;
}

export function blockAnnotationsServerHydration(): void {
  annotationsServerHydrationBlocked = true;
}

export function isAnnotationsServerHydrationBlocked(): boolean {
  return annotationsServerHydrationBlocked;
}
