import { describe, expect, it } from 'vitest';
import { describeGovProcurementLoadError } from './govProcurementErrors';

describe('describeGovProcurementLoadError', () => {
  it('returns 503 message for service unavailable', () => {
    const err = {
      isAxiosError: true,
      response: { status: 503, data: 'Service unavailable while initializing.' },
    };
    expect(describeGovProcurementLoadError(err)).toContain('still starting');
  });

  it('uses first warning from JSON body when present', () => {
    const err = {
      isAxiosError: true,
      response: {
        status: 200,
        data: { warnings: ['No matching awards for ACME in the synced database.'] },
      },
    };
    expect(describeGovProcurementLoadError(err)).toContain('No matching awards');
  });
});
