/**
 * Delta transfer — find (and optionally apply) ONLY the rows that are new or changed
 * in the target, given a mapping config.
 *
 * It reproduces exactly what the migration worker does (joined source query, row
 * filters, CUSTOM SQL transforms, TransformationEngine.transformRow) — but instead of
 * inserting every row, it looks each transformed row up in the target by its key and
 * keeps only:
 *   • NEW      — no row with that key exists in the target yet, and
 *   • CHANGED  — a row exists but at least one mapped column value differs.
 * UNCHANGED rows are skipped, so you transfer only what actually moved.
 *
 * Usage:
 *   npx tsx scripts/delta-transfer.ts                       # dry report (no writes)
 *   npx tsx scripts/delta-transfer.ts --config path.json    # use a different config
 *   npx tsx scripts/delta-transfer.ts --apply               # upsert new+changed to target
 *   npx tsx scripts/delta-transfer.ts --limit 5000          # only scan first N source rows
 *   npx tsx scripts/delta-transfer.ts --key id              # override the match key column
 *   npx tsx scripts/delta-transfer.ts --ignore updated_at   # ignore column(s) when comparing
 *   npx tsx scripts/delta-transfer.ts --out report.json     # where to write the delta report
 *
 * The config is the SAME JSON the UI produces (frontend mapping shape). Default config
 * path: scripts/delta.config.json.
 *
 * Reads SOURCE_DB_* / TARGET_DB_* (+ ENCRYPTION_KEY) from .env via the shared adapters.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { createAdapter, resolveDbType } from './migration/adapters/factory.js';
import { IDatabaseAdapter } from './migration/adapters/db.interface.js';
import { TransformationEngine } from './migration/transformation/engine.js';

type Dialect = 'mysql' | 'postgresql';

const log = {
  info: (m: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
  ok: (m: string) => console.log(`\x1b[32m[OK]\x1b[0m ${m}`),
  warn: (m: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${m}`),
  err: (m: string) => console.log(`\x1b[31m[ERR]\x1b[0m ${m}`),
};

// ── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}
/** Options that drive a delta run (used both by the CLI and by per-table modules). */
export interface DeltaOptions {
  apply?: boolean;          // upsert new+changed rows into the target (default false)
  limit?: number;           // only scan the first N source rows
  keyOverride?: string;     // force the match key column
  ignore?: string[];        // columns to ignore when comparing
  batch?: number;           // stream/insert batch size (default 1000)
  show?: number;            // how many new/changed rows to print (default 50)
  outDir?: string;          // directory for report files (default scripts/output)
  writeFiles?: boolean;     // write report files to disk (default true)
}

/** Build DeltaOptions from CLI flags, so `npx tsx <module>.ts --apply` works. */
export function parseCliOpts(argv: string[] = process.argv.slice(2)): DeltaOptions {
  const a = parseArgs(argv);
  return {
    apply: a.apply === true,
    limit: a.limit ? parseInt(String(a.limit), 10) : undefined,
    keyOverride: typeof a.key === 'string' ? a.key : undefined,
    ignore: typeof a.ignore === 'string' ? a.ignore.split(',').map(s => s.trim()).filter(Boolean) : [],
    batch: a.batch ? parseInt(String(a.batch), 10) : undefined,
    show: a.show ? parseInt(String(a.show), 10) : undefined,
    outDir: typeof a.out === 'string' ? path.dirname(path.resolve(a.out)) : undefined,
  };
}

// ── Quoting helpers (mirror scripts/migration/queue/worker.ts) ───────────────
function quoteIdentPart(s: string, d: Dialect): string {
  return d === 'mysql' ? `\`${s.replace(/`/g, '``')}\`` : `"${s.replace(/"/g, '""')}"`;
}
function quoteQualifiedRef(ref: string, d: Dialect): string {
  return ref.split('.').map(p => quoteIdentPart(p, d)).join('.');
}
function quoteLit(v: string): string {
  return `'${String(v).replace(/'/g, "''")}'`;
}

const FILTER_OPERATORS = new Set([
  '=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL',
]);

