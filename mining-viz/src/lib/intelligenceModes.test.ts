import { describe, expect, it } from 'vitest';
import {
  legacyToIntelligence,
  resolveMapViewKey,
  suppliersPipelineActive,
} from './intelligenceModes';

describe('resolveMapViewKey', () => {
  it('maps supply chain to supply_chain view key', () => {
    expect(resolveMapViewKey('supply_chain', 'suppliers')).toBe('supply_chain');
  });

  it('maps assets ports sublayer to ports', () => {
    expect(resolveMapViewKey('assets', 'ports')).toBe('ports');
  });
});

describe('legacyToIntelligence', () => {
  it('migrates workspace to supply chain', () => {
    expect(legacyToIntelligence('workspace')).toEqual({
      mode: 'supply_chain',
      sublayer: 'suppliers',
    });
  });
});

describe('suppliersPipelineActive', () => {
  it('is true only for supply chain suppliers sublayer', () => {
    expect(suppliersPipelineActive('supply_chain', 'suppliers')).toBe(true);
    expect(suppliersPipelineActive('supply_chain', 'buyers')).toBe(false);
    expect(suppliersPipelineActive('assets', 'mines')).toBe(false);
  });
});
