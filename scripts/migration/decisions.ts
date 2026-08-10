/**
 * Pure decision helpers for the per-table migration lifecycle.
 *
 * These live outside the worker's streaming closure so they can be unit-tested
 * without Redis, BullMQ or a database. Keep them free of I/O.
 */

export type TableRunStatus = 'success' | 'partial' | 'failed' | 'skipped';

/**
 * How thoroughly the post-migration validation could vouch for a table.
 *
 *  - `verified`   — every required check ran and passed.
 *  - `mismatch`   — a required check ran and failed (counts disagree).
 *  - `unverified` — a required check could not run, so nothing is proven.
 *  - `not-run`    — validation was intentionally skipped (dry run).
 */
export type VerificationOutcome = 'verified' | 'mismatch' | 'unverified' | 'not-run';

/**
 * What to do with a table that a previous run left unfinished.
 *
 *  - `fresh`               — nothing to resume; stream from the beginning.
 *  - `resume-cursor`       — continue from the durable primary-key cursor.
 *  - `restart-idempotent`  — no usable cursor, but replaying is safe because the
 *                            target write collapses duplicates on a conflict key.
 *  - `blocked`             — no cursor AND no conflict key. Restarting would
 *                            duplicate rows, so refuse and make the operator choose.
 */
export type ResumeAction = 'fresh' | 'resume-cursor' | 'restart-idempotent' | 'blocked';

export interface ResumeCapabilities {
  /**
   * Keyset streaming is available: exactly one primary-key column and no join,
   * dedup, group-min or explicit ORDER BY reshaping the source query. Only then
   * does a stored cursor identify a real resume point.
   */
  cursorResumable: boolean;
  /** A conflict key exists, so re-inserting an already-migrated row is a no-op. */
  idempotent: boolean;
}

export interface DurableTableRecord {
  status: 'done' | 'partial' | 'failed';
  rows?: number;
  lastMigratedId?: unknown;
}

export interface ResumeDecision {
  action: ResumeAction;
  /** Cursor to start after; null means start from the beginning. */
  startId: unknown | null;
  reason: string;
}

/**
 * Decide how to pick a table back up, from the DURABLE record rather than
 * BullMQ's ephemeral job progress.
 *
 * The cursor was already being persisted to Redis on every run — it was simply
 * never read back, so resume only ever worked for a retry of the exact same job
 * id and every freshly submitted job restarted from zero.
 */
export function deriveResumeState(
  record: DurableTableRecord | null | undefined,
  caps: ResumeCapabilities,
): ResumeDecision {
  if (!record || record.status === 'done') {
    return { action: 'fresh', startId: null, reason: 'no unfinished work recorded' };
  }

  // Records written before resume existed carry no cursor; treat them as absent
  // rather than trusting an undefined value.
  const cursor = record.lastMigratedId;
  const hasCursor = cursor !== undefined && cursor !== null;

  if (caps.cursorResumable && hasCursor) {
    return {
      action: 'resume-cursor',
      startId: cursor,
      reason: `continuing after ${String(cursor)} from the last durable checkpoint`,
    };
  }

  if (caps.idempotent) {
    return {
      action: 'restart-idempotent',
      startId: null,
      reason: hasCursor
        ? 'source query is not keyset-resumable; restarting (conflict key makes the replay safe)'
        : 'no durable cursor recorded; restarting (conflict key makes the replay safe)',
    };
  }

  return {
    action: 'blocked',
    startId: null,
    reason:
      'cannot resume: the source query is not keyset-resumable and the target has no conflict key, ' +
      'so restarting would duplicate rows. Re-run with force to override.',
  };
}

export interface TableStatusInput {
  /**
   * False while the source stream is still in flight. An unfinished table can
   * never be reported successful — that mistake previously let a half-copied
   * table be recorded as complete and then skipped on retry, silently dropping
   * every remaining row.
   */
  streamComplete: boolean;
  failedRows: number;
  verification: VerificationOutcome;
}

/**
 * The single place that decides what a table's status is.
 *
 * A table only reaches 'success' when the stream finished, nothing failed, and
 * validation actually verified the result (or was deliberately not run, as in a
 * dry run). Anything less is 'partial' so a re-run retries it.
 */
export function decideTableStatus({
  streamComplete,
  failedRows,
  verification,
}: TableStatusInput): TableRunStatus {
  // In flight: nothing is settled yet, so the most this can claim is 'partial'.
  if (!streamComplete) return 'partial';

  if (failedRows > 0) return 'failed';

  switch (verification) {
    case 'verified':
    case 'not-run':
      return 'success';
    case 'mismatch':
    case 'unverified':
      return 'partial';
  }
}
