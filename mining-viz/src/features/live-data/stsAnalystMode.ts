function envFlag(name: string): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)[name];
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Dev/analyst: enable STS event verification controls in vessel drawer. */
export function isStsAnalystMode(): boolean {
  return envFlag('VITE_STS_ANALYST_MODE');
}
