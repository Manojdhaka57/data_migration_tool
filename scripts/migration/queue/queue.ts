import { Queue, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as dotenv from 'dotenv';
import { TableMapping } from '../types';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

export const redisConnection = new IORedis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null, // Required by BullMQ
});

// Main migration execution queue
export const migrationQueue = new Queue('migration-execution', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3, // Retry failed jobs up to 3 times
    backoff: {
      type: 'exponential',
      delay: 5000, // Wait 5s, then 10s, then 20s...
    },
    removeOnComplete: false, // Keep completed jobs to show history
    removeOnFail: false,
  },
});

// NOTE: a 'failed-row-retries' dead-letter queue used to be declared here. No
// Worker was ever created for it, so nothing drained it, and the producer
// enqueued the first 50 rows of a failing batch rather than the rows that
// actually failed — so even a consumer could not have recovered anything.
// Rejected rows are now written to scripts/output/rejects/<jobId>/<table>.ndjson
// with their primary key and offending column (see state/rejects.ts). Automated
// re-drive belongs with the migration_run_error table in the configuration
// phase, where a retry can be scoped to a specific run.

export const migrationEvents = new QueueEvents('migration-execution', {
  connection: redisConnection,
});

export interface MigrationJobData {
  jobId: string;
  sourceDbType: 'mysql' | 'postgresql';
  targetDbType: 'mysql' | 'postgresql';
  tableMappings: TableMapping[];
  dryRun: boolean;
  tableWiseMode: boolean;
  selectedTables?: string[];
  customDependencies?: Array<{ from: string; to: string }>;
  batchSize?: number;
  useCopy?: boolean;
  /** When true, ignore durable "done" markers and re-migrate selected tables. */
  force?: boolean;
  /** Passphrase used to AES-256 encrypt columns flagged `encrypt`. */
  encryptionKey?: string;
}

/**
 * Add a migration run to the execution queue
 */
export async function addMigrationJob(data: MigrationJobData): Promise<Job<MigrationJobData>> {
  return await migrationQueue.add(`migration-run-${data.jobId}`, data, {
    jobId: data.jobId,
  });
}

/**
 * Get the status of all active and completed jobs
 */
export async function getMigrationJobsStatus(): Promise<any[]> {
  const jobs = await migrationQueue.getJobs([
    'active',
    'completed',
    'failed',
    'delayed',
    'waiting',
  ]);

  return Promise.all(
    jobs.map(async (job) => {
      const state = await job.getState();
      const progress = job.progress || 0;
      return {
        id: job.id,
        name: job.name,
        data: job.data,
        state,
        progress,
        failedReason: job.failedReason,
        timestamp: job.timestamp,
        finishedOn: job.finishedOn,
        processedRows: (job.progress as any)?.processedRows || 0,
        currentTable: (job.progress as any)?.currentTable || '',
        results: (job.progress as any)?.results || [],
      };
    })
  );
}

/**
 * Clean up old jobs from the queues
 */
export async function cleanMigrationQueues(): Promise<void> {
  await migrationQueue.clean(0, 100, 'completed');
  await migrationQueue.clean(0, 100, 'failed');
}
