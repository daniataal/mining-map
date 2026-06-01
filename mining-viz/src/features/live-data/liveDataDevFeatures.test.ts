import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShowSeedDataToggle, canToggleGovernmentAisCoverage, shouldShowProvenanceBadge } from './liveDataDevFeatures';

describe('liveDataDevFeatures', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('canShowSeedDataToggle is true in DEV', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_ALLOW_SEED_DATA_TOGGLE', '');
    expect(canShowSeedDataToggle()).toBe(true);
  });

  it('canShowSeedDataToggle respects VITE_ALLOW_SEED_DATA_TOGGLE in prod build', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ALLOW_SEED_DATA_TOGGLE', '1');
    expect(canShowSeedDataToggle()).toBe(true);
  });

  it('shouldShowProvenanceBadge hides seed_port_calls in prod', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ALLOW_SEED_DATA_TOGGLE', '');
    expect(shouldShowProvenanceBadge('seed_port_calls')).toBe(false);
    expect(shouldShowProvenanceBadge('synthetic')).toBe(true);
  });

  it('canToggleGovernmentAisCoverage follows dev seed toggle policy', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_GOVERNMENT_AIS_COVERAGE_LAYER', '');
    expect(canToggleGovernmentAisCoverage()).toBe(true);
  });
});
