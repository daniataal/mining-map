// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  blockAnnotationsServerHydration,
  clearMiningAuthStorage,
  getStoredMiningToken,
  isAnnotationsServerHydrationBlocked,
  isJwtExpired,
  resetAnnotationsHydrationSession,
} from './miningAuth';

function jwtWithExp(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.sig`;
}

describe('getStoredMiningToken', () => {
  afterEach(() => {
    clearMiningAuthStorage();
  });

  it('prefers mining_token over legacy token key', () => {
    localStorage.setItem('token', 'legacy');
    localStorage.setItem('mining_token', 'primary');
    expect(getStoredMiningToken()).toBe('primary');
  });

  it('falls back to legacy token key', () => {
    localStorage.setItem('token', 'legacy');
    expect(getStoredMiningToken()).toBe('legacy');
  });
});

describe('isJwtExpired', () => {
  it('returns true for malformed tokens', () => {
    expect(isJwtExpired('not-a-jwt')).toBe(true);
  });

  it('returns true when exp is in the past', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    expect(isJwtExpired(jwtWithExp(past))).toBe(true);
  });

  it('returns false when exp is in the future', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isJwtExpired(jwtWithExp(future))).toBe(false);
  });
});

describe('clearMiningAuthStorage', () => {
  it('removes mining session keys', () => {
    localStorage.setItem('mining_token', 'x');
    localStorage.setItem('mining_username', 'u');
    localStorage.setItem('token', 'legacy');
    clearMiningAuthStorage();
    expect(localStorage.getItem('mining_token')).toBeNull();
    expect(localStorage.getItem('mining_username')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });
});

describe('annotations hydration session', () => {
  it('blocks server hydration after invalidate until reset', () => {
    resetAnnotationsHydrationSession();
    expect(isAnnotationsServerHydrationBlocked()).toBe(false);
    blockAnnotationsServerHydration();
    expect(isAnnotationsServerHydrationBlocked()).toBe(true);
    resetAnnotationsHydrationSession();
    expect(isAnnotationsServerHydrationBlocked()).toBe(false);
  });
});
