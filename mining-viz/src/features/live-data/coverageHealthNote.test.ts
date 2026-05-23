import { describe, expect, it } from 'vitest';
import { coverageViewVsDbNote } from './coverageHealthNote';

describe('coverageViewVsDbNote', () => {
  it('returns null when in-view has features', () => {
    expect(
      coverageViewVsDbNote({
        inView: { terminals: 1, vessels: 0, corridors: 0, opportunities: 0 },
        db: { vesselObservations: 100, terminals: 50 },
      }),
    ).toBeNull();
  });

  it('explains bbox vs ledger when in-view is empty but DB has rows', () => {
    const note = coverageViewVsDbNote({
      inView: { terminals: 0, vessels: 0, corridors: 0, opportunities: 0 },
      db: { vesselObservations: 22000, terminals: 120 },
    });
    expect(note?.en).toContain('0 in current map bbox');
    expect(note?.en).toContain('22,000');
    expect(note?.en).toContain('maritime-worker');
  });
});
