import { describe, expect, it } from 'vitest';
import {
  defaultUnitForDealProduct,
  findDealProductOption,
  unitFitsDealProduct,
  unitsForDealProduct,
} from './dealPackTransportOptions';

describe('dealPackTransportOptions', () => {
  it('defaults crude oil to barrels while still allowing metric tonnes', () => {
    expect(defaultUnitForDealProduct('Crude oil')).toBe('bbl');
    expect(unitsForDealProduct('Crude oil')).toContain('mt');
    expect(unitFitsDealProduct('Crude oil', 'bbl')).toBe(true);
  });

  it('uses dry metric tonnes for copper concentrate', () => {
    expect(findDealProductOption('Copper concentrate')?.id).toBe('copper_concentrate');
    expect(defaultUnitForDealProduct('Copper concentrate')).toBe('dmt');
  });

  it('falls back to broad commodity units for custom products', () => {
    expect(defaultUnitForDealProduct('Custom refinery blend')).toBe('mt');
    expect(unitsForDealProduct('Custom refinery blend')).toContain('bbl');
    expect(unitFitsDealProduct('Custom refinery blend', 'bags')).toBe(true);
  });
});
