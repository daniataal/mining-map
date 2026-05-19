import { describe, expect, it } from 'vitest';
import { licensePopupOpenDelayMs } from './licensePopupOpenDelay';

describe('licensePopupOpenDelayMs', () => {
  it('opens immediately after a map marker click (fly trigger unchanged)', () => {
    expect(licensePopupOpenDelayMs(3, 3)).toBe(0);
  });

  it('defers open when sidebar selection bumps the fly trigger', () => {
    expect(licensePopupOpenDelayMs(4, 3)).toBe(60);
  });
});
