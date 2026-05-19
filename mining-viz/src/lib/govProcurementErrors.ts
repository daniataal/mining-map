import { isAxiosError } from 'axios';

/** User-facing message when entity gov-procurement fetch fails. */
export function describeGovProcurementLoadError(err: unknown): string {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 503) {
      return 'Procurement service is still starting — try again shortly.';
    }
    if (status === 404) {
      return 'License not found for procurement lookup.';
    }
    const data = err.response?.data;
    if (typeof data === 'string' && data.trim()) {
      return data.trim();
    }
    if (data && typeof data === 'object') {
      const record = data as { warnings?: unknown; message?: unknown };
      if (Array.isArray(record.warnings) && typeof record.warnings[0] === 'string') {
        return record.warnings[0];
      }
      if (typeof record.message === 'string' && record.message.trim()) {
        return record.message.trim();
      }
    }
  }
  return 'Unable to load U.S. federal procurement data right now.';
}