function buildRowFilterWhere(
  filters: Array<{ column: string; operator: string; value?: string }> | undefined,
  d: Dialect
): string {
  if (!filters || filters.length === 0) return '';
  const quoteId = (c: string) => (c.includes('.') ? quoteQualifiedRef(c, d) : quoteIdentPart(c, d));
  const parts: string[] = [];
  for (const f of filters) {
    if (!f || !f.column || !FILTER_OPERATORS.has(f.operator)) continue;
    const col = quoteId(f.column);
    if (f.operator === 'IS NULL' || f.operator === 'IS NOT NULL') {
      parts.push(`${col} ${f.operator}`);
    } else if (f.operator === 'IN' || f.operator === 'NOT IN') {
      const items = (f.value ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (items.length === 0) continue;
      parts.push(`${col} ${f.operator} (${items.map(quoteLit).join(', ')})`);
    } else {
      if (f.value === undefined || f.value === null) continue;
      parts.push(`${col} ${f.operator} ${quoteLit(f.value)}`);
    }
  }
  return parts.join(' AND ');
}

function buildFromClause(
  primaryTable: string,
  joins: Array<{ table: string; type: string; leftColumn: string; rightColumn: string }>,
  d: Dialect
): string {
  let from = quoteIdentPart(primaryTable, d);
  for (const j of joins) {
    if (!j || !j.table || !j.leftColumn || !j.rightColumn) continue;
    const type = j.type === 'LEFT' ? 'LEFT JOIN' : j.type === 'RIGHT' ? 'RIGHT JOIN' : 'INNER JOIN';
    const jt = quoteIdentPart(j.table, d);
    const left = quoteQualifiedRef(j.leftColumn, d);
    const right = quoteQualifiedRef(`${j.table}.${j.rightColumn}`, d);
    from += ` ${type} ${jt} ON ${left} = ${right}`;
  }
  return from;
}

// ── Frontend → server mapping shape (mirror MigrationPage.transformMappingForServer) ──
function toServerMapping(fm: any) {
  const sourceTable = fm.sourceTables?.[0] || fm.sourceTable || '';
  const targetTable = fm.targetTables?.[0] || fm.targetTable || '';
  const hasJoins = Array.isArray(fm.joins) && fm.joins.length > 0;

  const columnMappings = (fm.columnMappings || []).map((cm: any) => {
    const directSource = typeof cm.source === 'string'
      ? cm.source
      : (hasJoins && cm.source?.table ? `${cm.source.table}.${cm.source.column}` : (cm.source?.column || ''));
    const firstSrc = cm.sourceColumns && cm.sourceColumns.length > 0 ? cm.sourceColumns[0] : undefined;
    const firstSourceCol = !firstSrc
      ? ''
      : (typeof firstSrc === 'string'
          ? firstSrc
          : (hasJoins && firstSrc.table ? `${firstSrc.table}.${firstSrc.column}` : (firstSrc.column || '')));
    const isTransform = cm.mappingType === 'TRANSFORM' || cm.mappingType === 'CONCAT';
    const targetCol = typeof cm.target === 'string' ? cm.target : cm.target?.column || '';
    const isCustom = cm.mappingType === 'TRANSFORM' &&
      (cm.transformation?.type === 'CUSTOM' || cm.transformation?.type === 'BUILD_JSON');
    const exprAlias = `__expr_${targetCol}`;

    const sm: any = {
      source: isCustom ? exprAlias : (isTransform && firstSourceCol ? firstSourceCol : directSource),
      target: targetCol,
      mappingType: cm.mappingType || 'DIRECT',
    };
    if (cm.constantValue !== undefined) sm.constantValue = cm.constantValue;
    if (cm.transformation) sm.transformation = cm.transformation;
    if (cm.convertDateToEpoch === true) sm.convertDateToEpoch = true;
    if (cm.convertTinyintToBoolean === true) sm.convertTinyintToBoolean = true;
    if (cm.zeroToNull === true) sm.zeroToNull = true;
    if (cm.encrypt === true) sm.encrypt = true;
    if (cm.useGroupMin === true) sm.useGroupMin = true;
    return sm;
  });

  return {
    sourceTable,
    targetTable,
    columnMappings,
    conflictStrategy: fm.conflictStrategy ?? 'skip',
    conflictKeyColumns: fm.conflictKeyColumns,
    rowFilters: fm.rowFilters,
    joins: hasJoins ? fm.joins : undefined,
    autoIdColumn: fm.autoIdColumn,
    groupByColumns: fm.groupByColumns,
  };
}

/** Explicit SELECT list for the joined query: each real source column aliased to its
 *  qualified name (so transformRow reads sourceRow["table.column"]). */
function buildJoinSelectList(serverMapping: any, d: Dialect): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const cm of serverMapping.columnMappings) {
    if (cm.mappingType === 'CONSTANT') continue;
    if (cm.mappingType === 'TRANSFORM' &&
        (cm.transformation?.type === 'CUSTOM' || cm.transformation?.type === 'BUILD_JSON')) continue;
    const src = cm.source as string | undefined;
    if (!src || seen.has(src)) continue;
    seen.add(src);
    parts.push(`${quoteQualifiedRef(src, d)} AS ${quoteIdentPart(src, d)}`);
  }
  return parts.join(', ');
}

