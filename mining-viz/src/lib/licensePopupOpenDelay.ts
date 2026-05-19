/** True when sidebar/list selection bumped mapFlyTrigger (flyTo will run). */
export function isSidebarFlySelection(
  mapFlyTrigger: number,
  previousMapFlyTrigger: number,
): boolean {
  return mapFlyTrigger !== previousMapFlyTrigger;
}

/** @deprecated Prefer isSidebarFlySelection + moveend; kept for tests. */
export function licensePopupOpenDelayMs(
  mapFlyTrigger: number,
  previousMapFlyTrigger: number,
): number {
  return isSidebarFlySelection(mapFlyTrigger, previousMapFlyTrigger) ? 60 : 0;
}
