// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clearMiningAuthStorage } from './miningAuth';

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
