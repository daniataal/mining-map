/** Delay before programmatically opening a license popup after selection. */
export function licensePopupOpenDelayMs(
  mapFlyTrigger: number,
  previousMapFlyTrigger: number,
): number {
  return mapFlyTrigger !== previousMapFlyTrigger ? 60 : 0;
}
