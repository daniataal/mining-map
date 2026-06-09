import { describe, expect, it } from 'vitest';
import { isMiningAdmin } from './miningAuth';

describe('miningAuth roles', () => {
  it('isMiningAdmin is true only for admin role', () => {
    expect(isMiningAdmin('admin')).toBe(true);
    expect(isMiningAdmin('user')).toBe(false);
    expect(isMiningAdmin(null)).toBe(false);
  });
});
