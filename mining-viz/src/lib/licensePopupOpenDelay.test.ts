import { describe, expect, it } from 'vitest';
import {
  isSidebarFlySelection,
  licensePopupOpenDelayMs,
} from './licensePopupOpenDelay';
import {
  createLicenseMarkerIconCache,
  markerIconSignature,
} from './licenseMarkerIconCache';
import type { DivIcon } from 'leaflet';

describe('isSidebarFlySelection', () => {
  it('is false when only the map marker was clicked (fly trigger unchanged)', () => {
    expect(isSidebarFlySelection(3, 3)).toBe(false);
  });

  it('is true when sidebar selection bumped the fly trigger', () => {
    expect(isSidebarFlySelection(4, 3)).toBe(true);
  });
});

describe('licensePopupOpenDelayMs', () => {
  it('returns 0 for map marker clicks', () => {
    expect(licensePopupOpenDelayMs(3, 3)).toBe(0);
  });

  it('returns 60 when sidebar selection bumps fly trigger (legacy)', () => {
    expect(licensePopupOpenDelayMs(4, 3)).toBe(60);
  });
});

describe('licenseMarkerIconCache', () => {
  it('reuses icons when signature is unchanged', () => {
    const cache = createLicenseMarkerIconCache();
    const sig = markerIconSignature('#FFD700', false, false, false);
    const a = cache.get('id-1', sig, () => ({}) as DivIcon);
    const b = cache.get('id-1', sig, () => ({ options: 'other' }) as DivIcon);
    expect(a).toBe(b);
  });

  it('rebuilds icon when signature changes', () => {
    const cache = createLicenseMarkerIconCache();
    const a = cache.get('id-1', markerIconSignature('#FFD700', false, false, false), () => ({ a: 1 }) as DivIcon);
    const b = cache.get('id-1', markerIconSignature('#ef4444', true, false, false), () => ({ b: 2 }) as DivIcon);
    expect(a).not.toBe(b);
  });

  it('prunes icons for licenses no longer on the map', () => {
    const cache = createLicenseMarkerIconCache();
    const sig = markerIconSignature('#64748b', false, false, false);
    cache.get('gone', sig, () => ({}) as DivIcon);
    cache.get('stay', sig, () => ({}) as DivIcon);
    cache.prune(new Set(['stay']));
    const after = cache.get('gone', sig, () => ({ fresh: true }) as DivIcon);
    expect((after as { fresh?: boolean }).fresh).toBe(true);
  });
});
