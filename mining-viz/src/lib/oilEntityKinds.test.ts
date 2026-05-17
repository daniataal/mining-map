import { describe, expect, it } from 'vitest';
import { isOilFieldEntity, isRefineryEntity } from './oilEntityKinds';

describe('isRefineryEntity', () => {
  it('matches explicit refinery subtype in oil & gas sector', () => {
    expect(
      isRefineryEntity({
        entitySubtype: 'refinery',
        licenseType: 'Refinery Complex',
        sector: 'oil_and_gas',
        commodity: 'Refined Products',
      })
    ).toBe(true);
  });

  it('does not treat oil fields as refineries', () => {
    expect(
      isRefineryEntity({
        entitySubtype: 'oil_field',
        licenseType: 'Supergiant Offshore Field',
        sector: 'oil_and_gas',
        commodity: 'Crude Oil',
      })
    ).toBe(false);
  });

  it('does not match gold refinery licenses outside oil & gas', () => {
    expect(
      isRefineryEntity({
        entitySubtype: null,
        licenseType: 'Gold Export (Refinery)',
        sector: 'mining',
        commodity: 'Gold Refinery Services',
      })
    ).toBe(false);
  });
});

describe('isOilFieldEntity', () => {
  it('matches Zakum-style oil field rows', () => {
    expect(
      isOilFieldEntity({
        entitySubtype: 'oil_field',
        licenseType: 'Supergiant Offshore Field',
        sector: 'oil_and_gas',
        commodity: 'Crude Oil',
      })
    ).toBe(true);
  });
});
