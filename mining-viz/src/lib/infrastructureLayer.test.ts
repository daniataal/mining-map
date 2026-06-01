import { describe, expect, it } from 'vitest';
import {
  INFRASTRUCTURE_MIN_DETAIL_ZOOM,
  infrastructureLayerShouldRender,
  infrastructureLayersPanelHint,
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

  it('renders below zoom 9 when user forced the layer on', () => {
    expect(
      infrastructureLayerShouldRender('pipelines', 5, { ...off, pipelines: true }, { pipelines: true }),
    ).toBe(true);
  });

  it('hints to zoom when toggles are on but zoom is too low', () => {
    expect(
      infrastructureLayersPanelHint(5, { ...off, pipelines: true }, {}),
    ).toBe('zoom');
  });

  it('returns null hint when a layer is renderable', () => {
    expect(
      infrastructureLayersPanelHint(10, { ...off, pipelines: true }, {}),
    ).toBe(null);
  });
});
