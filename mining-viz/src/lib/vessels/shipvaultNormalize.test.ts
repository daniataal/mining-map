import { describe, expect, it } from 'vitest';
import { formatTonnage, typesMismatch } from './shipvaultNormalize';

describe('typesMismatch', () => {
  it('flags divergent AIS vs registry labels', () => {
    expect(typesMismatch('Tanker', 'Ferry')).toBe(true);
    expect(typesMismatch('Oil/Chemical Tanker', 'Tanker')).toBe(false);
    expect(typesMismatch('', 'Tanker')).toBe(false);
  });
});

describe('formatTonnage', () => {
  it('formats large numbers', () => {
    expect(formatTonnage(159450)).toMatch(/159/);
    expect(formatTonnage(0)).toBe('—');
  });
});
