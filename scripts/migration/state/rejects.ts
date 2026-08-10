/**
 * Durable capture of rows the target refused.
 *
 * Replaces the previous `failed-row-retries` BullMQ queue, which was write-only
 * (no worker ever consumed it) and pushed `rows.slice(0, 50)` — the first rows of
 * the batch rather than the rows that actually failed. Nothing could be
 * recovered from it.
 *
 * Rejects are appended as NDJSON so a run can be inspected while it is still in
 * progress and a large failure set never has to be held in memory. Real
 * re-drive belongs with the migration_run_error table in the configuration
 * phase; this makes sure the data to re-drive from is not lost in the meantime.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FailedRowDetail } from '../adapters/db.interface';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** scripts/output/rejects — already gitignored, so no new infrastructure. */
const REJECTS_ROOT = path.resolve(__dirname, '../../output/rejects');

export function rejectFilePath(jobId: string, table: string): string {
  // Job ids and table names reach the filesystem, so strip anything that could
  // escape the directory.
  const safeJob = String(jobId).replace(/[^A-Za-z0-9_.-]/g, '_');
  const safeTable = String(table).replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(REJECTS_ROOT, safeJob, `${safeTable}.ndjson`);
}

/**
 * Append rejected rows for a table. Never throws — losing the migration because
 * the reject log could not be written would be a worse failure than the one
 * being recorded.
 */
export function appendRejects(
  jobId: string,
  table: string,
  sourceTable: string,
  details: FailedRowDetail[],
): void {
  if (!details.length) return;

  try {
    const file = rejectFilePath(jobId, table);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = details
      .map(d => JSON.stringify({ jobId, table, sourceTable, ...d }))
      .join('\n');
    fs.appendFileSync(file, lines + '\n', 'utf8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ Could not write rejects for ${table}: ${message}`);
  }
}
