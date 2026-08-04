import { Worker, Job } from 'bullmq';
import { redisConnection, retryQueue, MigrationJobData } from './queue';
import { createAdapter } from '../adapters/factory';
import { TransformationEngine } from '../transformation/engine';
import { ValidationEngine, ValidationReport } from '../validation/engine';
import {
  acquireTableLock,
  releaseTableLock,
  renewTableLock,
  isTableDone,
  getTableStatus,
  markTableDone,
  markTablePartial,
  initJobProgress,
  addJobTotalRows,
  incrJobProgress,
  DbScope,
  DEFAULT_LOCK_TTL_MS,
} from '../state/tableState';
import { TableMapping, TableResult, DatabaseSchema } from '../types';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const FILTER_OPERATORS = new Set([
  '=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL',
]);

/**
 * Build a safe SQL WHERE fragment (no leading WHERE) from a table mapping's row
 * filters, combined with AND. Identifiers are quoted per dialect and values are
 * single-quoted with embedded quotes escaped. Unknown operators are dropped.
 */
function buildRowFilterWhere(
  filters: Array<{ column: string; operator: string; value?: string }> | undefined,
  dialect: 'mysql' | 'postgresql'
): string {
  if (!filters || filters.length === 0) return '';
  const quoteOne = (c: string) =>
    dialect === 'mysql' ? `\`${c.replace(/`/g, '``')}\`` : `"${c.replace(/"/g, '""')}"`;
  // Support qualified "table.column" (multi-table mappings) → "table"."column".
  const quoteId = (c: string) =>
    c.includes('.')
      ? c.split('.').map(quoteOne).join('.')
      : quoteOne(c);
  const quoteLit = (v: string) => `'${String(v).replace(/'/g, "''")}'`;
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

/**
 * Build a jsonb_build_object (Postgres) / JSON_OBJECT (MySQL) SQL expression from a
 * BUILD_JSON transform's field list. Each field maps a target JSON key to a source
 * column, optionally extracting a sub-key from a source JSON/JSONB column.
 */
function buildJsonExpression(
  fields: Array<{ key: string; column: string; jsonKey?: string }> | undefined,
  dialect: 'mysql' | 'postgresql'
): string | null {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const quoteId = (c: string) =>
    dialect === 'mysql' ? `\`${c.replace(/`/g, '``')}\`` : `"${c.replace(/"/g, '""')}"`;
  const esc = (s: string) => String(s).replace(/'/g, "''");
  const pairs: string[] = [];
  for (const f of fields) {
    if (!f || !f.key || !f.column) continue;
    const col = quoteId(f.column);
    let valueExpr = col;
    if (f.jsonKey) {
      valueExpr = dialect === 'mysql'
        ? `JSON_EXTRACT(${col}, '$.${esc(f.jsonKey)}')`
        : `(${col})::jsonb -> '${esc(f.jsonKey)}'`;
    }
    pairs.push(`'${esc(f.key)}', ${valueExpr}`);
  }
  if (pairs.length === 0) return null;
  return dialect === 'mysql'
    ? `JSON_OBJECT(${pairs.join(', ')})`
    : `jsonb_build_object(${pairs.join(', ')})`;
}

/** Quote one identifier part for a dialect. */
function quoteIdentPart(s: string, dialect: 'mysql' | 'postgresql'): string {
  return dialect === 'mysql' ? `\`${s.replace(/`/g, '``')}\`` : `"${s.replace(/"/g, '""')}"`;
}
/** Quote a possibly-qualified "table.column" reference. */
function quoteQualifiedRef(ref: string, dialect: 'mysql' | 'postgresql'): string {
  return ref.split('.').map((p) => quoteIdentPart(p, dialect)).join('.');
}

/** Build the FROM expression for a joined source query. */
function buildFromClause(
  primaryTable: string,
  joins: Array<{ table: string; type: 'INNER' | 'LEFT' | 'RIGHT'; leftColumn: string; rightColumn: string }>,
  dialect: 'mysql' | 'postgresql'
): string {
  let from = quoteIdentPart(primaryTable, dialect);
  for (const j of joins) {
    if (!j || !j.table || !j.leftColumn || !j.rightColumn) continue;
    const type = j.type === 'LEFT' ? 'LEFT JOIN' : j.type === 'RIGHT' ? 'RIGHT JOIN' : 'INNER JOIN';
    const jt = quoteIdentPart(j.table, dialect);
    const left = quoteQualifiedRef(j.leftColumn, dialect);
    const right = quoteQualifiedRef(`${j.table}.${j.rightColumn}`, dialect);
    from += ` ${type} ${jt} ON ${left} = ${right}`;
  }
  return from;
}

/**
 * Build the explicit SELECT list for a joined query: each real-column source aliased
 * to its qualified name (so the row keys match mapping.source). CONSTANT and
 * CUSTOM/BUILD_JSON columns are excluded (handled separately).
 */
