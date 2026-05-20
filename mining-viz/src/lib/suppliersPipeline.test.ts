import { describe, expect, it } from 'vitest';
import {
  countSuppliersPipeline,
  isSupplierDealSignal,
  matchesSuppliersPipeline,
} from './suppliersPipeline';

describe('suppliersPipeline', () => {
  it('treats green deal signal as supplier marker', () => {
    expect(isSupplierDealSignal({ status: 'good' })).toBe(true);
    expect(isSupplierDealSignal({ status: 'Approved' })).toBe(false);
  });

  it('filters to active pipeline stages by default', () => {
    expect(matchesSuppliersPipeline({ status: 'good', stage: 'Investigating' }, { showAll: false })).toBe(
      true,
    );
    expect(matchesSuppliersPipeline({ status: 'good', stage: 'Rejected' }, { showAll: false })).toBe(
      false,
    );
    expect(matchesSuppliersPipeline({ status: 'maybe', stage: 'Investigating' }, { showAll: false })).toBe(
      false,
    );
  });

  it('showAll bypasses pipeline filter', () => {
    expect(matchesSuppliersPipeline(undefined, { showAll: true })).toBe(true);
    expect(matchesSuppliersPipeline({ status: 'bad' }, { showAll: true })).toBe(true);
  });

  it('counts active suppliers in license set', () => {
    const ids = ['a', 'b', 'c'];
    const annotations = {
      a: { status: 'good', stage: 'Approved' },
      b: { status: 'good', stage: 'Rejected' },
      c: { status: 'maybe', stage: 'Investigating' },
    };
    expect(countSuppliersPipeline(ids, annotations)).toEqual({ active: 1, total: 3 });
  });
});