/** CUSTOM/BUILD_JSON expressions projected as `(expr) AS alias` (alias === cm.source). */
function buildSelectExpressions(serverMapping: any): Array<{ expr: string; alias: string }> {
  return serverMapping.columnMappings
    .filter((cm: any) =>
      cm.mappingType === 'TRANSFORM' && cm.source &&
      cm.transformation?.type === 'CUSTOM')
    .map((cm: any) => {
      const expr = cm.transformation?.params?.expression ?? null;
      return expr ? { expr: String(expr), alias: String(cm.source) } : null;
    })
    .filter((x: any): x is { expr: string; alias: string } => !!x);
}

// ── Value normalisation for comparison (handles cross-type: Date/epoch, bool/0-1,
//    bigint-as-string from pg, numeric "1" vs "1.0", etc.) ─────────────────────
function norm(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return String(Math.floor(v.getTime() / 1000));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}
function valuesEqual(a: any, b: any): boolean {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  if (na === null || nb === null) return false;
  // boolean / 0-1 / t-f equivalence
  const boolMap: Record<string, string> = { true: '1', false: '0', t: '1', f: '0' };
  const ca = boolMap[na.toLowerCase()] ?? na;
  const cb = boolMap[nb.toLowerCase()] ?? nb;
  if (ca === cb) return true;
  // numeric equivalence ("100" vs "100.0", "1e2" vs "100")
  const fa = Number(na), fb = Number(nb);
  if (na !== '' && nb !== '' && !Number.isNaN(fa) && !Number.isNaN(fb) && fa === fb) return true;
  return false;
}

// ── Run a SELECT against the target adapter's underlying pool ─────────────────
async function queryTarget(target: IDatabaseAdapter, d: Dialect, sql: string, params: any[]): Promise<any[]> {
  const pool: any = (target as any).pool;
  if (!pool) throw new Error('target adapter exposes no pool to query');
  if (d === 'postgresql') {
    const client = await pool.connect();
    try { const r = await client.query(sql, params); return r.rows; }
    finally { client.release(); }
  } else {
    const [rows] = await pool.query(sql, params);
    return rows as any[];
  }
}

