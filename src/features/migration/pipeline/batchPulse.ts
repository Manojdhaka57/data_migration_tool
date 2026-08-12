/**
 * Turning real batch events into animation, without inventing any.
 *
 * The rule this file exists to enforce: **a dot exists because a batch
 * happened**. Nothing here runs on a timer. If the worker stops sending
 * progress, no new pulses are produced and the pipeline visibly stalls — which
 * is information, not a glitch.
 *
 * The pure reducer lives here, separate from the React hook, so the rule can be
 * tested without rendering anything.
 */

export interface BatchPulse {
  /** Monotonic id — the animation key. */
  id: number;
  /** Rows this batch actually carried. Drives dot size. */
  rows: number;
  /** Target table the batch was written to. */
  table: string;
  /** Batch number within its table, when the backend reported one. */
  batchIndex: number | null;
}

export interface PulseState {
  pulses: BatchPulse[];
  /** processedRows at the last accepted event, to detect an increase. */
  lastProcessedRows: number;
  nextId: number;
}

/** Dots on screen at once. Beyond this the display is noise, not information. */
export const MAX_PULSES = 8;

export function initialPulseState(): PulseState {
  return { pulses: [], lastProcessedRows: 0, nextId: 1 };
}

export interface ProgressEvent {
  processedRows: number;
  currentTable: string;
  batchRows?: number | null;
  batchIndex?: number | null;
  /** Changes when a new migration starts; resets the baseline. */
  jobId?: string | null;
}

/**
 * Fold one progress event into the pulse queue.
 *
 * A pulse is emitted only when `processedRows` has actually GONE UP. That is
 * the whole guarantee:
 *
 *  - repeated or out-of-order events with the same count produce nothing;
 *  - a new job (processedRows back to a lower number) re-baselines instead of
 *    emitting one enormous pulse, which is what a naive delta would do;
 *  - `batchRows` from the backend is preferred for the size, falling back to
 *    the observed delta when an older server does not send it.
 */
export function reducePulse(state: PulseState, event: ProgressEvent, previousJobId?: string | null): PulseState {
  const jobChanged = event.jobId != null && previousJobId != null && event.jobId !== previousJobId;

  // A different job, or a counter that went backwards, means the run restarted.
  // Re-baseline silently: the difference is not rows that moved.
  if (jobChanged || event.processedRows < state.lastProcessedRows) {
    return { pulses: [], lastProcessedRows: event.processedRows, nextId: state.nextId };
  }

  const delta = event.processedRows - state.lastProcessedRows;
  if (delta <= 0) return state;

  const pulse: BatchPulse = {
    id: state.nextId,
    rows: event.batchRows && event.batchRows > 0 ? event.batchRows : delta,
    table: event.currentTable,
    batchIndex: event.batchIndex ?? null,
  };

  return {
    pulses: [...state.pulses, pulse].slice(-MAX_PULSES),
    lastProcessedRows: event.processedRows,
    nextId: state.nextId + 1,
  };
}

/** Drop a pulse once its dot has finished travelling. */
export function retirePulse(state: PulseState, id: number): PulseState {
  const remaining = state.pulses.filter((p) => p.id !== id);
  if (remaining.length === state.pulses.length) return state;
  return { ...state, pulses: remaining };
}

/**
 * Dot diameter for a batch, in pixels.
 *
 * Scaled against the configured batch size so a full batch and a short trailing
 * batch are visibly different. Clamped so a tiny batch stays visible and a
 * misreported one cannot blow up the layout.
 */
export function pulseSize(rows: number, batchSize: number | null | undefined): number {
  const reference = batchSize && batchSize > 0 ? batchSize : 1000;
  const ratio = Math.min(1, Math.max(0.15, rows / reference));
  return Math.round(5 + ratio * 6);
}
