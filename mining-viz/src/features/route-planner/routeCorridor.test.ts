import { describe, expect, it } from 'vitest';
import {
  attachSupplierBuyerEnds,
  detectLikelySupplierBuyerReversal,
} from './routeCorridor';

describe('routeCorridor', () => {
  it('detects Israel supplier with Ghana buyer as likely reversed', () => {
    const msg = detectLikelySupplierBuyerReversal(
      { lat: 32.819, lng: 34.99, country: 'Israel', label: 'Haifa Port' },
      { lat: 5.548, lng: -0.192, country: 'Ghana', label: 'Accra' },
    );
    expect(msg).toMatch(/Ghana → Israel/i);
  });

  it('does not warn for Ghana supplier and Israel buyer', () => {
    const msg = detectLikelySupplierBuyerReversal(
      { lat: 5.548, lng: -0.192, country: 'Ghana', label: 'Accra' },
      { lat: 32.819, lng: 34.99, country: 'Israel', label: 'Haifa Port' },
    );
    expect(msg).toBeNull();
  });

  it('attachSupplierBuyerEnds pins map labels to panel parties', () => {
    const map = attachSupplierBuyerEnds(
      { legs: [], waypoints: [] },
      { lat: 5.5, lng: -0.2, label: 'Ghana mine' },
      { lat: 32.82, lng: 34.99, label: 'Haifa Port' },
    );
    expect(map.ends?.from.label).toBe('Ghana mine');
    expect(map.ends?.to.label).toBe('Haifa Port');
    expect(map.waypoints[0].label[1]).toContain('From: Ghana mine');
    expect(map.waypoints[map.waypoints.length - 1].label[1]).toContain('To: Haifa Port');
  });
});