// ── Process one table mapping ─────────────────────────────────────────────────
async function processMapping(
  fm: any,
  source: IDatabaseAdapter,
  target: IDatabaseAdapter,
  sourceDialect: Dialect,
  targetDialect: Dialect,
  targetSchema: any,
  opts: DeltaOptions
) {
  const KEY_OVERRIDE = opts.keyOverride;
  const IGNORE = opts.ignore ?? [];
  const LIMIT = opts.limit;
  const BATCH = opts.batch ?? 1000;
  const SHOW = opts.show ?? 50;
  const APPLY = opts.apply === true;
  const sm = toServerMapping(fm);
  const targetTable = sm.targetTable;
  const sourceTable = sm.sourceTable;

  if (Array.isArray(sm.groupByColumns) && sm.groupByColumns.filter(Boolean).length > 0) {
    log.warn(`Mapping ${sourceTable} → ${targetTable} uses groupByColumns; the delta script does NOT dedup. Results may differ from a grouped migration.`);
  }

  // Determine the match key (target column). Priority: --key flag → conflictKeyColumns
  // → target table PK → "id".
  const tgtTable = targetSchema.tables.find((t: any) => t.name === targetTable);
  const tgtPk: string[] = tgtTable?.columns?.filter((c: any) => c.isPrimaryKey).map((c: any) => c.name) || [];
  const keyColumn = KEY_OVERRIDE
    || (sm.conflictKeyColumns && sm.conflictKeyColumns[0])
    || tgtPk[0]
    || 'id';

  // Mapped target columns (what we INSERT / compare), minus auto-id.
  const targetCols: string[] = sm.columnMappings.map((cm: any) => cm.target).filter((c: string) => c && c !== sm.autoIdColumn);
  if (!targetCols.includes(keyColumn)) {
    log.warn(`Key column "${keyColumn}" is not among mapped target columns for ${targetTable}; matching may be unreliable.`);
  }
  // Columns to compare = mapped target columns, minus the key itself and any --ignore.
  const compareCols = targetCols.filter(c => c !== keyColumn && !IGNORE.includes(c));

  // Target schema types for transformRow casting.
  const targetSchemaColumns: Record<string, string> = {};
  tgtTable?.columns?.forEach((c: any) => { targetSchemaColumns[c.name] = c.type; });

  // Build the source query exactly like the worker.
  const hasJoins = Array.isArray(sm.joins) && sm.joins.length > 0;
  const sourceWhere = buildRowFilterWhere(sm.rowFilters, sourceDialect) || undefined;
  const selectExpressions = buildSelectExpressions(sm);
  const fromClause = hasJoins ? buildFromClause(sourceTable, sm.joins, sourceDialect) : undefined;
  const selectList = hasJoins ? (buildJoinSelectList(sm, sourceDialect) || '*') : undefined;

  log.info(`Table ${sourceTable} → ${targetTable}  (key="${keyColumn}", comparing ${compareCols.length} cols)`);
  if (sourceWhere) log.info(`  filter: WHERE ${sourceWhere}`);
  if (hasJoins) log.info(`  joined source: FROM ${fromClause}`);

  // Quoted SELECT for the target lookup (key + compare columns).
  const lookupCols = [keyColumn, ...compareCols];
  const lookupSelect = lookupCols.map(c => quoteIdentPart(c, targetDialect)).join(', ');
  const qTargetTable = quoteIdentPart(targetTable, targetDialect);
  const qKey = quoteIdentPart(keyColumn, targetDialect);

  const encryptionKey = process.env.ENCRYPTION_KEY;

  let scanned = 0, newCount = 0, changedCount = 0, unchangedCount = 0, nullKeyCount = 0;
  const newRows: any[] = [];
  const changedRows: Array<{ key: any; changes: Record<string, { from: any; to: any }>; row: any }> = [];
  let stop = false;

  const onBatch = async (rows: any[]) => {
    if (stop || rows.length === 0) return;

    let batch = rows;
    if (LIMIT !== undefined && scanned + batch.length > LIMIT) {
      batch = batch.slice(0, LIMIT - scanned);
      stop = true;
    }
    scanned += batch.length;

    // Transform like the worker.
    const transformed = batch.map(r =>
      TransformationEngine.transformRow(r, sm.columnMappings, targetSchemaColumns, encryptionKey)
    );

    // Look up existing target rows for this batch's keys in one query.
    const keyVals = Array.from(new Set(
      transformed.map(t => t[keyColumn]).filter(k => k !== null && k !== undefined)
    ));
    const existing = new Map<string, any>();
    if (keyVals.length > 0) {
      const placeholders = targetDialect === 'postgresql'
        ? keyVals.map((_, i) => `$${i + 1}`).join(', ')
        : keyVals.map(() => '?').join(', ');
      const sql = `SELECT ${lookupSelect} FROM ${qTargetTable} WHERE ${qKey} IN (${placeholders})`;
      const found = await queryTarget(target, targetDialect, sql, keyVals);
      for (const row of found) existing.set(norm(row[keyColumn])!, row);
    }

    for (const t of transformed) {
      const keyVal = t[keyColumn];
      if (keyVal === null || keyVal === undefined) { nullKeyCount++; newRows.push(t); newCount++; continue; }
      const tgt = existing.get(norm(keyVal)!);
      if (!tgt) { newRows.push(t); newCount++; continue; }
      // Compare mapped columns.
      const changes: Record<string, { from: any; to: any }> = {};
      for (const col of compareCols) {
        if (!valuesEqual(tgt[col], t[col])) changes[col] = { from: tgt[col], to: t[col] };
      }
      if (Object.keys(changes).length > 0) { changedRows.push({ key: keyVal, changes, row: t }); changedCount++; }
      else unchangedCount++;
    }
  };

  await source.streamTable(sourceTable, onBatch, {
    batchSize: BATCH,
    pkColumn: undefined,           // joined / computed query → streamed (non-keyset) path
    where: sourceWhere,
    selectExpressions: selectExpressions.length ? selectExpressions : undefined,
    fromClause,
    selectList,
  });

  log.ok(`${targetTable}: scanned ${scanned} | NEW ${newCount} | CHANGED ${changedCount} | unchanged ${unchangedCount}${nullKeyCount ? ` | null-key ${nullKeyCount}` : ''}`);

  // Tell the user exactly which rows changed and in which column(s) — a row is flagged
  // CHANGED if ANY mapped column differs from the target. Capped at --show (default 50);
  // the full set is always in the report file.
  const fmtVal = (v: any) => (v === null || v === undefined ? 'NULL' : v instanceof Date ? v.toISOString() : String(v));
  if (changedRows.length > 0) {
    log.info(`  ${targetTable}: changed rows (showing ${Math.min(SHOW, changedRows.length)} of ${changedRows.length}):`);
    for (const c of changedRows.slice(0, SHOW)) {
      const cols = Object.keys(c.changes);
      const detail = cols.map(col => `${col}: ${fmtVal(c.changes[col].from)} → ${fmtVal(c.changes[col].to)}`).join(', ');
      console.log(`    • ${keyColumn}=${fmtVal(c.key)}  [${cols.length} col(s)]  ${detail}`);
    }
    if (changedRows.length > SHOW) log.info(`  …and ${changedRows.length - SHOW} more (see report).`);
  }
  if (newRows.length > 0) {
    const keys = newRows.slice(0, SHOW).map(r => fmtVal(r[keyColumn]));
    log.info(`  ${targetTable}: new keys (showing ${Math.min(SHOW, newRows.length)} of ${newRows.length}): ${keys.join(', ')}${newRows.length > SHOW ? ' …' : ''}`);
  }

  // Apply: upsert new + changed into target.
  let applied = { inserted: 0, failed: 0, skipped: 0 };
  if (APPLY) {
    const toWrite = [...newRows, ...changedRows.map(c => c.row)];
    if (toWrite.length === 0) {
      log.info(`${targetTable}: nothing to apply.`);
    } else {
      log.info(`${targetTable}: applying ${toWrite.length} row(s) via upsert on "${keyColumn}"...`);
      for (let i = 0; i < toWrite.length; i += BATCH) {
        const chunk = toWrite.slice(i, i + BATCH);
        const res = await target.insertBatch(targetTable, targetCols, chunk, [keyColumn], { conflictStrategy: 'upsert' });
        applied.inserted += res.inserted; applied.failed += res.failed; applied.skipped += res.skipped;
        if (res.errors.length) log.err(`${targetTable}: ${res.errors.slice(0, 3).join(' | ')}`);
      }
      log.ok(`${targetTable}: applied — inserted/updated ${applied.inserted}, failed ${applied.failed}, skipped ${applied.skipped}`);
    }
  }

  return {
    targetTable, sourceTable, keyColumn,
    scanned, new: newCount, changed: changedCount, unchanged: unchangedCount, nullKey: nullKeyCount,
    applied: APPLY ? applied : undefined,
    newRows, changedRows,
  };
}

