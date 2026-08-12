/**
 * React binding for the batch-pulse rule in batchPulse.ts.
 *
 * Two jobs, both about honesty and cost:
 *
 *  - Feed every progress event through the pure reducer, so a dot appears only
 *    when rows actually moved.
 *  - Coalesce with requestAnimationFrame. The server emits one socket event per
 *    batch with no throttle (see setProgressCallback in
 *    scripts/migration/api/server.ts), which on a fast table is hundreds of
 *    events a second. Rendering each one would melt the tab. Coalescing here
 *    keeps every event's DATA — the reducer still sees all of them — while
 *    capping renders at one per frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initialPulseState,
  reducePulse,
  retirePulse,
  type BatchPulse,
  type PulseState,
} from './batchPulse';

export interface BatchPulseInput {
  processedRows: number;
  currentTable: string;
  batchRows?: number | null;
  batchIndex?: number | null;
  jobId?: string | null;
  /** No pulses are produced while this is false. */
  active: boolean;
}

/** Stable reference, so an idle pipeline does not re-render on every parent tick. */
const NO_PULSES: BatchPulse[] = [];

export interface BatchPulseFeed {
  pulses: BatchPulse[];
  /** Call when a dot's CSS animation ends, so it stops being rendered. */
  retire: (id: number) => void;
}

export function useBatchPulse(input: BatchPulseInput): BatchPulseFeed {
  const stateRef = useRef<PulseState>(initialPulseState());
  const jobIdRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const [pulses, setPulses] = useState<BatchPulse[]>([]);

  // One render per frame at most, no matter how many events arrive.
  const scheduleFlush = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setPulses(stateRef.current.pulses);
    });
  };

  const { processedRows, currentTable, batchRows, batchIndex, jobId, active } = input;

  useEffect(() => {
    if (!active) return;
    stateRef.current = reducePulse(
      stateRef.current,
      { processedRows, currentTable, batchRows, batchIndex, jobId },
      jobIdRef.current,
    );
    jobIdRef.current = jobId ?? jobIdRef.current;
    scheduleFlush();
  }, [processedRows, currentTable, batchRows, batchIndex, jobId, active]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const retire = useCallback((id: number) => {
    const next = retirePulse(stateRef.current, id);
    // retirePulse returns the same object for an unknown id, so an animation
    // that ends twice does not cause a render.
    if (next === stateRef.current) return;
    stateRef.current = next;
    setPulses(next.pulses);
  }, []);

  // A finished or cancelled run must not leave data apparently in flight.
  // Derived rather than cleared in an effect: an effect that calls setState
  // synchronously causes a cascading render, and this needs no state at all.
  return { pulses: active ? pulses : NO_PULSES, retire };
}