function buildJoinSelectList(mapping: TableMapping, dialect: 'mysql' | 'postgresql'): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const cm of mapping.columnMappings) {
    if (cm.mappingType === 'CONSTANT') continue;
    if (cm.mappingType === 'TRANSFORM' &&
        (cm.transformation?.type === 'CUSTOM' || cm.transformation?.type === 'BUILD_JSON')) continue;
    const src = (cm as any).source as string | undefined;
    if (!src || seen.has(src)) continue;
    seen.add(src);
    parts.push(`${quoteQualifiedRef(src, dialect)} AS ${quoteIdentPart(src, dialect)}`);
  }
  return parts.join(', ');
}

/**
 * Build an ORDER BY fragment (no leading ORDER BY) from a mapping's orderBy spec.
 * Direction is clamped to ASC/DESC. Pass `asAlias` when ordering the OUTER query of a
 * dedup subquery, whose columns are exposed under their full source-string name
 * ("table.column") as a single identifier — so we quote the whole string, not split it.
 */
function buildOrderByClause(
  orderBy: Array<{ column: string; direction?: string }> | undefined,
  dialect: 'mysql' | 'postgresql',
  asAlias = false
): string {
  if (!Array.isArray(orderBy) || orderBy.length === 0) return '';
  const parts = orderBy
    .filter(o => o && o.column)
    .map(o => {
      const ref = asAlias ? quoteIdentPart(o.column, dialect) : quoteQualifiedRef(o.column, dialect);
      return `${ref} ${o.direction === 'DESC' ? 'DESC' : 'ASC'}`;
    });
  return parts.join(', ');
}

/**
 * Every real (non-constant, non-computed) source column referenced by a mapping, as
 * its source-string ("column" for single-table, "table.column" for joins) — i.e. the
 * exact key the transform engine reads off each row.
 */
function collectMappedSourceColumns(mapping: TableMapping): string[] {
  const seen = new Set<string>();
  for (const cm of mapping.columnMappings) {
    if (cm.mappingType === 'CONSTANT') continue;
    // CUSTOM / BUILD_JSON read their value from a computed alias, not a base column.
    if (cm.mappingType === 'TRANSFORM' &&
        (cm.transformation?.type === 'CUSTOM' || cm.transformation?.type === 'BUILD_JSON')) continue;
    const src = (cm as any).source as string | undefined;
    if (src && !seen.has(src)) seen.add(src);
  }
  return [...seen];
}

/** Strip a "table.column" qualifier down to the bare "column". */
function bareColumn(ref: string): string {
  return ref.includes('.') ? ref.split('.').pop()! : ref;
}

/**
 * Keep-all + group-min: an explicit SELECT list over the base source (no dedup) where the
 * chosen columns are replaced, on every row, with MIN(col) OVER (PARTITION BY group cols),
 * and all other mapped columns keep their per-row value. Each column is aliased to its
 * source-string name so the transform engine reads it. Returns null when nothing applies.
 */
function buildKeepAllMinSelectList(
  mapping: TableMapping,
  groupCols: string[],
  groupMinColumns: string[],
  dialect: 'mysql' | 'postgresql'
): string | null {
  // MIN columns come from the table-level list AND any column mapping flagged useGroupMin.
  const perColumn = mapping.columnMappings
    .filter((cm: any) => cm.useGroupMin)
    .map((cm: any) => cm.source as string | undefined)
    .filter((s: any): s is string => !!s);
  const minCols = [...new Set([...groupMinColumns.filter(Boolean), ...perColumn])];
  if (groupCols.length === 0 || minCols.length === 0) return null;
  const partition = groupCols.map(c => quoteQualifiedRef(c, dialect)).join(', ');
  const isMin = (src: string) => minCols.some(m => m === src || bareColumn(m) === bareColumn(src));
  const realCols = collectMappedSourceColumns(mapping);
  if (realCols.length === 0) return null;
  const parts = realCols.map(src => {
    const ref = quoteQualifiedRef(src, dialect);
    const alias = quoteIdentPart(src, dialect);
    return isMin(src)
      ? `MIN(${ref}) OVER (PARTITION BY ${partition}) AS ${alias}`
      : `${ref} AS ${alias}`;
  });
  return parts.join(', ');
}

/**
 * Build a "keep one full row per group" dedup query using a ROW_NUMBER() window:
 * partition by the group columns, keep the first row of each (lowest PK when known,
 * else a stable order). Every mapped column survives because the outer query selects
 * from a subquery that exposes the whole row. Returns the pieces the streamed-read
 * path needs, or null when no group columns are set.
 *
 * CUSTOM / BUILD_JSON expressions (`selectExpressions`) are evaluated INSIDE the
 * subquery — where the real (possibly joined) base tables are in scope — so an
 * expression that references qualified columns like `students.batch_id` resolves
 * correctly. The outer query then just passes their aliases through by bare name.
 *
 * Requires a window-function-capable source (MySQL 8.0+ or PostgreSQL).
 */
