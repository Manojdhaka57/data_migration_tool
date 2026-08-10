/* eslint-disable @typescript-eslint/no-explicit-any --
 * Data access over node-postgres: row shapes come back untyped from the driver,
 * and configuration_json is arbitrary caller-supplied JSON by design.
 */
/**
 * Migration run history.
 *
 * Every run records the exact configuration_version_id it executed, which is
 * what makes a past migration auditable and reproducible. Per-table results and
 * checkpoints hang off the run.
 *
 * All writes here are best-effort from the worker's point of view: recording
 * history must never be able to fail a migration that is otherwise succeeding.
 */
import { appQuery, appQueryOne } from '../db';

export type RunStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'RUNNING'
  | 'PAUSED'
  | 'FAILED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'PARTIALLY_COMPLETED';

export interface RunRecord {
  id: number;
  configuration_id: number | null;
  configuration_version_id: number | null;
  job_id: string | null;
  status: RunStatus;
  dry_run: boolean;
  started_at: Date | null;
  completed_at: Date | null;
  source_row_count: string;
  target_row_count: string;
  success_count: string;
  failed_count: string;
  skipped_count: string;
  error_message: string | null;
  created_by: string | null;
  created_at: Date;
}

export async function createRun(input: {
  configurationId?: number | null;
  configurationVersionId?: number | null;
  jobId?: string | null;
  dryRun?: boolean;
  createdBy?: string | null;
}): Promise<RunRecord> {
  const rows = await appQuery<RunRecord>(
    `INSERT INTO migration_run
       (configuration_id, configuration_version_id, job_id, dry_run, status, created_by)
     VALUES ($1,$2,$3,$4,'CREATED',$5)
     RETURNING *`,
    [
      input.configurationId ?? null,
      input.configurationVersionId ?? null,
      input.jobId ?? null,
      input.dryRun ?? false,
      input.createdBy ?? 'system',
    ],
  );
  return rows[0];
}

export async function listRuns(limit = 50, configurationId?: number): Promise<RunRecord[]> {
  if (configurationId) {
    return appQuery<RunRecord>(
      'SELECT * FROM migration_run WHERE configuration_id = $1 ORDER BY created_at DESC LIMIT $2',
      [configurationId, limit],
    );
  }
  return appQuery<RunRecord>('SELECT * FROM migration_run ORDER BY created_at DESC LIMIT $1', [limit]);
}

export async function getRun(id: number): Promise<RunRecord | null> {
  return appQueryOne<RunRecord>('SELECT * FROM migration_run WHERE id = $1', [id]);
}

export async function getRunByJobId(jobId: string): Promise<RunRecord | null> {
  return appQueryOne<RunRecord>(
    'SELECT * FROM migration_run WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1',
    [jobId],
  );
}

export async function markRunStarted(runId: number, jobId?: string | null): Promise<void> {
  await appQuery(
    `UPDATE migration_run
        SET status = 'RUNNING', started_at = COALESCE(started_at, now()),
            job_id = COALESCE($2, job_id)
      WHERE id = $1`,
    [runId, jobId ?? null],
  );
}

export async function updateRunStatus(
  runId: number,
  status: RunStatus,
  errorMessage?: string | null,
): Promise<void> {
  await appQuery('UPDATE migration_run SET status = $2, error_message = COALESCE($3, error_message) WHERE id = $1', [
    runId,
    status,
    errorMessage ?? null,
  ]);
}

export async function completeRun(
  runId: number,
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
  await appQuery(
    `UPDATE migration_run
        SET status = $2,
            completed_at = now(),
            success_count = $3,
            failed_count = $4,
            skipped_count = $5,
            source_row_count = $6,
            target_row_count = $7,
            error_message = $8
      WHERE id = $1`,
    [
      runId,
      input.status,
      input.successCount ?? 0,
      input.failedCount ?? 0,
      input.skippedCount ?? 0,
      input.sourceRowCount ?? 0,
      input.targetRowCount ?? 0,
      input.errorMessage ?? null,
    ],
  );
}

export interface RunTableInput {
  sourceTable?: string | null;
  targetTable: string;
  status: string;
  totalRows?: number;
  successRows?: number;
  failedRows?: number;
  skippedRows?: number;
  durationMs?: number;
  validationStatus?: string | null;
  errors?: string[];
  level?: number | null;
}

/** Insert or update the per-table result for a run. */
export async function upsertRunTable(runId: number, input: RunTableInput): Promise<void> {
  await appQuery(
    `INSERT INTO migration_run_table
       (run_id, source_table, target_table, status, total_rows, success_rows,
        failed_rows, skipped_rows, duration_ms, validation_status, errors, level, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (run_id, target_table) DO UPDATE SET
       status = EXCLUDED.status,
       total_rows = EXCLUDED.total_rows,
       success_rows = EXCLUDED.success_rows,
       failed_rows = EXCLUDED.failed_rows,
       skipped_rows = EXCLUDED.skipped_rows,
       duration_ms = EXCLUDED.duration_ms,
       validation_status = EXCLUDED.validation_status,
       errors = EXCLUDED.errors,
       level = EXCLUDED.level,
       updated_at = now()`,
    [
      runId,
      input.sourceTable ?? null,
      input.targetTable,
      input.status,
      input.totalRows ?? 0,
      input.successRows ?? 0,
      input.failedRows ?? 0,
      input.skippedRows ?? 0,
      input.durationMs ?? null,
      input.validationStatus ?? null,
      JSON.stringify(input.errors ?? []),
      input.level ?? null,
    ],
  );
}

export async function listRunTables(runId: number): Promise<any[]> {
  return appQuery('SELECT * FROM migration_run_table WHERE run_id = $1 ORDER BY level, target_table', [
    runId,
  ]);
}

/**
 * Mirror of the durable Redis cursor. Redis stays the hot path the worker reads
 * on resume; this copy survives a Redis flush and keeps checkpoints queryable
 * next to the rest of the run history.
 */
export async function saveCheckpoint(
  runId: number,
  targetTable: string,
  lastMigratedId: unknown,
  rowsDone: number,
  status: string,
): Promise<void> {
  await appQuery(
    `INSERT INTO migration_checkpoint (run_id, target_table, last_migrated_id, rows_done, status, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (run_id, target_table) DO UPDATE SET
       last_migrated_id = EXCLUDED.last_migrated_id,
       rows_done = EXCLUDED.rows_done,
       status = EXCLUDED.status,
       updated_at = now()`,
    [runId, targetTable, lastMigratedId == null ? null : String(lastMigratedId), rowsDone, status],
  );
}

export async function listCheckpoints(runId: number): Promise<any[]> {
  return appQuery('SELECT * FROM migration_checkpoint WHERE run_id = $1 ORDER BY target_table', [runId]);
}
