import { describe, it, expect } from 'vitest';
import { percentChange, computeDelta, runDeltas, formatDelta } from './runDelta';
import type { MigrationResult } from './migrationResultsSlice';

const run = (over: Partial<MigrationResult>): MigrationResult => ({
  timestamp: '2026-08-12T10:00:00.000Z',
  duration: 60_000,
  totalTables: 10,
  successTables: 10,
  failedTables: 0,
  totalRows: 1000,
  totalSuccess: 1000,
  totalFailed: 0,
  results: [],
  dryRun: false,
  ...over,
});

describe('percentChange', () => {
  it('returns null with no previous value — a first run has no trend', () => {
    expect(percentChange(1000, undefined)).toBeNull();
  });

  it('returns null when the previous value was zero', () => {
    // Growth from zero is an infinite percentage, which tells the user nothing.
    expect(percentChange(1000, 0)).toBeNull();
  });

  it('computes a rise and a fall', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(90, 100)).toBeCloseTo(-10);
  });

  it('returns zero for an unchanged value', () => {
    expect(percentChange(100, 100)).toBe(0);
  });
});

describe('computeDelta direction', () => {
  it('treats more rows as an improvement', () => {
    expect(computeDelta('rows', 1100, 1000)?.good).toBe(true);
    expect(computeDelta('rows', 900, 1000)?.good).toBe(false);
  });

  it('treats a SHORTER duration as an improvement', () => {
    // The direction matters: a faster run is -20%, and that is good news.
    expect(computeDelta('duration', 80, 100)?.good).toBe(true);
    expect(computeDelta('duration', 120, 100)?.percent).toBeCloseTo(20);
    expect(computeDelta('duration', 120, 100)?.good).toBe(false);
  });

  it('treats fewer failed rows as an improvement', () => {
    expect(computeDelta('failedRows', 5, 10)?.good).toBe(true);
  });
});

describe('runDeltas', () => {
  it('gives every delta as null when there is only one run', () => {
    expect(runDeltas([run({})])).toEqual({
      rows: null,
      duration: null,
      successRate: null,
      tables: null,
    });
  });

  it('gives every delta as null when there are no runs at all', () => {
    expect(runDeltas([])).toEqual({ rows: null, duration: null, successRate: null, tables: null });
  });

  it('compares the newest run against the one before it', () => {
    // migrationResultsSlice unshifts, so index 0 is the most recent.
    const deltas = runDeltas([
      run({ totalSuccess: 1200, duration: 50_000, successTables: 12 }),
      run({ totalSuccess: 1000, duration: 100_000, successTables: 10 }),
    ]);
    expect(deltas.rows?.percent).toBeCloseTo(20);
    expect(deltas.rows?.good).toBe(true);
    expect(deltas.duration?.percent).toBeCloseTo(-50);
    expect(deltas.duration?.good).toBe(true);
    expect(deltas.tables?.percent).toBeCloseTo(20);
  });

  it('reports a worse success rate as a decline', () => {
    const deltas = runDeltas([
      run({ totalRows: 1000, totalSuccess: 900 }),
      run({ totalRows: 1000, totalSuccess: 1000 }),
    ]);
    expect(deltas.successRate?.percent).toBeCloseTo(-10);
    expect(deltas.successRate?.good).toBe(false);
  });

  it('yields null rather than dividing by a zero-row previous run', () => {
    const deltas = runDeltas([run({ totalRows: 100, totalSuccess: 100 }), run({ totalRows: 0, totalSuccess: 0 })]);
    expect(deltas.successRate).toBeNull();
    expect(deltas.rows).toBeNull();
  });
});

describe('formatDelta', () => {
  it('returns null when there is no delta, so no badge renders', () => {
    expect(formatDelta(null)).toBeNull();
  });

  it('signs a rise and leaves the minus on a fall', () => {
    expect(formatDelta({ percent: 8.24, good: true })).toBe('+8.2%');
    expect(formatDelta({ percent: -5, good: false })).toBe('-5.0%');
  });
});