/**
 * Run a delta against the configured source/target for the given table mappings
 * (frontend mapping shape). Connects, computes new/changed rows, optionally applies
 * them, writes report files, and returns the per-table reports. Reusable from
 * per-table modules (see scripts/<target-table>.ts).
 */
export async function runDelta(tableMappings: any[], opts: DeltaOptions = {}): Promise<any[]> {
  if (!Array.isArray(tableMappings) || tableMappings.length === 0) {
    log.err('No tableMappings provided.');
    return [];
  }
  const APPLY = opts.apply === true;
  const LIMIT = opts.limit;

  const sourceDialect = resolveDbType('source');
  const targetDialect = resolveDbType('target');
  log.info(`Source: ${sourceDialect}  →  Target: ${targetDialect}`);
  log.info(`Mode: ${APPLY ? 'APPLY (upsert)' : 'DRY (report only)'}${LIMIT ? `  | limit ${LIMIT}` : ''}`);

  const source = createAdapter(sourceDialect, 'source');
  const target = createAdapter(targetDialect, 'target');

  const reports: any[] = [];
  try {
    await source.connect();
    await target.connect();
    log.ok('Connected.');

    const targetSchema = await target.getSchema();

    for (const fm of tableMappings) {
      const rep = await processMapping(fm, source, target, sourceDialect, targetDialect, targetSchema, opts);
      reports.push(rep);
    }
  } catch (err) {
    log.err(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  } finally {
    await source.disconnect().catch(() => {});
    await target.disconnect().catch(() => {});
  }

  // Write report files (unless disabled).
  if (opts.writeFiles !== false) {
    const outDir = opts.outDir || path.resolve('scripts/output');
    try {
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, 'delta-report.json');
      const payload = {
        generatedAt: new Date().toISOString(),
        applied: APPLY,
        tables: reports.map(r => ({
          targetTable: r.targetTable,
          sourceTable: r.sourceTable,
          keyColumn: r.keyColumn,
          counts: { scanned: r.scanned, new: r.new, changed: r.changed, unchanged: r.unchanged, nullKey: r.nullKey },
          applied: r.applied,
          newRows: r.newRows,
          changedRows: r.changedRows,
        })),
      };
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
      log.ok(`Delta report written: ${outPath}`);

      // Per-table breakdown files so the new / changed data is easy to grab on its own:
      //   <table>-new.json      → every NEW row (full data)
      //   <table>-changed.json  → every CHANGED row (full data + which columns changed)
      //   <table>-ids.json      → just the id lists { newIds, changedIds }
      for (const r of reports) {
        const base = path.join(outDir, `${r.targetTable}`);
        const newIds = r.newRows.map((row: any) => row[r.keyColumn]);
        const changedIds = r.changedRows.map((c: any) => c.key);
        fs.writeFileSync(`${base}-new.json`, JSON.stringify(r.newRows, null, 2));
        fs.writeFileSync(`${base}-changed.json`, JSON.stringify(
          r.changedRows.map((c: any) => ({ [r.keyColumn]: c.key, changedColumns: Object.keys(c.changes), changes: c.changes, row: c.row })),
          null, 2
        ));
        fs.writeFileSync(`${base}-ids.json`, JSON.stringify({ keyColumn: r.keyColumn, newIds, changedIds }, null, 2));
        log.ok(`${r.targetTable}: wrote ${base}-new.json (${newIds.length}), ${base}-changed.json (${changedIds.length}), ${base}-ids.json`);
      }
    } catch (e) {
      log.warn(`Could not write report: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Console summary.
  console.log('\n──────── DELTA SUMMARY ────────');
  console.table(reports.map(r => ({
    table: r.targetTable, key: r.keyColumn, scanned: r.scanned,
    NEW: r.new, CHANGED: r.changed, unchanged: r.unchanged,
    ...(r.applied ? { applied: r.applied.inserted, failed: r.applied.failed } : {}),
  })));

  return reports;
}

/** CLI entry: load a config file (--config) and run the delta over it. */
async function main() {
  const a = parseArgs(process.argv.slice(2));
  const configPath = (a.config as string) || path.resolve('scripts/delta.config.json');
  if (!fs.existsSync(configPath)) {
    log.err(`Config not found: ${configPath}`);
    process.exitCode = 1;
    return;
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tableMappings: any[] = config.tableMappings || config.mappings || (Array.isArray(config) ? config : []);
  log.info(`Config: ${configPath}`);
  await runDelta(tableMappings, parseCliOpts());
}

// Only run as a CLI when executed directly (not when imported by a per-table module).
const invokedDirectly = process.argv[1] && /delta-transfer\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) main();
