/** Keys cleared when a Bearer JWT is rejected (stale session). */
export const MINING_AUTH_STORAGE_KEYS = [
  'mining_token',
  'mining_role',
  'mining_username',
  'mining_userid',
  'token',
] as const;

export function clearMiningAuthStorage(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of MINING_AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}
