/** Feature flag — set VITE_BROKER_WORKSPACE_ENABLED=false to restore legacy Suppliers tab behavior. */
export const BROKER_WORKSPACE_ENABLED =
  (import.meta.env.VITE_BROKER_WORKSPACE_ENABLED as string | undefined) !== 'false';
