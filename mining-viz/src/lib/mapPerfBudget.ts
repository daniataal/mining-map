/** Client performance budget targets (dev instrumentation). */
export const MAP_PERF_BUDGET = {
  popupInteractiveMs: 300,
  maxConcurrentBboxFetches: 2,
} as const;

export function markMapPerf(label: string): void {
  if (import.meta.env.DEV && typeof performance !== 'undefined') {
    performance.mark(`map:${label}`);
  }
}

export function measureMapPerf(label: string, startMark: string): void {
  if (import.meta.env.DEV && typeof performance !== 'undefined') {
    try {
      performance.measure(`map:${label}`, startMark);
      const entry = performance.getEntriesByName(`map:${label}`).at(-1);
      if (entry && entry.duration > MAP_PERF_BUDGET.popupInteractiveMs) {
        console.warn(`[map perf] ${label} exceeded budget: ${entry.duration.toFixed(0)}ms`);
      }
    } catch {
      // ignore missing marks
    }
  }
}
