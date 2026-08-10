import { describe, it, expect } from 'vitest';
import { deriveResumeState, ResumeCapabilities } from './decisions';

const keysetTable: ResumeCapabilities = { cursorResumable: true, idempotent: true };
const joinedTable: ResumeCapabilities = { cursorResumable: false, idempotent: true };
const unsafeTable: ResumeCapabilities = { cursorResumable: false, idempotent: false };

describe('deriveResumeState', () => {
  describe('with nothing to resume', () => {
    it('starts fresh when there is no durable record', () => {
      expect(deriveResumeState(null, keysetTable)).toMatchObject({
        action: 'fresh',
        startId: null,
      });
    });

    it('starts fresh when the table is already done', () => {
      expect(
        deriveResumeState({ status: 'done', rows: 100, lastMigratedId: 999 }, keysetTable),
      ).toMatchObject({ action: 'fresh', startId: null });
    });
  });

  describe('resuming a keyset-streamable table', () => {
    // The core defect: this cursor was persisted on every run and never read, so
    // a newly submitted job always restarted from row zero.
    it('continues from the durable cursor after a partial run', () => {
      const decision = deriveResumeState(
        { status: 'partial', rows: 5000, lastMigratedId: 5000 },
        keysetTable,
      );

      expect(decision.action).toBe('resume-cursor');
      expect(decision.startId).toBe(5000);
    });

    it('also resumes after a failed run', () => {
      const decision = deriveResumeState(
        { status: 'failed', rows: 120, lastMigratedId: 120 },
        keysetTable,
      );

      expect(decision.action).toBe('resume-cursor');
      expect(decision.startId).toBe(120);
    });

    it('handles a non-numeric cursor', () => {
      const decision = deriveResumeState(
        { status: 'partial', lastMigratedId: 'UP23G1220037' },
        keysetTable,
      );

      expect(decision).toMatchObject({ action: 'resume-cursor', startId: 'UP23G1220037' });
    });

    it('treats a zero cursor as a real cursor, not as absent', () => {
      // A falsy-but-present id must not be mistaken for "no checkpoint".
      const decision = deriveResumeState({ status: 'partial', lastMigratedId: 0 }, keysetTable);
      expect(decision).toMatchObject({ action: 'resume-cursor', startId: 0 });
    });
  });

  describe('when no usable cursor exists', () => {
    it('restarts a joined/deduped table when the write is idempotent', () => {
      // A join or dedup means the stored PK does not identify a resume point,
      // but a conflict key makes replaying the whole table harmless.
      const decision = deriveResumeState(
        { status: 'partial', rows: 400, lastMigratedId: 400 },
        joinedTable,
      );

      expect(decision.action).toBe('restart-idempotent');
      expect(decision.startId).toBeNull();
    });

    it('restarts when an older record carries no cursor at all', () => {
      // Backward compatibility: records written before resume existed have no
      // lastMigratedId field.
      const decision = deriveResumeState({ status: 'partial', rows: 10 }, keysetTable);
      expect(decision.action).toBe('restart-idempotent');
    });

    it('REFUSES to restart when replaying would duplicate rows', () => {
      // No cursor and no conflict key: a blind restart would double the data.
      // Refusing loudly is the only safe answer.
      const decision = deriveResumeState({ status: 'partial', rows: 400 }, unsafeTable);

      expect(decision.action).toBe('blocked');
      expect(decision.startId).toBeNull();
      expect(decision.reason).toContain('duplicate');
    });

    it('blocks a failed non-idempotent table too', () => {
      expect(deriveResumeState({ status: 'failed' }, unsafeTable).action).toBe('blocked');
    });
  });
});
