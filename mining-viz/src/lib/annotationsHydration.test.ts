import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLicenseAnnotationsFromServer, resetSharedAnnotationsHydration } from './annotationsHydration';

const getMock = vi.fn();

vi.mock('./api', () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

describe('fetchLicenseAnnotationsFromServer', () => {
  beforeEach(() => {
    getMock.mockReset();
    resetSharedAnnotationsHydration();
    getMock.mockResolvedValue({
      data: { annotations: { lic1: { stage: 'screening' } } },
    });
  });

  afterEach(() => {
    resetSharedAnnotationsHydration();
  });

  it('dedupes concurrent requests for the same token', async () => {
    const [a, b] = await Promise.all([
      fetchLicenseAnnotationsFromServer('tok-a'),
      fetchLicenseAnnotationsFromServer('tok-a'),
    ]);
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(a.annotations).toEqual(b.annotations);
  });
});
