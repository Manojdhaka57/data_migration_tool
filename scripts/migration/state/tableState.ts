/**
 * Redis-backed reliability layer for the migration pipeline.
 *
 *  - Durable per-table "done" markers so re-runs skip tables already transferred
 *    (the table-wise lock requirement). No TTL — this is the source of truth for
 *    "I already moved this table".
 *  - A concurrency lock per table so two workers never load the same table at
 *    once (SET NX PX + compare-and-delete via Lua).
 *  - Explicit progress counters (rows processed) the UI/API can read directly,
 *    complementing BullMQ's internal job.updateProgress.
 *
 * Everything reuses the single ioredis client already created in queue.ts.
 */
import { redisConnection } from '../queue/queue';

const NS = 'etl';

export type TableDoneStatus = 'done' | 'partial' | 'failed';

export interface TableStateRecord {
  status: TableDoneStatus;
  rows: number;
  lastMigratedId: any;
  updatedAt: string;
  jobId?: string;
}

export interface DbScope {
  sourceDb: string;
  targetDb: string;
}

export interface JobProgress {
  totalRows: number;
  processedRows: number;
  failedRows: number;
  skippedRows: number;
  perTable: Record<string, number>;
  percent: number;
}

const PROGRESS_TTL_SEC = 60 * 60 * 24 * 3; // 3 days — progress is ephemeral
export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000; // 5 min, renewed for long tables

function statusKey(scope: DbScope, table: string): string {
  return `${NS}:status:${scope.sourceDb}:${scope.targetDb}:${table}`;
}
function lockKey(scope: DbScope, table: string): string {
  return `${NS}:lock:${scope.sourceDb}:${scope.targetDb}:${table}`;
}
function progressKey(jobId: string): string {
  return `${NS}:progress:${jobId}`;
}

// ---------------------------------------------------------------------------
// Durable done-marker API
// ---------------------------------------------------------------------------

export async function getTableStatus(scope: DbScope, table: string): Promise<TableStateRecord | null> {
  const raw = await redisConnection.get(statusKey(scope, table));
  return raw ? (JSON.parse(raw) as TableStateRecord) : null;
}

export async function isTableDone(scope: DbScope, table: string): Promise<boolean> {
  const rec = await getTableStatus(scope, table);
  return rec?.status === 'done';
}

export async function markTableDone(
  scope: DbScope,
  table: string,
  rows: number,
  lastMigratedId: any,
  jobId?: string
): Promise<void> {
  const rec: TableStateRecord = {
    status: 'done',
    rows,
    lastMigratedId,
    updatedAt: new Date().toISOString(),
    jobId,
  };
  await redisConnection.set(statusKey(scope, table), JSON.stringify(rec));
}

export async function markTablePartial(
  scope: DbScope,
  table: string,
  status: 'partial' | 'failed',
  rows: number,
  lastMigratedId: any,
  jobId?: string
): Promise<void> {
  const rec: TableStateRecord = {
    status,
    rows,
    lastMigratedId,
    updatedAt: new Date().toISOString(),
    jobId,
  };
  await redisConnection.set(statusKey(scope, table), JSON.stringify(rec));
}

export async function listTableStatuses(scope: DbScope): Promise<Record<string, TableStateRecord>> {
  const out: Record<string, TableStateRecord> = {};
  const prefix = `${NS}:status:${scope.sourceDb}:${scope.targetDb}:`;
  const pattern = `${prefix}*`;
  let cursor = '0';
  do {
    const [next, keys] = await redisConnection.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (keys.length) {
      const vals = await redisConnection.mget(...keys);
      keys.forEach((key, i) => {
        const table = key.substring(prefix.length);
        if (vals[i]) out[table] = JSON.parse(vals[i] as string);
      });
    }
  } while (cursor !== '0');
  return out;
}

export async function resetTableStatus(scope: DbScope, table?: string): Promise<number> {
  if (table) {
    return await redisConnection.del(statusKey(scope, table));
  }
  let cursor = '0';
  let deleted = 0;
  const pattern = `${NS}:status:${scope.sourceDb}:${scope.targetDb}:*`;
  do {
    const [next, keys] = await redisConnection.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (keys.length) deleted += await redisConnection.del(...keys);
  } while (cursor !== '0');
  return deleted;
}

