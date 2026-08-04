/**
 * Standalone data sync: copy rows from the SOURCE database into the TARGET database,
 * inserting new rows and UPDATING existing ones (upsert) — i.e. it runs both
 * INSERT and UPDATE (SET ...) queries per table.
 *
 *   - SOURCE read:   SELECT <cols> FROM <table>           (paged by LIMIT/OFFSET)
 *   - TARGET write:  Postgres → INSERT ... ON CONFLICT (<key>) DO UPDATE SET ...
 *                    MySQL    → INSERT ... ON DUPLICATE KEY UPDATE ...
 *
 * Connection details come from .env (SOURCE_DB_* / TARGET_DB_*), same vars the app uses.
 * Dialect is taken from SOURCE_DB_TYPE / TARGET_DB_TYPE ('mysql' | 'postgresql').
 *
 * Usage:
 *   npx tsx scripts/sync-data.ts            # sync every table in TABLES below
 *   npx tsx scripts/sync-data.ts students   # sync only the table(s) whose source matches "students"
 *   npx tsx scripts/sync-data.ts --dry-run  # read + build queries, but don't write
 *
 * Edit the TABLES config below: each entry is one source→target table copy.
 */

import { Pool as PgPool } from 'pg';
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — edit this for your tables.
//   sourceTable / targetTable : table names (defaults targetTable = sourceTable)
//   columns                   : columns to copy; omit/empty = auto-detect from source
//                               (assumes the target has the same column names)
//   keyColumns                : column(s) that decide "row already exists" → UPDATE
//                               instead of INSERT. Must be a PRIMARY KEY / UNIQUE
//                               constraint on the TARGET table.
// ─────────────────────────────────────────────────────────────────────────────
interface TableSync {
  sourceTable: string;
  targetTable?: string;
  columns?: string[];
  keyColumns: string[];
}

const TABLES: TableSync[] = [
  // Example — replace with your own:
  { sourceTable: 'students', keyColumns: ['id'] },
  // { sourceTable: 'students_installments_mappings', targetTable: 'opportunity_fee_details',
  //   columns: ['id', 'student_id', 'fee_plan_id'], keyColumns: ['id'] },
];

const BATCH_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');
// Only user-supplied args (skip node + script path); first non-flag is the table filter.
const FILTER = process.argv.slice(2).find((a) => !a.startsWith('--'));

type Dialect = 'mysql' | 'postgresql';