function buildDedupSubquery(
  mapping: TableMapping,
  baseFrom: string,
  innerWhere: string | undefined,
  pkColumn: string | undefined,
  selectExpressions: Array<{ expr: string; alias: string }>,
  dialect: 'mysql' | 'postgresql'
): { fromClause: string; selectList: string; where: string; defaultOrder: string } | null {
  const cols = (mapping.groupByColumns ?? []).filter(Boolean);
  if (cols.length === 0) return null;

  const rnAlias = quoteIdentPart('__rn', dialect);
  const grpAlias = quoteIdentPart('__grp', dialect);
  const partition = cols.map(c => quoteQualifiedRef(c, dialect)).join(', ');
  // Qualify the PK tiebreak with the primary source table — a bare `id` is ambiguous
  // when a joined table also has an `id` column ("in window order by is ambiguous").
  const tiebreak = pkColumn
    ? `${quoteQualifiedRef(`${mapping.sourceTable}.${pkColumn}`, dialect)} ASC`
    : partition;
  const whereInner = innerWhere ? ` WHERE ${innerWhere}` : '';

  // Inner SELECT: an EXPLICIT, aliased list (never `*`) so a joined source with
  // duplicate column names can't make the outer reference ambiguous, and every column
  // is exposed under its full source-string name ("table.column") — the key the
  // transform engine reads. CUSTOM / BUILD_JSON expressions are evaluated here, where
  // the base tables are in scope, so qualified refs like `students.batch_id` resolve.
  const realCols = collectMappedSourceColumns(mapping);
  // Expose mapped columns + group columns + any ORDER BY columns (the latter two so the
  // outer query can order/group on them even when they aren't themselves mapped).
  const orderCols = (mapping.orderBy ?? []).map(o => o?.column).filter(Boolean) as string[];
  const exposed = [...new Set([...realCols, ...cols, ...orderCols])];
  const innerParts = exposed.map(src => `${quoteQualifiedRef(src, dialect)} AS ${quoteIdentPart(src, dialect)}`);
  for (const e of selectExpressions) innerParts.push(`(${e.expr}) AS ${quoteIdentPart(e.alias, dialect)}`);
  innerParts.push(`ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY ${tiebreak}) AS ${rnAlias}`);
  const fromClause = `(SELECT ${innerParts.join(', ')} FROM ${baseFrom}${whereInner}) AS ${grpAlias}`;

  // Outer SELECT: mapped real columns + computed-expression aliases, each referenced by
  // its (now unambiguous) alias name.
  const outerCols = [...new Set([...realCols, ...selectExpressions.map(e => e.alias)])];
  const selectList = outerCols.length > 0
    ? outerCols.map(c => quoteIdentPart(c, dialect)).join(', ')
    : '*';

  // Stable order for the outer query (keeps OFFSET paging consistent on MySQL): the
  // group columns, by their exposed alias name.
  const defaultOrder = cols.map(c => quoteIdentPart(c, dialect)).join(', ');

  return { fromClause, selectList, where: `${rnAlias} = 1`, defaultOrder };
}

// Global active workers list to manage them programmatically
const activeWorkers: Worker[] = [];

// Callback for WebSockets server to broadcast updates
let onProgressCallback: (jobId: string, status: any) => void = () => {};

export function setProgressCallback(cb: (jobId: string, status: any) => void) {
  onProgressCallback = cb;
}

/**
 * Custom dependency topological sorter
 */
function calculateMigrationLevels(
  tableMappings: TableMapping[],
  schema: DatabaseSchema | null,
  customDependencies: Array<{ from: string; to: string }> = []
): Map<string, number> {
  const levels = new Map<string, number>();
  const dependencyMap = new Map<string, Set<string>>();

  // Initialize
  tableMappings.forEach(m => {
    dependencyMap.set(m.targetTable, new Set());
  });

  if (schema) {
    schema.tables.forEach(table => {
      if (dependencyMap.has(table.name)) {
        table.columns.forEach(col => {
          if (col.isForeignKey && col.foreignKeyRef) {
            let refTableName: string | null = null;
            if (typeof col.foreignKeyRef === 'string') {
              refTableName = col.foreignKeyRef;
            } else if (typeof col.foreignKeyRef === 'object' && col.foreignKeyRef !== null) {
              refTableName = (col.foreignKeyRef as any).table || (col.foreignKeyRef as any).refTable || null;
            }
            
            if (refTableName && dependencyMap.has(refTableName)) {
              dependencyMap.get(table.name)?.add(refTableName);
            }
          }
        });
      }
    });
  }

  customDependencies.forEach(dep => {
    if (dependencyMap.has(dep.from)) {
      dependencyMap.get(dep.from)?.add(dep.to);
    }
  });

  const calculateLevel = (tableName: string, visited: Set<string> = new Set()): number => {
    if (visited.has(tableName)) return 0;
    if (levels.has(tableName)) return levels.get(tableName)!;

    visited.add(tableName);
    const deps = dependencyMap.get(tableName) || new Set();

    if (deps.size === 0) {
      levels.set(tableName, 0);
      return 0;
    }

    let maxLevel = 0;
    deps.forEach(dep => {
      const depLevel = calculateLevel(dep, new Set(visited));
      if (depLevel >= maxLevel) {
        maxLevel = depLevel + 1;
      }
    });

    levels.set(tableName, maxLevel);
    return maxLevel;
  };

  tableMappings.forEach(mapping => {
    calculateLevel(mapping.targetTable);
  });

  return levels;
}

