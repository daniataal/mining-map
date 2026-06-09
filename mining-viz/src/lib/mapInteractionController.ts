/**
 * Unified map click/dismiss contract shared by infrastructure, canvas, and legacy layers.
 */
export { markMapFeatureClickHandled } from './infrastructureMapInteraction';

type MapFeatureClickEvent = MouseEvent & {
  __liveDealCanvasHandled?: boolean;
  __mapFeatureClickHandled?: boolean;
};

export function mapFeatureClickWasHandled(event: { originalEvent?: Event }): boolean {
  const oe = event.originalEvent as MapFeatureClickEvent | undefined;
  return Boolean(oe?.__liveDealCanvasHandled || oe?.__mapFeatureClickHandled);
}

/** True when petroleum GeoJSON/MVT popups are owned by InfrastructureMapInteraction. */
export function petroleumUnifiedInteractionActive(
  infrastructureInteractionOn: boolean,
): boolean {
  return infrastructureInteractionOn;
}
