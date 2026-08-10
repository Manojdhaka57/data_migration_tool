import { describe, it, expect } from 'vitest';
import { IDatabaseAdapter } from '../adapters/db.interface';
import { ValidationEngine, ValidateTableOptions } from './engine';

interface StubBehaviour {
  rowCount?: number | Error;
  checksum?: string | Error;
}

/** Minimal stand-in — validation only ever calls these two methods. */
function stubAdapter({ rowCount = 0, checksum = '' }: StubBehaviour = {}): IDatabaseAdapter {
  return {
    getRowCount: async () => {
      if (rowCount instanceof Error) throw rowCount;
      return rowCount;
    },
    getChecksum: async () => {
      if (checksum instanceof Error) throw checksum;
      return checksum;
    },
  } as unknown as IDatabaseAdapter;
}

function validate(overrides: Partial<ValidateTableOptions> = {}) {
  return ValidationEngine.validateTable({
    sourceAdapter: stubAdapter(),
    targetAdapter: stubAdapter(),
    sourceTable: 'students',
    targetTable: 'opportunities',
    rowsInserted: 0,
    rowsRead: 0,
    targetCountBefore: 0,
    ...overrides,
  });
}

describe('ValidationEngine.validateTable', () => {
  describe('when a count query fails', () => {
    // The previous implementation left both counts at 0 after a throw, compared
    // 0 === 0, and returned 'passed'. A validation that reports success when it
    // could not run is worse than having none at all.
    it('reports unverified rather than passed if the source count throws', async () => {
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: new Error('connection reset') }),
        targetAdapter: stubAdapter({ rowCount: 0 }),
      });

      expect(report.status).toBe('unverified');
      expect(report.countMatch).toBe(false);
      expect(report.errors.join(' ')).toContain('Source row count failed');
    });

    it('reports unverified rather than passed if the target count throws', async () => {
      const report = await validate({
        targetAdapter: stubAdapter({ rowCount: new Error('permission denied') }),
      });

      expect(report.status).toBe('unverified');
      expect(report.checks.find(c => c.name === 'target-delta')?.status).toBe('skipped');
    });

    it('reports unverified when the target was never baselined', async () => {
      // The CLI path cannot baseline, so it must come back unverified, not passed.
      const report = await validate({ targetCountBefore: -1 });
      expect(report.status).toBe('unverified');
    });
  });

  describe('target delta', () => {
    it('passes when the target grows by exactly what was inserted', async () => {
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: 100 }),
        targetAdapter: stubAdapter({ rowCount: 150 }),
        targetCountBefore: 50,
        rowsInserted: 100,
        rowsRead: 100,
      });

      expect(report.targetDelta).toBe(100);
      expect(report.status).toBe('passed');
    });

    it('is correct against a PRE-POPULATED target', async () => {
      // The old absolute comparison (sourceCount === targetCount) failed here:
      // the target already held 50 unrelated rows, so 100 !== 150 looked broken.
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: 100 }),
        targetAdapter: stubAdapter({ rowCount: 150 }),
        targetCountBefore: 50,
        rowsInserted: 100,
        rowsRead: 100,
      });

      expect(report.status).toBe('passed');
    });

    it('is correct under a row filter', async () => {
      // Source count uses the same WHERE as the stream, so a filtered run that
      // moved 10 of 1000 rows reconciles cleanly.
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: 10 }),
        targetAdapter: stubAdapter({ rowCount: 10 }),
        targetCountBefore: 0,
        rowsInserted: 10,
        rowsRead: 10,
        sourceWhere: "status = 'ACTIVE'",
      });

      expect(report.status).toBe('passed');
    });

    it('fails when the target did not grow by the inserted amount', async () => {
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: 100 }),
        targetAdapter: stubAdapter({ rowCount: 90 }),
        targetCountBefore: 0,
        rowsInserted: 100,
        rowsRead: 100,
      });

      expect(report.status).toBe('failed');
      expect(report.errors.join(' ')).toContain('grew by 90');
    });

    it('allows an upsert to grow the target by less than it wrote', async () => {
      // Upserts that update existing rows legitimately add no rows.
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: 100 }),
        targetAdapter: stubAdapter({ rowCount: 130 }),
        targetCountBefore: 100,
        rowsInserted: 100,
        rowsRead: 100,
        conflictStrategy: 'upsert',
      });

      expect(report.status).toBe('passed');
    });

    it('still rejects an upsert that grew the target by MORE than it wrote', async () => {
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: 100 }),
        targetAdapter: stubAdapter({ rowCount: 500 }),
        targetCountBefore: 100,
        rowsInserted: 100,
        rowsRead: 100,
        conflictStrategy: 'upsert',
      });

      expect(report.status).toBe('failed');
    });
  });

  describe('source reconciliation', () => {
    it('fails when fewer rows were read than the source holds', async () => {
      // Catches a stream that stopped early — the case a per-table row count
      // alone cannot see when the target happens to look plausible.
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: 1000 }),
        targetAdapter: stubAdapter({ rowCount: 400 }),
        targetCountBefore: 0,
        rowsInserted: 400,
        rowsRead: 400,
      });

      expect(report.status).toBe('failed');
      expect(report.errors.join(' ')).toContain('Read 400');
    });

    it('counts failed and skipped rows as read', async () => {
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: 100 }),
        targetAdapter: stubAdapter({ rowCount: 80 }),
        targetCountBefore: 0,
        rowsInserted: 80,
        rowsRead: 80 + 15 + 5,
      });

      expect(report.checks.find(c => c.name === 'source-reconciliation')?.status).toBe('passed');
    });
  });

  describe('checksums', () => {
    const comparable = {
      sourceAdapter: stubAdapter({ rowCount: 10, checksum: 'abc' }),
      targetAdapter: stubAdapter({ rowCount: 10, checksum: 'abc' }),
      targetCountBefore: 0,
      rowsInserted: 10,
      rowsRead: 10,
      checksumSourceColumns: ['student_id'],
      checksumTargetColumns: ['id'],
    };

    it('does not treat two empty checksums as a match', async () => {
      // Adapters swallow checksum failures to ''. The old code compared
      // '' === '' and passed, so checksums silently no-opped on any renamed
      // column — exactly the case they exist to catch.
      const report = await validate({
        ...comparable,
        sourceAdapter: stubAdapter({ rowCount: 10, checksum: '' }),
        targetAdapter: stubAdapter({ rowCount: 10, checksum: '' }),
      });

      expect(report.checksumChecked).toBe(false);
      expect(report.checksumMatch).toBe(false);
      expect(report.checks.find(c => c.name === 'checksum')?.status).toBe('skipped');
    });

    it('warns — not fails — when comparable checksums differ', async () => {
      const report = await validate({
        ...comparable,
        targetAdapter: stubAdapter({ rowCount: 10, checksum: 'zzz' }),
      });

      expect(report.status).toBe('warning');
      expect(report.checksumChecked).toBe(true);
    });

    it('skips entirely when no untransformed column pairs were supplied', async () => {
      const report = await validate({
        sourceAdapter: stubAdapter({ rowCount: 10, checksum: 'abc' }),
        targetAdapter: stubAdapter({ rowCount: 10, checksum: 'different' }),
        targetCountBefore: 0,
        rowsInserted: 10,
        rowsRead: 10,
      });

      // Transformed columns are *supposed* to differ, so comparing them would
      // produce noise, not signal.
      expect(report.status).toBe('passed');
      expect(report.checks.find(c => c.name === 'checksum')?.status).toBe('skipped');
    });

    it('surfaces the row cap instead of implying whole-table coverage', async () => {
      const report = await validate({ ...comparable, checksumRowCap: 50000 });
      expect(report.checks.find(c => c.name === 'checksum')?.detail).toContain('50000');
    });
  });
});
