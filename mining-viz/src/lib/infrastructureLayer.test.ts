import { describe, expect, it } from 'vitest';
import {
  INFRASTRUCTURE_MIN_DETAIL_ZOOM,
  PIPELINE_LEAFLET_MIN_ZOOM,
  PIPELINE_MVT_MIN_ZOOM,
  PORT_MARKERS_MIN_ZOOM,
  REFINERY_MVT_MIN_ZOOM,
  STORAGE_INDIVIDUAL_MIN_ZOOM,
  STORAGE_OVERVIEW_MIN_ZOOM,
  infrastructureLayerShouldRender,
  infrastructureLayersPanelHint,
  osmInfrastructureLayerVisible,
  osmPipelinesLayerVisible,
  pipelineLeafletShouldFetch,
  portMarkersShouldRender,
  refineryMvtOverviewShouldRender,
  storageMvtOverviewShouldRender,
  storageOsmMvtShouldRender,
  STORAGE_MVT_HIDE_MIN_ZOOM,
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

  it('shows refineries earlier than dense storage points', () => {
    expect(
      infrastructureLayerShouldRender('refineries', REFINERY_MVT_MIN_ZOOM, { ...off, refineries: true }, {}),
    ).toBe(true);
    expect(
      infrastructureLayerShouldRender('storage_terminals', REFINERY_MVT_MIN_ZOOM, { ...off, storage_terminals: true }, {}),
    ).toBe(false);
    expect(
      infrastructureLayerShouldRender('storage_terminals', STORAGE_INDIVIDUAL_MIN_ZOOM, { ...off, storage_terminals: true }, {}),
    ).toBe(true);
  });

  it('does not force dense storage points at world zoom', () => {
    expect(
      infrastructureLayerShouldRender('storage_terminals', 5, { ...off, storage_terminals: true }, { storage_terminals: true }),
    ).toBe(false);
  });

  it('allows lightweight MVT storage overview at low zoom', () => {
    expect(storageMvtOverviewShouldRender(STORAGE_OVERVIEW_MIN_ZOOM, true)).toBe(true);
    expect(storageMvtOverviewShouldRender(STORAGE_OVERVIEW_MIN_ZOOM - 1, true)).toBe(false);
  });

  it('keeps OSM MVT storage when canvas has no entities in view', () => {
    expect(storageOsmMvtShouldRender(STORAGE_MVT_HIDE_MIN_ZOOM + 2, true, 0)).toBe(true);
  });

  it('hides OSM MVT storage at detail zoom when canvas covers the viewport', () => {
    expect(storageOsmMvtShouldRender(STORAGE_MVT_HIDE_MIN_ZOOM, true, 12)).toBe(false);
    expect(storageOsmMvtShouldRender(STORAGE_MVT_HIDE_MIN_ZOOM - 1, true, 12)).toBe(true);
  });

  it('allows lightweight MVT refinery overview at the same regional zoom as storage', () => {
    expect(refineryMvtOverviewShouldRender(STORAGE_OVERVIEW_MIN_ZOOM, true)).toBe(true);
    expect(refineryMvtOverviewShouldRender(STORAGE_OVERVIEW_MIN_ZOOM - 1, true)).toBe(false);
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

  it('detects OSM refineries in infrastructure view', () => {
    expect(
      osmInfrastructureLayerVisible('refineries', {
        isOilAndGasView: false,
        showInfrastructureLayers: true,
        isLiveDataView: false,
        infrastructureLayerVisibility: { refineries: true },
        showOsmPetroleum: false,
      }),
    ).toBe(true);
  });

  it('detects OSM pipelines independently of GEM', () => {
    expect(
      osmPipelinesLayerVisible({
        isOilAndGasView: true,
        showInfrastructureLayers: false,
        isLiveDataView: false,
        infrastructurePipelinesOn: false,
        showOsmPetroleum: true,
        osmLayerVisibility: { pipelines: true },
        osmLayerIds: ['pipelines'],
      }),
    ).toBe(true);
    expect(
      osmPipelinesLayerVisible({
        isOilAndGasView: true,
        showInfrastructureLayers: false,
        isLiveDataView: false,
        infrastructurePipelinesOn: false,
        showOsmPetroleum: false,
        osmLayerVisibility: { pipelines: true },
        osmLayerIds: ['pipelines'],
      }),
    ).toBe(false);
  });
});
