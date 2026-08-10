import { IDatabaseAdapter } from '../adapters/db.interface';

export type ValidationStatus = 'passed' | 'failed' | 'warning' | 'unverified';
export type CheckStatus = 'passed' | 'failed' | 'skipped';

export interface ValidationCheck {
  name: 'target-delta' | 'source-reconciliation' | 'checksum';
  status: CheckStatus;
  detail: string;
}

export interface ValidationReport {
  tableName: string;
  /** Source rows matching the same WHERE/FROM the stream used. -1 when unavailable. */
  sourceCount: number;
  /** Absolute target row count AFTER the run. -1 when unavailable. */
  targetCount: number;
  /** Absolute target row count BEFORE the run. -1 when unavailable. */
  targetCountBefore: number;
  /** targetCount - targetCountBefore, or -1 when either side is unavailable. */
  targetDelta: number;
  rowsInserted: number;
  rowsRead: number;
  /** Back-compat: true when every REQUIRED check ran and passed. */
  countMatch: boolean;
  sourceChecksum: string;
  targetChecksum: string;
  checksumMatch: boolean;
  /** False when checksums were skipped or could not be computed. */
  checksumChecked: boolean;
  checks: ValidationCheck[];
  status: ValidationStatus;
  errors: string[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface ValidateTableOptions {
  sourceAdapter: IDatabaseAdapter;
  targetAdapter: IDatabaseAdapter;
  sourceTable: string;
  targetTable: string;
  /** Rows this run reports as inserted into the target. */
  rowsInserted: number;
  /** Rows this run actually read from the source (inserted + failed + skipped). */
  rowsRead: number;
  /** Target count captured before streaming began. Pass -1 when unknown. */
  targetCountBefore: number;
  /**
   * 'skip' means pure inserts, so the target must grow by exactly rowsInserted.
   * 'upsert' means writes may update existing rows, which do not change the
   * count — so the target may grow by less.
   */
  conflictStrategy?: 'skip' | 'upsert';
  /** The same WHERE the stream used, so counts are comparable. */
  sourceWhere?: string;
  /** The same FROM the stream used (join/dedup subquery), so counts are comparable. */
  sourceFromClause?: string;
  /**
   * Column pairs eligible for checksum comparison: DIRECT-mapped, untransformed,
   * unqualified. Leave empty to skip checksums — comparing transformed columns is
   * meaningless because the values are *supposed* to differ.
   */
  checksumSourceColumns?: string[];
  checksumTargetColumns?: string[];
  /** Row cap the adapters' checksum queries apply, surfaced in the report. */
  checksumRowCap?: number;
}

/**
 * Verifies that a migrated table actually received the rows the run claims.
 *
 * Design note — every check reports `passed`, `failed` or `skipped`, and a
 * skipped REQUIRED check yields an overall `unverified`, never `passed`. The
 * previous implementation compared two zeros after a failed count query, and two
 * empty strings after a failed checksum, and called both a pass; a validation
 * that silently succeeds when it could not run is worse than no validation.
 */
export class ValidationEngine {
  static async validateTable(opts: ValidateTableOptions): Promise<ValidationReport> {
    const {
      sourceAdapter,
      targetAdapter,
      sourceTable,
      targetTable,
      rowsInserted,
      rowsRead,
      targetCountBefore,
      conflictStrategy = 'skip',
      sourceWhere,
      sourceFromClause,
      checksumSourceColumns = [],
      checksumTargetColumns = [],
      checksumRowCap,
    } = opts;

    const errors: string[] = [];
    const checks: ValidationCheck[] = [];

    let sourceCount = -1;
    let targetCount = -1;
    let sourceChecksum = '';
    let targetChecksum = '';
    let checksumChecked = false;

    // Counts use the SAME where/from as the stream, so a dedup or join query is
    // compared against the row shape it actually produced.
    try {
      sourceCount = await sourceAdapter.getRowCount(sourceTable, sourceWhere, sourceFromClause);
    } catch (err: unknown) {
      errors.push(`Source row count failed: ${errorMessage(err)}`);
    }
    try {
      targetCount = await targetAdapter.getRowCount(targetTable);
    } catch (err: unknown) {
      errors.push(`Target row count failed: ${errorMessage(err)}`);
    }

    // --- Check 1 (required): did the target grow by what we think we wrote? ---
    // This is a delta, not an absolute comparison, so it stays correct when the
    // target already held rows and when a row filter, join or dedup is in play.
    const deltaKnown = targetCount >= 0 && targetCountBefore >= 0;
    const targetDelta = deltaKnown ? targetCount - targetCountBefore : -1;

    if (!deltaKnown) {
      checks.push({
        name: 'target-delta',
        status: 'skipped',
        detail: 'target row count unavailable before and/or after the run',
      });
    } else if (conflictStrategy === 'upsert') {
      // Updates do not add rows, so growth of less than rowsInserted is expected.
      const ok = targetDelta >= 0 && targetDelta <= rowsInserted;
      checks.push({
        name: 'target-delta',
        status: ok ? 'passed' : 'failed',
        detail: `target grew by ${targetDelta}; upsert wrote ${rowsInserted} row(s) (updates do not add rows)`,
      });
      if (!ok) {
        errors.push(
          `Target row delta ${targetDelta} is not consistent with ${rowsInserted} upserted row(s) in ${targetTable}`,
        );
      }
    } else {
      const ok = targetDelta === rowsInserted;
      checks.push({
        name: 'target-delta',
        status: ok ? 'passed' : 'failed',
        detail: `target grew by ${targetDelta}, expected ${rowsInserted}`,
      });
      if (!ok) {
        errors.push(
          `Target row count grew by ${targetDelta} but ${rowsInserted} row(s) were inserted into ${targetTable}`,
        );
      }
    }

    // --- Check 2 (required): did we read everything the source offered? ---
    if (sourceCount < 0) {
      checks.push({
        name: 'source-reconciliation',
        status: 'skipped',
        detail: 'source row count unavailable',
      });
    } else {
      const ok = rowsRead === sourceCount;
      checks.push({
        name: 'source-reconciliation',
        status: ok ? 'passed' : 'failed',
        detail: `read ${rowsRead} of ${sourceCount} source row(s)`,
      });
      if (!ok) {
        errors.push(
          `Read ${rowsRead} row(s) but the source holds ${sourceCount} for ${sourceTable} — rows were not all processed`,
        );
      }
    }

    const requiredChecks = checks.filter(c => c.name !== 'checksum');
    const requiredFailed = requiredChecks.some(c => c.status === 'failed');
    const requiredSkipped = requiredChecks.some(c => c.status === 'skipped');

    // --- Check 3 (advisory): value-level checksum over comparable columns ---
    const canChecksum =
      checksumSourceColumns.length > 0 &&
      checksumSourceColumns.length === checksumTargetColumns.length &&
      !requiredFailed &&
      !requiredSkipped &&
      sourceCount > 0;

    if (!canChecksum) {
      checks.push({
        name: 'checksum',
        status: 'skipped',
        detail:
          checksumSourceColumns.length === 0
            ? 'no DIRECT untransformed column pairs to compare'
            : 'skipped because row counts did not verify',
      });
    } else {
      try {
        sourceChecksum = await sourceAdapter.getChecksum(sourceTable, checksumSourceColumns);
        targetChecksum = await targetAdapter.getChecksum(targetTable, checksumTargetColumns);
      } catch (err: unknown) {
        errors.push(`Checksum generation failed: ${errorMessage(err)}`);
      }

      // The adapters swallow checksum errors to an empty string. Treat an empty
      // result as "could not compute" rather than letting '' === '' pass.
      if (!sourceChecksum || !targetChecksum) {
        checks.push({
          name: 'checksum',
          status: 'skipped',
          detail: 'checksum could not be computed on one or both sides',
        });
      } else {
        checksumChecked = true;
        const ok = sourceChecksum === targetChecksum;
        const cap = checksumRowCap ? ` (first ${checksumRowCap} rows only)` : '';
        checks.push({
          name: 'checksum',
          status: ok ? 'passed' : 'failed',
          detail: ok ? `checksums match${cap}` : `checksums differ${cap}`,
        });
        if (!ok) {
          errors.push(
            `Data checksum mismatch on ${targetTable}${cap} (potential data mutation or encoding difference)`,
          );
        }
      }
    }

    const checksumCheck = checks.find(c => c.name === 'checksum');

    let status: ValidationStatus;
    if (requiredFailed) status = 'failed';
    else if (requiredSkipped) status = 'unverified';
    else if (checksumCheck?.status === 'failed') status = 'warning';
    else status = 'passed';

    return {
      tableName: targetTable,
      sourceCount,
      targetCount,
      targetCountBefore,
      targetDelta,
      rowsInserted,
      rowsRead,
      countMatch: !requiredFailed && !requiredSkipped,
      sourceChecksum,
      targetChecksum,
      checksumMatch: checksumChecked && sourceChecksum === targetChecksum,
      checksumChecked,
      checks,
      status,
      errors,
    };
  }
}
