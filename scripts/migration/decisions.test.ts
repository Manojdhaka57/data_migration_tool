import { describe, it, expect } from 'vitest';
import { decideTableStatus } from './decisions';

describe('decideTableStatus', () => {
  describe('while the stream is still in flight', () => {
    // Regression guard for the worst defect found in the audit: the periodic
    // in-flight checkpoint recorded a half-copied table as 'success'. On a retry
    // that table landed in `completedTables` and was skipped outright, so every
    // row after the checkpoint was silently never migrated.
    it('never reports success, whatever validation says', () => {
      for (const verification of ['verified', 'mismatch', 'unverified', 'not-run'] as const) {
        expect(
          decideTableStatus({ streamComplete: false, failedRows: 0, verification }),
        ).toBe('partial');
      }
    });

    it('never reports success even with failures recorded', () => {
      expect(
        decideTableStatus({ streamComplete: false, failedRows: 12, verification: 'verified' }),
      ).toBe('partial');
    });
  });

  describe('once the stream has completed', () => {
    it('reports success only when validation actually verified the table', () => {
      expect(
        decideTableStatus({ streamComplete: true, failedRows: 0, verification: 'verified' }),
      ).toBe('success');
    });

    it('treats a dry run as successful — there is nothing to verify', () => {
      expect(
        decideTableStatus({ streamComplete: true, failedRows: 0, verification: 'not-run' }),
      ).toBe('success');
    });

    it('downgrades to partial when validation could not run', () => {
      // "We could not check" must never be reported as "we checked and it passed".
      expect(
        decideTableStatus({ streamComplete: true, failedRows: 0, verification: 'unverified' }),
      ).toBe('partial');
    });

    it('downgrades to partial when counts disagree', () => {
      expect(
        decideTableStatus({ streamComplete: true, failedRows: 0, verification: 'mismatch' }),
      ).toBe('partial');
    });

    it('reports failed when rows failed, ahead of any validation outcome', () => {
      expect(
        decideTableStatus({ streamComplete: true, failedRows: 1, verification: 'verified' }),
      ).toBe('failed');
    });
  });
});