const log = {
  info: (m: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
  ok: (m: string) => console.log(`\x1b[32m[OK]\x1b[0m ${m}`),
  warn: (m: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${m}`),
  err: (m: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${m}`),
};

function envFor(prefix: 'SOURCE' | 'TARGET') {
  const type = (process.env[`${prefix}_DB_TYPE`] || (prefix === 'SOURCE' ? 'mysql' : 'postgresql')) as Dialect;
  return {
    type,
    host: process.env[`${prefix}_DB_HOST`] || 'localhost',
    port: parseInt(process.env[`${prefix}_DB_PORT`] || (type === 'mysql' ? '3306' : '5432'), 10),
    database: process.env[`${prefix}_DB_NAME`] || '',
    user: process.env[`${prefix}_DB_USER`] || '',
    password: process.env[`${prefix}_DB_PASSWORD`] || '',
    ssl: process.env[`${prefix}_DB_SSL`] === 'false' ? false : true,
  };
}

/** Quote an identifier for the given dialect. */
function quoteId(name: string, dialect: Dialect): string {
  return dialect === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
}

// ── A tiny uniform DB handle over pg / mysql2 ────────────────────────────────
interface Db {
  dialect: Dialect;
  query(sql: string, params?: any[]): Promise<any[]>;
  end(): Promise<void>;
}

async function connect(prefix: 'SOURCE' | 'TARGET'): Promise<Db> {
  const cfg = envFor(prefix);
  log.info(`${prefix}: ${cfg.type} ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database} (ssl=${cfg.ssl})`);

  if (cfg.type === 'mysql') {
    const pool = mysql.createPool({
      host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user, password: cfg.password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      connectionLimit: 5, waitForConnections: true,
    });
    await pool.query('SELECT 1');
    return {
      dialect: 'mysql',
      async query(sql, params = []) { const [rows] = await pool.query(sql, params); return rows as any[]; },
      async end() { await pool.end(); },
    };
  }

  const pool = new PgPool({
    host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user, password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000, max: 5,
  });
  await pool.query('SELECT 1');
  return {
    dialect: 'postgresql',
    async query(sql, params = []) { const res = await pool.query(sql, params); return res.rows; },
    async end() { await pool.end(); },
  };
}

/** Auto-detect a source table's columns when none are configured. */
async function detectColumns(src: Db, table: string): Promise<string[]> {
  if (src.dialect === 'mysql') {
    const rows = await src.query(
      `SELECT COLUMN_NAME AS name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION`,
      [table]
    );
    return rows.map((r) => r.name);
  }
  const rows = await src.query(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.name);
}

/** Build the dialect-specific upsert (insert + update) for one batch of rows. */
function buildUpsert(
  target: Db, table: string, columns: string[], keyColumns: string[], rows: any[][]
): { sql: string; params: any[] } {
  const t = quoteId(table, target.dialect);
  const colList = columns.map((c) => quoteId(c, target.dialect)).join(', ');
  const updateCols = columns.filter((c) => !keyColumns.includes(c));

  if (target.dialect === 'postgresql') {
    const params: any[] = [];
    const valuesSql = rows.map((row) =>
      `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(', ')})`
    ).join(',\n  ');
    const conflict = keyColumns.map((c) => quoteId(c, 'postgresql')).join(', ');
    const setSql = (updateCols.length ? updateCols : columns)
      .map((c) => `${quoteId(c, 'postgresql')} = EXCLUDED.${quoteId(c, 'postgresql')}`).join(', ');
    // RETURNING (xmax = 0) lets us count inserts vs updates.
    const sql =
      `INSERT INTO ${t} (${colList})\nVALUES\n  ${valuesSql}\n` +
      `ON CONFLICT (${conflict}) DO UPDATE SET ${setSql}\n` +
      `RETURNING (xmax = 0) AS inserted`;
    return { sql, params };
  }

  // MySQL target
  const params: any[] = [];
  const valuesSql = rows.map((row) =>
    `(${row.map((v) => { params.push(v); return '?'; }).join(', ')})`
  ).join(',\n  ');
  const setSql = (updateCols.length ? updateCols : columns)
    .map((c) => `${quoteId(c, 'mysql')} = VALUES(${quoteId(c, 'mysql')})`).join(', ');
  const sql =
    `INSERT INTO ${t} (${colList})\nVALUES\n  ${valuesSql}\n` +
    `ON DUPLICATE KEY UPDATE ${setSql}`;
  return { sql, params };
}

async function syncTable(src: Db, tgt: Db, cfg: TableSync) {
  const sourceTable = cfg.sourceTable;
  const targetTable = cfg.targetTable || cfg.sourceTable;
  const columns = cfg.columns && cfg.columns.length ? cfg.columns : await detectColumns(src, sourceTable);

  if (columns.length === 0) { log.warn(`${sourceTable}: no columns found — skipping`); return; }
  if (!cfg.keyColumns?.length) { log.warn(`${sourceTable}: no keyColumns set — skipping`); return; }

  log.info(`\n▶ ${sourceTable} → ${targetTable}  [${columns.length} cols, key=(${cfg.keyColumns.join(', ')})]`);

  const colSelect = columns.map((c) => quoteId(c, src.dialect)).join(', ');
  const srcTbl = quoteId(sourceTable, src.dialect);

  let offset = 0, total = 0, inserted = 0, updated = 0, loggedSql = false;
  while (true) {
    const limitClause = src.dialect === 'mysql'
      ? `LIMIT ${BATCH_SIZE} OFFSET ${offset}`
      : `LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    const rows = await src.query(`SELECT ${colSelect} FROM ${srcTbl} ${limitClause}`);
    if (rows.length === 0) break;

    const values = rows.map((r) => columns.map((c) => r[c]));
    const { sql, params } = buildUpsert(tgt, targetTable, columns, cfg.keyColumns, values);

    if (!loggedSql) {
      // Show the generated INSERT/UPDATE query once so it's clear what runs.
      console.log(`\x1b[90m${sql.split('\nVALUES')[0]}\nVALUES ( … ${rows.length} row(s) … )${sql.includes('ON CONFLICT') ? sql.slice(sql.indexOf('\nON CONFLICT')) : sql.slice(sql.indexOf('\nON DUPLICATE'))}\x1b[0m`);
      loggedSql = true;
    }

    if (!DRY_RUN) {
      const result = await tgt.query(sql, params);
      if (tgt.dialect === 'postgresql') {
        const ins = result.filter((r) => r.inserted).length;
        inserted += ins; updated += result.length - ins;
      } else {
        inserted += rows.length; // MySQL doesn't easily split insert/update per row here
      }
    }
    total += rows.length;
    offset += BATCH_SIZE;
    process.stdout.write(`\r  ${total} rows processed…`);
  }
  process.stdout.write('\n');

  if (DRY_RUN) log.ok(`${targetTable}: DRY RUN — ${total} source rows read, nothing written`);
  else if (tgt.dialect === 'postgresql') log.ok(`${targetTable}: ${total} rows → ${inserted} inserted, ${updated} updated`);
  else log.ok(`${targetTable}: ${total} rows upserted`);
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(`Data sync: SOURCE → TARGET${DRY_RUN ? '  (DRY RUN)' : ''}`);
  console.log('='.repeat(60));

  let src: Db | null = null, tgt: Db | null = null;
  try {
    src = await connect('SOURCE');
    tgt = await connect('TARGET');

    const work = FILTER ? TABLES.filter((t) => t.sourceTable.includes(FILTER)) : TABLES;
    if (work.length === 0) { log.warn(`No tables to sync${FILTER ? ` matching "${FILTER}"` : ''}.`); return; }

    for (const cfg of work) {
      try {
        await syncTable(src, tgt, cfg);
      } catch (e) {
        log.err(`${cfg.sourceTable}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log('\n' + '='.repeat(60));
    log.ok('Done.');
  } catch (e) {
    log.err(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await src?.end().catch(() => {});
    await tgt?.end().catch(() => {});
  }
}

main();
