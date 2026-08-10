/**
 * Best-effort recording of run history from the migration worker.
 *
 * Every function here swallows its own errors. Run history is valuable, but a
 * metadata-database hiccup must never fail a migration that is otherwise
 * succeeding — the data movement is the product, the history is the paperwork.
 *
 * All calls are no-ops when the job has no runId (the legacy path, where a
 * mapping config is posted directly and nothing is persisted) or when APP_DB_*
 * is not configured at all.
 */
import { isAppDbConfigured } from './db';
import {
  markRunStarted,
  completeRun,
  upsertRunTable,
  saveCheckpoint,
  RunStatus,
  RunTableInput,
} from './repositories/runs';

function enabled(runId?: number): runId is number {
  return typeof runId === 'number' && isAppDbConfigured();
}

function warn(action: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`⚠️ Could not record ${action} in the metadata database: ${message}`);
}

export async function recordRunStarted(runId: number | undefined, jobId: string): Promise<void> {
  if (!enabled(runId)) return;
  try {
    await markRunStarted(runId, jobId);
  } catch (err) {
    warn('run start', err);
  }
}

export async function recordTableResult(
  runId: number | undefined,
  input: RunTableInput,
): Promise<void> {
  if (!enabled(runId)) return;
  try {
    await upsertRunTable(runId, input);
  } catch (err) {
    warn(`table result for ${input.targetTable}`, err);
  }
}

export async function recordCheckpoint(
  runId: number | undefined,
  targetTable: string,
  lastMigratedId: unknown,
  rowsDone: number,
  status: string,
): Promise<void> {
  if (!enabled(runId)) return;
  try {
    await saveCheckpoint(runId, targetTable, lastMigratedId, rowsDone, status);
  } catch (err) {
    warn(`checkpoint for ${targetTable}`, err);
  }
}

export async function recordRunFinished(
  runId: number | undefined,
  input: {
    status: RunStatus;
    successCount?: number;
    failedCount?: number;
    skippedCount?: number;
    sourceRowCount?: number;
    targetRowCount?: number;
    errorMessage?: string | null;
  },
): Promise<void> {
  if (!enabled(runId)) return;
  try {
    await completeRun(runId, input);
  } catch (err) {
    warn('run completion', err);
  }
}

/**
 * Map per-table outcomes onto the run status vocabulary from the spec.
 * A run is only COMPLETED when every table succeeded — anything less is
 * PARTIALLY_COMPLETED, so "finished" is never confused with "all data moved".
 */
export function deriveRunStatus(
  tableStatuses: string[],
  hadError: boolean,
): RunStatus {
  if (hadError) return 'FAILED';
  if (tableStatuses.length === 0) return 'COMPLETED';

  const anyFailed = tableStatuses.includes('failed');
  const allGood = tableStatuses.every(s => s === 'success' || s === 'skipped');

  if (allGood) return 'COMPLETED';
  if (anyFailed && tableStatuses.every(s => s === 'failed')) return 'FAILED';
  return 'PARTIALLY_COMPLETED';
}
