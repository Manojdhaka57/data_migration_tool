/**
 * Reusable source/target DB connections for standalone scripts.
 *
 * Import these in any one-off script and run it directly with `npx tsx <file>` —
 * no need to add an entry to package.json "scripts". Reads the SOURCE_DB_* /
 * TARGET_DB_* (and SOURCE_DB_TYPE / TARGET_DB_TYPE) variables from .env, builds the
 * right adapter (MySQL or PostgreSQL), and connects.
 *
 * Example:
 *   // scripts/my-task.ts
 *   import { connectSource, connectTarget } from './migration/connection';
 *
 *   async function main() {
 *     const source = await connectSource();
 *     const target = await connectTarget();
 *     try {
 *       const rows = await source.previewTable('users', 10);
 *       console.log(rows);
 *     } finally {
 *       await source.disconnect();
 *       await target.disconnect();
 *     }
 *   }
 *   main();
 *
 *   Run with:  npx tsx scripts/my-task.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { IDatabaseAdapter } from './adapters/db.interface';
import { createAdapter, resolveDbType } from './adapters/factory';

/** Build the SOURCE adapter (not yet connected). Reads SOURCE_DB_* env. */
export function getSourceAdapter(): IDatabaseAdapter {
  return createAdapter(resolveDbType('source'), 'source');
}

/** Build the TARGET adapter (not yet connected). Reads TARGET_DB_* env. */
export function getTargetAdapter(): IDatabaseAdapter {
  return createAdapter(resolveDbType('target'), 'target');
}

/**
 * Build AND connect the SOURCE adapter. The caller owns the connection and must
 * call `.disconnect()` when done.
 */
export async function connectSource(): Promise<IDatabaseAdapter> {
  const adapter = getSourceAdapter();
  await adapter.connect();
  return adapter;
}

/**
 * Build AND connect the TARGET adapter. The caller owns the connection and must
 * call `.disconnect()` when done.
 */
export async function connectTarget(): Promise<IDatabaseAdapter> {
  const adapter = getTargetAdapter();
  await adapter.connect();
  return adapter;
}

/**
 * Convenience: connect both at once. Returns `{ source, target }` — remember to
 * disconnect both (e.g. in a finally block).
 */
export async function connectBoth(): Promise<{ source: IDatabaseAdapter; target: IDatabaseAdapter }> {
  const [source, target] = await Promise.all([connectSource(), connectTarget()]);
  return { source, target };
}
