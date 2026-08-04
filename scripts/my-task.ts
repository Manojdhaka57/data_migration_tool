/**
 * Starter script — connect to source/target and do something with them.
 *
 * Run:  npx tsx scripts/my-task.ts
 *
 * Reads SOURCE_DB_* / TARGET_DB_* from .env via the shared connection helpers,
 * so it works for MySQL or PostgreSQL on either side. No package.json entry needed.
 *
 * Replace the body of run() with whatever you need — the adapters expose:
 *   getTableNames(), getTables(), getSchema(), getTableStructure(name),
 *   getRowCount(name, where?, fromClause?), previewTable(name, limit?),
 *   streamTable(name, onBatch, opts?), insertBatch(...), createTable(...),
 *   getChecksum(...), disconnect()
 */
import { connectSource, connectTarget } from './migration/connection';
import { IDatabaseAdapter } from './migration/adapters/db.interface';

const log = {
  info: (m: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
  ok: (m: string) => console.log(`\x1b[32m[OK]\x1b[0m ${m}`),
  err: (m: string) => console.log(`\x1b[31m[ERR]\x1b[0m ${m}`),
};

async function run(source: IDatabaseAdapter, target: IDatabaseAdapter) {
  // ── Example 1: list tables on both sides ──────────────────────────────────
  const sourceTables = await source.getTableNames();
  const targetTables = await target.getTableNames();
  log.ok(`Source has ${sourceTables.length} tables, target has ${targetTables.length} tables.`);

  // ── Example 2: row count for a specific table (edit the name) ─────────────
  const table = sourceTables[0];
  if (table) {
    const count = await source.getRowCount(table);
    log.info(`Source "${table}" row count: ${count}`);

    // ── Example 3: preview the first few rows ───────────────────────────────
    const rows = await source.previewTable(table, 5);
    log.info(`First ${rows.length} row(s) of "${table}":`);
    console.table(rows);
  }

  // ── Tables in source but missing in target ────────────────────────────────
  const targetSet = new Set(targetTables);
  const missing = sourceTables.filter((t) => !targetSet.has(t));
  if (missing.length) {
    log.info(`Tables in source but not target (${missing.length}): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}`);
  }

  // 👉 PUT YOUR OWN LOGIC HERE (read from source, transform, write to target, …)
}

async function main() {
  let source: IDatabaseAdapter | null = null;
  let target: IDatabaseAdapter | null = null;
  try {
    log.info('Connecting…');
    source = await connectSource();
    target = await connectTarget();
    log.ok('Connected to source and target.');

    await run(source, target);
  } catch (err) {
    log.err(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    // Always close the pools so the process can exit.
    if (source) await source.disconnect().catch(() => {});
    if (target) await target.disconnect().catch(() => {});
    log.info('Disconnected.');
  }
}

main();
