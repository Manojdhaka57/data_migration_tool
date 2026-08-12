import { describe, it, expect } from 'vitest';
import {
  initialPulseState,
  reducePulse,
  retirePulse,
  pulseSize,
  MAX_PULSES,
  type PulseState,
} from './batchPulse';

const feed = (state: PulseState, processedRows: number, extra: Partial<Parameters<typeof reducePulse>[1]> = {}) =>
  reducePulse(state, { processedRows, currentTable: 'students', ...extra });

describe('reducePulse', () => {
  it('emits exactly one pulse per increase', () => {
    let state = initialPulseState();
    state = feed(state, 2000);
    state = feed(state, 4000);
    state = feed(state, 6000);
    expect(state.pulses).toHaveLength(3);
  });

  it('emits nothing when the counter has not moved', () => {
    // This is the guarantee that stops the animation running on its own: a
    // repeated event is not a batch.
    let state = feed(initialPulseState(), 2000);
    const before = state;
    state = feed(state, 2000);
    state = feed(state, 2000);
    expect(state).toBe(before);
    expect(state.pulses).toHaveLength(1);
  });

  it('ignores an out-of-order event that would go backwards within a job', () => {
    let state = feed(initialPulseState(), 4000);
    state = feed(state, 2000);
    // Re-baselined, not a pulse for -2000 rows.
    expect(state.pulses).toHaveLength(0);
    expect(state.lastProcessedRows).toBe(2000);
  });

  it('re-baselines on a new job instead of firing one huge pulse', () => {
    let state = initialPulseState();
    state = reducePulse(state, { processedRows: 900_000, currentTable: 'a', jobId: 'job_1' }, null);
    state = reducePulse(state, { processedRows: 1_000_000, currentTable: 'a', jobId: 'job_1' }, 'job_1');
    expect(state.pulses).toHaveLength(2);

    // A brand new run starts from a low count — the difference is not rows moved.
    state = reducePulse(state, { processedRows: 500, currentTable: 'a', jobId: 'job_2' }, 'job_1');
    expect(state.pulses).toHaveLength(0);
    expect(state.lastProcessedRows).toBe(500);
  });

  it('prefers the backend batchRows over the observed delta', () => {
    // They differ whenever rows are skipped or rejected: processedRows counts
    // what landed, batchRows counts what the batch carried.
    const state = feed(initialPulseState(), 1800, { batchRows: 2000, batchIndex: 1 });
    expect(state.pulses[0].rows).toBe(2000);
    expect(state.pulses[0].batchIndex).toBe(1);
  });

  it('falls back to the delta when the server sends no batchRows', () => {
    const state = feed(initialPulseState(), 1800);
    expect(state.pulses[0].rows).toBe(1800);
    expect(state.pulses[0].batchIndex).toBeNull();
  });

  it('bounds the queue, keeping the most recent pulses', () => {
    let state = initialPulseState();
    for (let i = 1; i <= MAX_PULSES + 5; i++) state = feed(state, i * 1000);
    expect(state.pulses).toHaveLength(MAX_PULSES);
    // The oldest were dropped, so the first surviving id is not 1.
    expect(state.pulses[0].id).toBe(6);
    expect(state.pulses.at(-1)!.id).toBe(MAX_PULSES + 5);
  });

  it('gives every pulse a distinct id even after retirement', () => {
    let state = feed(initialPulseState(), 1000);
    state = retirePulse(state, state.pulses[0].id);
    state = feed(state, 2000);
    expect(state.pulses[0].id).toBe(2);
  });
});

describe('retirePulse', () => {
  it('removes the finished dot', () => {
    let state = feed(initialPulseState(), 1000);
    state = feed(state, 2000);
    state = retirePulse(state, state.pulses[0].id);
    expect(state.pulses).toHaveLength(1);
  });

  it('returns the same object for an unknown id, so React does not re-render', () => {
    const state = feed(initialPulseState(), 1000);
    expect(retirePulse(state, 999)).toBe(state);
  });
});

describe('pulseSize', () => {
  it('makes a full batch bigger than a short trailing batch', () => {
    expect(pulseSize(2000, 2000)).toBeGreaterThan(pulseSize(50, 2000));
  });

  it('clamps a tiny batch up to a visible size', () => {
    // Without the lower clamp a 1-row batch rounds to the base size and is
    // indistinguishable from nothing. The clamp is what makes it a dot.
    expect(pulseSize(1, 2000)).toBeGreaterThan(pulseSize(0, 2000) - 1);
    expect(pulseSize(1, 2000)).toBe(6);
  });

  it('clamps a batch larger than the configured size', () => {
    expect(pulseSize(999_999, 2000)).toBe(pulseSize(2000, 2000));
  });

  it('survives a missing batch size', () => {
    expect(pulseSize(500, null)).toBeGreaterThan(0);
    expect(pulseSize(500, 0)).toBeGreaterThan(0);
  });
});