/**
 * Initialize workers for migration processing
 */
export function startWorkers(concurrency = 2): Worker[] {
  console.log(`👷 Starting ${concurrency} parallel migration workers...`);

  for (let i = 0; i < concurrency; i++) {
    const worker = new Worker<MigrationJobData>(
      'migration-execution',
      async (job: Job<MigrationJobData>) => {
        const startTime = Date.now();
        const data = job.data;

        const scope: DbScope = {
          sourceDb: process.env.SOURCE_DB_NAME || 'src',
          targetDb: process.env.TARGET_DB_NAME || 'tgt',
        };
        // Cross-dialect runs cannot match per-engine checksums; judge by row count.
        const crossDialect = data.sourceDbType !== data.targetDbType;

        console.log(`🚩 Job ${job.id} started. Mode: ${data.dryRun ? 'DRY-RUN' : 'MIGRATE'} | ${data.sourceDbType} → ${data.targetDbType}`);

        // 1. Initialize Adapters (source and target each selectable: mysql | postgresql)
        const sourceAdapter = createAdapter(data.sourceDbType, 'source');
        const targetAdapter = createAdapter(data.targetDbType, 'target');

        await sourceAdapter.connect();
        await targetAdapter.connect();

        const results: TableResult[] = [];
        let totalRows = 0;
        let totalSuccess = 0;
        let totalFailed = 0;

        try {
          const sourceSchema = await sourceAdapter.getSchema();
          const targetSchema = await targetAdapter.getSchema();
          
          let tableMappings = data.tableMappings;
          
          if (data.tableWiseMode && data.selectedTables && data.selectedTables.length > 0) {
            tableMappings = tableMappings.filter(m => 
              data.selectedTables!.includes(m.targetTable)
            );
          }

          // 2. Sort mappings by topological levels
          const levels = calculateMigrationLevels(tableMappings, targetSchema, data.customDependencies);
          const sortedMappings = [...tableMappings].sort((a, b) => {
            const lvlA = levels.get(a.targetTable) ?? 0;
            const lvlB = levels.get(b.targetTable) ?? 0;
            return lvlA - lvlB;
          });

          // 3. Ensure target tables (and their columns) exist
          if (!data.dryRun) {
            console.log('🏗️ Ensuring target tables exist...');
            const targetTablesByName = new Map(targetSchema.tables.map(t => [t.name, t]));

            // A CONSTANT (or other source-less) mapping has no source column, so its
            // target column must be added explicitly — otherwise the constant value has
            // nowhere to land. Infer a sensible column type from the constant's value.
            const isSourceless = (cm: any) =>
              !cm.source || cm.mappingType === 'CONSTANT' || cm.mappingType === 'TRANSFORM' || cm.mappingType === 'CONCAT';
            const deriveTargetType = (cm: any): string => {
              if (cm.mappingType === 'CONSTANT') {
                const v = cm.constantValue;
                if (typeof v === 'boolean') return 'boolean';
                if (typeof v === 'number') return Number.isInteger(v) ? 'bigint' : 'numeric';
              }
              return 'text';
            };

            for (const mapping of sortedMappings) {
              const existing = targetTablesByName.get(mapping.targetTable);

              if (!existing) {
                const struct = await sourceAdapter.getTableStructure(mapping.sourceTable);
                // Rename source columns to their mapped targets...
                const renamed = struct.columns.map(col => {
                  const map = mapping.columnMappings.find(cm => cm.source === col.name);
                  return { ...col, name: map ? map.target : col.name };
                });
                // ...then append any source-less (e.g. CONSTANT) target columns.
                const present = new Set(renamed.map(c => c.name));
                const extra = mapping.columnMappings
                  .filter(cm => cm.target && isSourceless(cm) && !present.has(cm.target))
                  .map(cm => ({
                    name: cm.target,
                    type: deriveTargetType(cm),
                    nullable: true,
                    isPrimaryKey: false,
                    isForeignKey: false,
                  }));
                const targetStruct = { ...struct, tableName: mapping.targetTable, columns: [...renamed, ...extra] };
                await targetAdapter.createTable(mapping.targetTable, targetStruct, data.sourceDbType);
              } else {
                // Table already exists — add only the source-less target columns it's
                // missing (e.g. a newly-added CONSTANT column), leaving the rest as-is.
                const existingCols = new Set(existing.columns.map(c => c.name));
                for (const cm of mapping.columnMappings) {
                  if (!cm.target || existingCols.has(cm.target) || !isSourceless(cm)) continue;
                  await targetAdapter.addColumn(mapping.targetTable, { name: cm.target, type: deriveTargetType(cm) }, data.sourceDbType);
                  existingCols.add(cm.target);
                }
              }
            }

            // Disable FK check on target DB for streaming speed and self-references
            await targetAdapter.disableConstraints?.();
          }

          // Check if there is an existing checkpoint to resume from
          const checkpointProgress = job.progress as any;
          const completedTables = new Set<string>();
          let resumeTable = '';
          let resumeLastId = null;
          
          if (checkpointProgress && checkpointProgress.results) {
            checkpointProgress.results.forEach((r: TableResult) => {
              if (r.status === 'success') {
                completedTables.add(r.table);
                results.push(r);
              } else if (r.status === 'partial') {
                resumeTable = r.table;
                resumeLastId = checkpointProgress.lastMigratedId;
                results.push(r);
              }
            });
            console.log(`🔄 Checkpoint found. Resuming from table: ${resumeTable || 'Next incomplete'}`);
          }

          // Initialize the explicit Redis progress counters for this job.
          await initJobProgress(job.id!, 0);

          // 4. Stream & Load for each table
          for (let idx = 0; idx < sortedMappings.length; idx++) {
            const mapping = sortedMappings[idx];
            const targetTable = mapping.targetTable;
            const level = levels.get(targetTable) ?? 0;

            // (A) Durable skip across runs: a table already transferred stays locked-done.
            if (!data.force && !data.dryRun && (await isTableDone(scope, targetTable))) {
              console.log(`⏭️ Table ${targetTable} already transferred (locked), skipping...`);
              const rec = await getTableStatus(scope, targetTable);
              const doneResult: TableResult = {
                table: targetTable,
                sourceTable: mapping.sourceTable,
                totalRows: rec?.rows ?? 0,
                successRows: rec?.rows ?? 0,
                failedRows: 0,
                skippedRows: 0,
                errors: [],
                duration: 0,
                status: 'skipped',
                level,
              };
              const existIdx0 = results.findIndex(r => r.table === targetTable);
              if (existIdx0 >= 0) results[existIdx0] = doneResult; else results.push(doneResult);
              continue;
            }

            // In-job checkpoint skip (resume within a single job run).
            if (completedTables.has(targetTable) && targetTable !== resumeTable) {
              console.log(`⏭️ Table ${targetTable} already migrated (checkpoint), skipping...`);
              continue;
            }

            // (B) Acquire the table-wise lock so no other worker processes it concurrently.
            const owner = `${job.id}:${randomUUID()}`;
            const gotLock = await acquireTableLock(scope, targetTable, owner, DEFAULT_LOCK_TTL_MS);
            if (!gotLock) {
              console.log(`🔒 Table ${targetTable} is locked by another worker, skipping in this job.`);
              continue;
            }
            // Renew the lock periodically so long-running tables don't lose it mid-stream.
            const renewTimer = setInterval(() => {
              renewTableLock(scope, targetTable, owner, DEFAULT_LOCK_TTL_MS).catch(() => {});
            }, Math.floor(DEFAULT_LOCK_TTL_MS / 3));

            try {
              console.log(`🚀 Migrating table: ${mapping.sourceTable} -> ${targetTable} (Level ${level})`);

              const tableStartTime = Date.now();
              // Omit the auto-id column from the INSERT so the target DB assigns it
              // (auto-increment / identity / serial) — used to give grouped/deduped rows
              // a fresh unique id since the source id is collapsed away by GROUP BY.
              const autoIdColumn = mapping.autoIdColumn;
              const targetCols = mapping.columnMappings
                .map(cm => cm.target)
                .filter(col => col !== autoIdColumn);
              if (autoIdColumn) console.log(`🆔 Auto-assigning id for ${targetTable}: omitting "${autoIdColumn}" from INSERT (DB-generated)`);
              const conflictStrategy: 'skip' | 'upsert' = mapping.conflictStrategy === 'upsert' ? 'upsert' : 'skip';
              const insertOptions = { conflictStrategy };
              // Row filter: only source rows matching ALL conditions are migrated.
              const sourceWhere = buildRowFilterWhere(mapping.rowFilters, data.sourceDbType) || undefined;
              if (sourceWhere) console.log(`🔎 Row filter for ${mapping.sourceTable}: WHERE ${sourceWhere}`);

              // CUSTOM SQL transforms: compute the expression in the source query as an
              // aliased column (the column mapping's `source` points at that alias), since
              // arbitrary SQL can't be evaluated row-by-row in JS.
              const selectExpressions = mapping.columnMappings
                .filter((cm: any) =>
                  cm.mappingType === 'TRANSFORM' && cm.source &&
                  (cm.transformation?.type === 'CUSTOM' || cm.transformation?.type === 'BUILD_JSON')
                )
                .map((cm: any) => {
                  let expr: string | null = null;
                  if (cm.transformation.type === 'CUSTOM') {
                    expr = cm.transformation.params?.expression ?? null;
                  } else {
                    // BUILD_JSON: params.jsonFields is a JSON string of [{key, column, jsonKey?}].
                    let fields: any[] = [];
                    try { fields = JSON.parse(cm.transformation.params?.jsonFields ?? '[]'); } catch {}
                    expr = buildJsonExpression(fields, data.sourceDbType);
                  }
                  return expr ? { expr: String(expr), alias: String(cm.source) } : null;
                })
                .filter((x: any): x is { expr: string; alias: string } => !!x);

              // Multi-table join: build a joined source query (FROM + SELECT list). When
              // present, streaming uses the non-keyset path over this query.
              const hasJoins = Array.isArray(mapping.joins) && mapping.joins.length > 0;
              const baseFromClause = hasJoins
                ? buildFromClause(mapping.sourceTable, mapping.joins!, data.sourceDbType)
                : quoteIdentPart(mapping.sourceTable, data.sourceDbType);
              if (hasJoins) console.log(`🔗 Joined source for ${mapping.sourceTable}: FROM ${baseFromClause}`);

              // Dedup applies only in 'dedup' mode (the default). In 'all' mode every source
              // row is kept — the group columns are ignored — so a child mapping can reuse the
              // same join / computed id across all rows.
              const hasGroupBy = Array.isArray(mapping.groupByColumns) &&
                mapping.groupByColumns.filter(Boolean).length > 0 &&
                mapping.groupByMode !== 'all';
              const targetSchemaColumns: Record<string, string> = {};

              // Map column names to types for typecasting
              const tgtTableSchema = targetSchema.tables.find(t => t.name === targetTable);
              tgtTableSchema?.columns.forEach(col => {
                targetSchemaColumns[col.name] = col.type;
              });

              const sourceStruct = await sourceAdapter.getTableStructure(mapping.sourceTable);
              // Keyset pagination needs exactly one unique ordering column. Tables with a
              // composite PK or no PK at all (e.g. many-to-many join tables, or tables with
              // no "id") fall back to full-table streaming — otherwise ORDER BY "id" fails
              // with: column "id" does not exist.
              const pkColumn: string | undefined =
                sourceStruct.primaryKeyColumns.length === 1 ? sourceStruct.primaryKeyColumns[0] : undefined;

              // Conflict-match key for upsert: the columns the mapping chose (must be a
              // PK/unique key in the target), or the detected primary key when unset.
              // These decide "update existing row" vs "insert new row".
              const conflictKeyColumns =
                mapping.conflictKeyColumns && mapping.conflictKeyColumns.length > 0
                  ? mapping.conflictKeyColumns
                  : sourceStruct.primaryKeyColumns;

              // Resolve the source query for streaming. GROUP BY (dedup) wraps the source in a
              // ROW_NUMBER() window subquery to keep one full row per group; ORDER BY and joins
              // also force the non-keyset (streamed) path. The pieces feed both the row-count
              // and the stream call so progress and reads agree.
              const dedup = hasGroupBy
                ? buildDedupSubquery(mapping, baseFromClause, sourceWhere, pkColumn, selectExpressions, data.sourceDbType)
                : null;

              // Keep-all + group-min: not dedup, but a window MIN(col) OVER (PARTITION BY group
              // cols) replaces chosen columns on every row (e.g. set a child FK to the parent id).
              const groupCols = (mapping.groupByColumns ?? []).filter(Boolean);
              const keepAllMinSelect = (!dedup && mapping.groupByMode === 'all')
                ? buildKeepAllMinSelectList(mapping, groupCols, mapping.groupMinColumns ?? [], data.sourceDbType)
                : null;

              let orderByClause = buildOrderByClause(mapping.orderBy, data.sourceDbType, !!dedup) || undefined;
              if (dedup && !orderByClause) orderByClause = dedup.defaultOrder;
              // A window function over OFFSET-paged reads (MySQL) needs a stable order.
              if (keepAllMinSelect && !orderByClause) {
                orderByClause = pkColumn
                  ? `${quoteQualifiedRef(`${mapping.sourceTable}.${pkColumn}`, data.sourceDbType)} ASC`
                  : groupCols.map(c => quoteQualifiedRef(c, data.sourceDbType)).join(', ');
              }
              const forceStream = hasJoins || !!dedup || !!keepAllMinSelect || !!orderByClause;

              // FROM / SELECT / WHERE actually sent to streamTable + getRowCount.
              const streamFromClause = dedup
                ? dedup.fromClause
                : ((hasJoins || keepAllMinSelect) ? baseFromClause : undefined);
              const streamSelectList = dedup
                ? dedup.selectList
                : keepAllMinSelect
                  ? keepAllMinSelect
                  : (hasJoins ? (buildJoinSelectList(mapping, data.sourceDbType) || '*') : undefined);
              const streamWhere = dedup ? dedup.where : sourceWhere;

              if (dedup) console.log(`🧮 Dedup (1 row/group) for ${mapping.sourceTable}: FROM ${dedup.fromClause}`);
              if (keepAllMinSelect) console.log(`🔽 Keep-all group-min for ${mapping.sourceTable}: ${keepAllMinSelect}`);
              if (orderByClause) console.log(`↕️ Order for ${mapping.sourceTable}: ORDER BY ${orderByClause}`);

              let tableTotalRows = 0;
              try {
                tableTotalRows = await sourceAdapter.getRowCount(mapping.sourceTable, streamWhere, streamFromClause);
              } catch {}
              await addJobTotalRows(job.id!, tableTotalRows);

              let successRows = 0;
              let failedRows = 0;
              let skippedRows = 0;
              const errors: string[] = [];

              let lastId = targetTable === resumeTable ? resumeLastId : null;

              // Stream handler
              const processBatch = async (batchRows: any[]) => {
                if (batchRows.length === 0) return;

                // Transform on-the-fly
                const transformed = batchRows.map(row =>
                  TransformationEngine.transformRow(row, mapping.columnMappings, targetSchemaColumns, data.encryptionKey)
                );

                if (data.dryRun) {
                  successRows += batchRows.length;
                  await incrJobProgress(job.id!, targetTable, batchRows.length);
                } else {
                  let loadResult;
                  // COPY can't express conflict handling, so it's only used for skip-mode.
                  const canCopy = data.useCopy && conflictStrategy !== 'upsert' && !!targetAdapter.copyBatch;
                  if (canCopy) {
                    // Streaming bulk copy (PostgreSQL Copy Stream)
                    try {
                      const copied = await targetAdapter.copyBatch!(targetTable, targetCols, transformed);
                      loadResult = { inserted: copied, failed: 0, skipped: 0, errors: [] };
                    } catch (copyErr: any) {
                      // Fall back to batch insert if COPY fails
                      console.warn(`⚠️ COPY failed for ${targetTable}, falling back to INSERT: ${copyErr.message}`);
                      loadResult = await targetAdapter.insertBatch(targetTable, targetCols, transformed, conflictKeyColumns, insertOptions);
                    }
                  } else {
                    // Standard batch insert with configurable conflict handling
                    loadResult = await targetAdapter.insertBatch(targetTable, targetCols, transformed, conflictKeyColumns, insertOptions);
                  }

                  successRows += loadResult.inserted;
                  failedRows += loadResult.failed;
                  skippedRows += loadResult.skipped;

                  // Explicit Redis indicator — increment by what this batch actually moved.
                  await incrJobProgress(job.id!, targetTable, loadResult.inserted, loadResult.failed, loadResult.skipped);

                  // Track failures in retry queue (dead-letter queue queueing)
                  if (loadResult.failed > 0) {
                    await retryQueue.add(`failed-batch-${targetTable}-${job.id}`, {
                      jobId: job.id,
                      tableName: targetTable,
                      columns: targetCols,
                      rows: transformed.slice(0, 50), // Sample fail rows for dead letter analysis
                      errors: loadResult.errors,
                    });
                  }

                  if (loadResult.errors.length > 0) {
                    errors.push(...loadResult.errors);
                    // Surface insert errors (incl. duplicate-key / constraint violations)
                    // on the server console so they're debuggable, not just buried in the report.
                    console.error(
                      `❌ ${targetTable}: ${loadResult.failed} row(s) failed in this batch. Errors:\n` +
                      loadResult.errors.slice(0, 5).map(e => `   • ${e}`).join('\n')
                    );
                  }
                  // Duplicates are skipped (not errors) under the 'skip' strategy — log a
                  // heads-up so it's clear rows were de-duplicated rather than transferred.
                  if (loadResult.skipped > 0) {
                    console.warn(`⏭️ ${targetTable}: skipped ${loadResult.skipped} duplicate/conflicting row(s) this batch.`);
                  }
                }

                const lastRow = batchRows[batchRows.length - 1];
                // The streamed/dedup path isn't keyset-resumable, so don't record a PK cursor.
                lastId = (!forceStream && pkColumn) ? lastRow[pkColumn] : null;

                // Save checkpoint periodically (updates progress in Redis)
                const currentProgress = Math.round(((idx + (successRows / (tableTotalRows || 1))) / sortedMappings.length) * 100);
                const progressPayload = {
                  progress: Math.min(99, currentProgress),
                  currentTable: targetTable,
                  lastMigratedId: lastId,
                  results: [
                    ...results.filter(r => r.table !== targetTable),
                    {
                      table: targetTable,
                      sourceTable: mapping.sourceTable,
                      totalRows: tableTotalRows,
                      successRows,
                      failedRows,
                      skippedRows,
                      errors: Array.from(new Set(errors)).slice(0, 5),
                      duration: Date.now() - tableStartTime,
                      status: failedRows > 0 ? 'partial' : 'success',
                      level,
                    }
                  ],
                };

                await job.updateProgress(progressPayload);
                onProgressCallback(job.id!, progressPayload);
              };

              // Keyset streaming execution
              await sourceAdapter.streamTable(
                mapping.sourceTable,
                processBatch,
                {
                  batchSize: data.batchSize || 1000,
                  startId: lastId,
                  // Joins, GROUP BY (dedup) and ORDER BY all use the non-keyset (streamed) path.
                  pkColumn: forceStream ? undefined : pkColumn,
                  where: streamWhere,
                  // For dedup these are already folded into the subquery; passing them again
                  // would add them to the OUTER select (where qualified refs don't resolve).
                  selectExpressions: dedup ? undefined : (selectExpressions.length ? selectExpressions : undefined),
                  fromClause: streamFromClause,
                  selectList: streamSelectList,
                  orderBy: orderByClause,
                }
              );

              // After loading rows with explicit primary-key values, advance the
              // target's identity/sequence past MAX(id). Without this the application's
              // next INSERT (which omits the id) collides on the PK. No-op when the
              // table has no owned sequence, or on engines that self-heal (MySQL).
              if (!data.dryRun) {
                try {
                  await targetAdapter.resetAutoIncrement?.(targetTable);
                } catch (seqErr: any) {
                  console.warn(`⚠️ Could not reset sequence for ${targetTable}: ${seqErr.message}`);
                }
              }

              // Validation runs on EVERY real (non-dry-run) table — not only when we
              // inserted rows — so a table whose data didn't actually land in the target
              // (e.g. source returned nothing, or all rows were skipped without the data
              // already being present) is NOT falsely marked done.
              let validationReport: ValidationReport | null = null;
              if (!data.dryRun) {
                console.log(`🔍 Running Validation Engine for table ${targetTable}...`);
                validationReport = await ValidationEngine.validateTable(
                  sourceAdapter,
                  targetAdapter,
                  mapping.sourceTable,
                  targetTable,
                  targetCols,
                  streamWhere,
                  streamFromClause
                );
              }
              // "Done" is gated on the target row count matching the source — i.e. the data
              // is actually present. Checksums can legitimately differ when column mappings
              // transform values, so a checksum-only mismatch is a warning, not a failure.
              const countVerified = !validationReport ? true : validationReport.countMatch;
              if (validationReport && validationReport.status !== 'passed') {
                const checksumOnly = validationReport.countMatch; // counts match, checksum differs
                if (!checksumOnly || !crossDialect) {
                  errors.push(...validationReport.errors);
                }
              }

              const tableResult: TableResult = {
                table: targetTable,
                sourceTable: mapping.sourceTable,
                totalRows: tableTotalRows,
                successRows,
                failedRows,
                skippedRows,
                errors: Array.from(new Set(errors)).slice(0, 5),
                duration: Date.now() - tableStartTime,
                status: failedRows > 0 ? 'failed' : (countVerified ? 'success' : 'partial'),
                level,
              };

              // Replace or push the table results
              const existIdx = results.findIndex(r => r.table === targetTable);
              if (existIdx >= 0) {
                results[existIdx] = tableResult;
              } else {
                results.push(tableResult);
              }

              totalRows += tableTotalRows;
              totalSuccess += successRows;
              totalFailed += failedRows;

              // (F) Durable marker: 'done' only when the target actually holds the rows;
              // otherwise 'partial'/'failed' so a re-run retries. Store the verified target
              // row count (reflects data already present, not just rows inserted this run).
              if (!data.dryRun) {
                const doneRows = validationReport ? validationReport.targetCount : successRows;
                if (tableResult.status === 'success') {
                  await markTableDone(scope, targetTable, doneRows, lastId, job.id!);
                } else {
                  await markTablePartial(
                    scope,
                    targetTable,
                    tableResult.status === 'failed' ? 'failed' : 'partial',
                    doneRows,
                    lastId,
                    job.id!
                  );
                }
              }
            } finally {
              // (G) Always release the lock and stop the renewal timer.
              clearInterval(renewTimer);
              await releaseTableLock(scope, targetTable, owner);
            }
          }

          // Re-enable target constraints
          if (!data.dryRun) {
            await targetAdapter.enableConstraints?.();
          }

        } finally {
          await sourceAdapter.disconnect();
          await targetAdapter.disconnect();
        }

        const totalDuration = Date.now() - startTime;
        const jobResult = {
          timestamp: new Date().toISOString(),
          duration: totalDuration,
          totalTables: results.length,
          successTables: results.filter(r => r.status === 'success').length,
          failedTables: results.filter(r => r.status === 'failed').length,
          totalRows,
          totalSuccess,
          totalFailed,
          results,
          dryRun: data.dryRun,
        };

        // Complete job progress update
        await job.updateProgress({
          progress: 100,
          currentTable: 'Completed',
          results,
        });

        console.log(`🏁 Job ${job.id} completed. Rows: ${totalSuccess}/${totalRows}`);
        
        return jobResult;
      },
      {
        connection: redisConnection,
        concurrency,
      }
    );

    worker.on('failed', (job, err) => {
      console.error(`❌ Worker: Job ${job?.id} failed with error:`, err);
    });

    activeWorkers.push(worker);
  }

  return activeWorkers;
}

/**
 * Shut down all active workers
 */
export async function stopWorkers(): Promise<void> {
  console.log('🛑 Stopping workers...');
  for (const worker of activeWorkers) {
    await worker.close();
  }
  activeWorkers.length = 0;
}
