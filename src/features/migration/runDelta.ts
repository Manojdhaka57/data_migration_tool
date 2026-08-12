/**
 * Change against the previous migration run.
 *
 * The reference dashboard shows "+12%" badges on its stat cards. This computes
 * that from data the app genuinely has — migrationResultsSlice keeps a run
 * history — rather than inventing a trend.
 *
 * The important rule: **with no previous run there is no delta**, and the
 * caller renders no badge. A first run is not "+0%"; it is a run with nothing
 * to compare against, and showing 0% would assert something false.
 */
import type { MigrationResult } from './migrationResultsSlice';

export interface Delta {
  /** Signed percentage change against the previous run. */
  percent: number;
  /** True when the change is an improvement, accounting for direction. */
  good: boolean;
}

/** Metrics where a SMALLER number is the better outcome. */
const LOWER_IS_BETTER = new Set(['duration', 'failedRows']);

/**
 * Percentage change from `previous` to `current`.
 *
 * Returns null when there is nothing meaningful to say:
 *  - no previous run,
 *  - a previous value of zero (any increase from 0 is an infinite percentage,
 *    which is not information).
 */
export function percentChange(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return ((current - previous) / previous) * 100;
}

export function computeDelta(
  metric: string,
  current: number,
  previous: number | undefined,
): Delta | null {
  const percent = percentChange(current, previous);
  if (percent === null) return null;
  const improved = LOWER_IS_BETTER.has(metric) ? percent < 0 : percent > 0;
  return { percent, good: improved };
}

export interface RunDeltas {
  rows: Delta | null;
  duration: Delta | null;
  successRate: Delta | null;
  tables: Delta | null;
}

const successRateOf = (run: MigrationResult): number =>
  run.totalRows > 0 ? (run.totalSuccess / run.totalRows) * 100 : 0;

/**
 * Deltas for the stat row, comparing the most recent run with the one before.
 *
 * `results[0]` is the newest — migrationResultsSlice unshifts. Fewer than two
 * runs means every delta is null and no badge is rendered.
 */
export function runDeltas(results: MigrationResult[]): RunDeltas {
  const current = results[0];
  const previous = results[1];
  if (!current || !previous) {
    return { rows: null, duration: null, successRate: null, tables: null };
  }
  return {
    rows: computeDelta('rows', current.totalSuccess, previous.totalSuccess),
    duration: computeDelta('duration', current.duration, previous.duration),
    successRate: computeDelta('successRate', successRateOf(current), successRateOf(previous)),
    tables: computeDelta('tables', current.successTables, previous.successTables),
  };
}

/** "+8.2%" / "-5.0%", or null when there is no delta to show. */
export function formatDelta(delta: Delta | null): string | null {
  if (!delta) return null;
  const sign = delta.percent > 0 ? '+' : '';
  return `${sign}${delta.percent.toFixed(1)}%`;
}