// ---------------------------------------------------------------------------
// Concurrency lock API (SET NX PX + compare-and-delete Lua)
// ---------------------------------------------------------------------------

const UNLOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

const RENEW_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end`;

export async function acquireTableLock(
  scope: DbScope,
  table: string,
  owner: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS
): Promise<boolean> {
  const res = await redisConnection.set(lockKey(scope, table), owner, 'PX', ttlMs, 'NX');
  return res === 'OK';
}

export async function releaseTableLock(scope: DbScope, table: string, owner: string): Promise<boolean> {
  const r = await redisConnection.eval(UNLOCK_LUA, 1, lockKey(scope, table), owner);
  return r === 1;
}

export async function renewTableLock(
  scope: DbScope,
  table: string,
  owner: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS
): Promise<boolean> {
  const r = await redisConnection.eval(RENEW_LUA, 1, lockKey(scope, table), owner, String(ttlMs));
  return r === 1;
}

// ---------------------------------------------------------------------------
// Progress-counter API (the explicit "rows processed" indicator)
// ---------------------------------------------------------------------------

export async function initJobProgress(jobId: string, totalRows: number): Promise<void> {
  const k = progressKey(jobId);
  await redisConnection
    .multi()
    .set(`${k}:totalRows`, String(totalRows), 'EX', PROGRESS_TTL_SEC)
    .set(`${k}:processedRows`, '0', 'EX', PROGRESS_TTL_SEC)
    .set(`${k}:failedRows`, '0', 'EX', PROGRESS_TTL_SEC)
    .set(`${k}:skippedRows`, '0', 'EX', PROGRESS_TTL_SEC)
    .exec();
}

export async function addJobTotalRows(jobId: string, rows: number): Promise<void> {
  if (!rows) return;
  const k = progressKey(jobId);
  await redisConnection.incrby(`${k}:totalRows`, rows);
  await redisConnection.expire(`${k}:totalRows`, PROGRESS_TTL_SEC);
}

export async function incrJobProgress(
  jobId: string,
  table: string,
  processed: number,
  failed = 0,
  skipped = 0
): Promise<void> {
  const k = progressKey(jobId);
  const m = redisConnection.multi();
  if (processed) {
    m.incrby(`${k}:processedRows`, processed);
    m.incrby(`${k}:table:${table}`, processed);
    m.expire(`${k}:table:${table}`, PROGRESS_TTL_SEC);
  }
  if (failed) m.incrby(`${k}:failedRows`, failed);
  if (skipped) m.incrby(`${k}:skippedRows`, skipped);
  m.expire(`${k}:processedRows`, PROGRESS_TTL_SEC);
  await m.exec();
}

export async function getJobProgress(jobId: string): Promise<JobProgress> {
  const k = progressKey(jobId);
  const [total, processed, failed, skipped] = await redisConnection.mget(
    `${k}:totalRows`,
    `${k}:processedRows`,
    `${k}:failedRows`,
    `${k}:skippedRows`
  );

  const perTable: Record<string, number> = {};
  const tablePrefix = `${k}:table:`;
  const pattern = `${tablePrefix}*`;
  let cursor = '0';
  do {
    const [next, keys] = await redisConnection.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (keys.length) {
      const vals = await redisConnection.mget(...keys);
      keys.forEach((key, i) => {
        perTable[key.substring(tablePrefix.length)] = parseInt(vals[i] || '0', 10);
      });
    }
  } while (cursor !== '0');

  const totalRows = parseInt(total || '0', 10);
  const processedRows = parseInt(processed || '0', 10);
  return {
    totalRows,
    processedRows,
    failedRows: parseInt(failed || '0', 10),
    skippedRows: parseInt(skipped || '0', 10),
    perTable,
    percent: totalRows > 0 ? Math.min(100, Math.round((processedRows / totalRows) * 100)) : 0,
  };
}
