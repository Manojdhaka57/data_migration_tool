/**
 * BullMQ worker process — no HTTP server.
 *
 * Deploy this as a Render Background Worker alongside the API service, with the
 * API started using RUN_WORKER_IN_PROCESS=false. Separating them means a web
 * service restart, redeploy or autoscale event cannot kill a migration that is
 * halfway through a table.
 *
 * Both processes share the same Redis, so the queue, progress counters and
 * durable table markers work exactly as they do in single-process mode. It also
 * needs the same database and encryption environment as the API, because the
 * worker is the process that actually reads and writes rows.
 *
 * Usage: npx tsx scripts/migration-worker.ts
 */
import * as dotenv from 'dotenv';
import { startWorkers, stopWorkers } from './migration/queue/worker';

dotenv.config();

const concurrency = Number(process.env.WORKER_CONCURRENCY) || 2;
startWorkers(concurrency);
console.log(`👷 Migration worker process started (concurrency ${concurrency})`);

// Render sends SIGTERM on deploy and shutdown. Draining rather than dying
// mid-batch is what lets a job resume cleanly instead of being retried blind.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} received — draining workers…`);
    void stopWorkers().finally(() => process.exit(0));
  });
}
