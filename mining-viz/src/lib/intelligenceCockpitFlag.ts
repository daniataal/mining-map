/** Set VITE_INTELLIGENCE_COCKPIT_ENABLED=false to restore legacy 6-tab navigation. */
export const INTELLIGENCE_COCKPIT_ENABLED =
  (import.meta.env.VITE_INTELLIGENCE_COCKPIT_ENABLED as string | undefined) !== 'false';
