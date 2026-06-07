import { describe, expect, it } from 'vitest';
import {
  INFRASTRUCTURE_MIN_DETAIL_ZOOM,
  PIPELINE_LEAFLET_MIN_ZOOM,
  PIPELINE_MVT_MIN_ZOOM,
  PORT_MARKERS_MIN_ZOOM,
  infrastructureLayerShouldRender,
  infrastructureLayersPanelHint,
  pipelineLeafletShouldFetch,
  portMarkersShouldRender,
} from './infrastructureLayer';

const off = { pipelines: false, refineries: false, storage_terminals: false };

describe('infrastructureLayer', () => {
  it('does not render when toggle is off', () => {
    expect(
      infrastructureLayerShouldRender('pipelines', 12, { ...off, pipelines: false }, {}),
    ).toBe(false);
  });

  it('renders at zoom >= 9 when toggle is on', () => {
    expect(
      infrastructureLayerShouldRender(
        'pipelines',
        INFRASTRUCTURE_MIN_DETAIL_ZOOM,
        { ...off, pipelines: true },
        {},
      ),
    ).toBe(true);
  });

  it('renders pipelines from MVT min zoom without forced flag', () => {
    expect(
      infrastructureLayerShouldRender('pipelines', PIPELINE_MVT_MIN_ZOOM, { ...off, pipelines: true }, {}),
    ).toBe(true);
    expect(
      infrastructureLayerShouldRender('pipelines', PIPELINE_MVT_MIN_ZOOM - 1, { ...off, pipelines: true }, {}),
    ).toBe(false);
  });

  it('renders below detail zoom when user forced the layer on', () => {
    expect(
      infrastructureLayerShouldRender('refineries', 5, { ...off, refineries: true }, { refineries: true }),
    ).toBe(true);
  });

  it('hints to zoom when point layers are on but zoom is too low', () => {
    expect(
      infrastructureLayersPanelHint(5, { ...off, refineries: true }, {}),
    ).toBe('zoom');
  });

  it('does not fetch leaflet pipelines at world zoom', () => {
    expect(pipelineLeafletShouldFetch(3, true)).toBe(false);
    expect(pipelineLeafletShouldFetch(PIPELINE_LEAFLET_MIN_ZOOM, true)).toBe(true);
  });

  it('suppresses port markers until regional zoom', () => {
    expect(portMarkersShouldRender(4, true)).toBe(false);
    expect(portMarkersShouldRender(PORT_MARKERS_MIN_ZOOM, true)).toBe(true);
  });

  it('returns null hint when a layer is renderable', () => {
    expect(
      infrastructureLayersPanelHint(10, { ...off, pipelines: true }, {}),
    ).toBe(null);
  });
});
