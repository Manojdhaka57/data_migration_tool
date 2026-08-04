import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Job } from 'bullmq';
import { 
  addMigrationJob, 
  migrationQueue, 
  getMigrationJobsStatus, 
  cleanMigrationQueues 
} from '../queue/queue';
import { startWorkers, setProgressCallback } from '../queue/worker';
import { createAdapter, resolveDbType } from '../adapters/factory';
import {
  setRuntimeConnectionConfig,
  clearRuntimeConnectionConfig,
  getRuntimeConnectionConfig,
  getRoleOverride,
  resolveEncryptionKey,
  describeResolvedConnection,
} from '../adapters/runtimeConfig';
import { portableDefault } from '../adapters/typeMap';
import { getJobProgress, listTableStatuses, resetTableStatus, DbScope } from '../state/tableState';
import { DatabaseSchema, TableMapping, TableStructure } from '../types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cors({ origin: '*' }));
// Large schemas + mapping configs can exceed the 100kb default body limit.
app.use(express.json({ limit: '50mb' }));

const PORT = 9005;
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Resolved dialects (both source and target selectable: mysql | postgresql).
// These are `let` because the Connection Settings page can change them at
// runtime — refreshResolvedConfig() re-derives them after every update.
let sourceDbType = resolveDbType('source');
let targetDbType = resolveDbType('target');

// Scope for the durable Redis table-status markers
let stateScope: DbScope = resolveStateScope();

function resolveStateScope(): DbScope {
  return {
    sourceDb: getRoleOverride('source').database || process.env.SOURCE_DB_NAME || 'src',
    targetDb: getRoleOverride('target').database || process.env.TARGET_DB_NAME || 'tgt',
  };
}

/** Re-derive everything cached from env after the UI changes connection settings. */
function refreshResolvedConfig(): void {
  sourceDbType = resolveDbType('source');
  targetDbType = resolveDbType('target');
  stateScope = resolveStateScope();
}

const getSourceAdapter = () => createAdapter(sourceDbType, 'source');
const getTargetAdapter = () => createAdapter(targetDbType, 'target');

// Surface handler errors in the server console (they're also returned in the HTTP body).
function logError(context: string, err: any) {
  console.error(`\x1b[31m[API ERROR]\x1b[0m ${new Date().toISOString()} - ${context}: ${err?.message || err}`);
}

// Topologically rank tables by their foreign-key dependencies. Level 0 has no
// dependencies (copy first); a table's level is 1 + the max level of the tables
// it references. Self-references and cycles are broken to avoid infinite recursion.
function computeTableLevels(schema: DatabaseSchema): Map<string, number> {
  const names = new Set(schema.tables.map(t => t.name));
  const deps = new Map<string, Set<string>>();
  schema.tables.forEach(t => deps.set(t.name, new Set()));

  for (const t of schema.tables) {
    for (const c of t.columns) {
      if (c.isForeignKey && c.foreignKeyRef) {
        const ref = typeof c.foreignKeyRef === 'string' ? c.foreignKeyRef : c.foreignKeyRef.table;
        if (ref && ref !== t.name && names.has(ref)) deps.get(t.name)!.add(ref);
      }
    }
  }

  const levels = new Map<string, number>();
  const calc = (name: string, seen: Set<string>): number => {
    if (levels.has(name)) return levels.get(name)!;
    if (seen.has(name)) return 0; // cycle guard
    seen.add(name);
    let max = 0;
    for (const dep of deps.get(name) || []) max = Math.max(max, calc(dep, new Set(seen)) + 1);
    levels.set(name, max);
    return max;
  };
  schema.tables.forEach(t => calc(t.name, new Set()));
  return levels;
}

// WebSocket connection events
io.on('connection', (socket) => {
  console.log(`🔌 Dashboard connected via WebSocket: ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`🔌 Dashboard disconnected: ${socket.id}`);
  });
});

// Set worker progress callback to pipe live stats through Socket.io
setProgressCallback((jobId, progressData) => {
  // Calculate performance metrics: throughput, ETA, memory usage
  const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB
  
  // Find current table results
  const currentTableResult = progressData.results.find((r: any) => r.table === progressData.currentTable);
  const successRows = currentTableResult ? currentTableResult.successRows : 0;
  const totalRows = currentTableResult ? currentTableResult.totalRows : 0;
  const elapsedMs = currentTableResult ? currentTableResult.duration : 1;
  
  const throughput = Math.round(successRows / (elapsedMs / 1000 || 1));
  const remainingRows = totalRows - successRows;
  const etaSeconds = throughput > 0 ? Math.round(remainingRows / throughput) : 0;

  const payload = {
    jobId,
    progress: progressData.progress,
    currentTable: progressData.currentTable,
    processedRows: progressData.results.reduce((sum: number, r: any) => sum + r.successRows, 0),
    failedRows: progressData.results.reduce((sum: number, r: any) => sum + r.failedRows, 0),
    throughput,
    eta: etaSeconds,
    memoryUsage: Math.round(memoryUsage * 100) / 100,
    results: progressData.results,
    timestamp: new Date().toISOString(),
  };

  io.emit('migration-progress', payload);
});

// REST ENDPOINTS

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/test-connection/both', async (req, res) => {
  const source = getSourceAdapter();
  const target = getTargetAdapter();
  
  try {
    await source.connect();
    const sourceTables = await source.getTableNames();
    await target.connect();
    const targetTables = await target.getTableNames();

    res.json({
      source: { success: true, message: `Connected to source (${sourceDbType.toUpperCase()})`, tables: sourceTables.length },
      target: { success: true, message: `Connected to target (${targetDbType.toUpperCase()})`, tables: targetTables.length },
    });
  } catch (err: any) {
    logError('GET /api/test-connection/both', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await source.disconnect();
    await target.disconnect();
  }
});

app.get('/api/tables/:type', async (req, res) => {
  const adapter = req.params.type === 'source' ? getSourceAdapter() : getTargetAdapter();
  try {
    await adapter.connect();
    const tables = await adapter.getTables();
    const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);
    res.json({ success: true, tables, totalTables: tables.length, totalRows });
  } catch (err: any) {
    logError(`GET /api/tables/${req.params.type}`, err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await adapter.disconnect();
  }
});

app.get('/api/schema/:type', async (req, res) => {
  const adapter = req.params.type === 'source' ? getSourceAdapter() : getTargetAdapter();
  try {
    await adapter.connect();
    const schema = await adapter.getSchema();
    res.json(schema);
  } catch (err: any) {
    logError(`GET /api/schema/${req.params.type}`, err);
    res.status(500).json({ error: err.message });
  } finally {
    await adapter.disconnect();
  }
});

// Preview sample rows from a source/target table (for inspecting data, e.g. duplicates).
app.get('/api/preview/:type/:table', async (req, res) => {
  const adapter = req.params.type === 'target' ? getTargetAdapter() : getSourceAdapter();
  const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50), 500);
  try {
    await adapter.connect();
    const rows = await adapter.previewTable(req.params.table, limit);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({ table: req.params.table, type: req.params.type, columns, rowCount: rows.length, rows });
  } catch (err: any) {
    logError(`GET /api/preview/${req.params.type}/${req.params.table}`, err);
    res.status(500).json({ error: err.message });
  } finally {
    await adapter.disconnect();
  }
});

app.get('/api/ddl/:type', async (req, res) => {
  const adapter = req.params.type === 'source' ? getSourceAdapter() : getTargetAdapter();
  try {
    await adapter.connect();
    const ddl = await adapter.getDDL();
    res.json(ddl);
  } catch (err: any) {
    logError(`GET /api/ddl/${req.params.type}`, err);
    res.status(500).json({ error: err.message });
  } finally {
    await adapter.disconnect();
  }
});

// Suggested copy order for source OR target: tables ranked by FK dependencies (parents first).
app.get('/api/ddl-order/:type', async (req, res) => {
  const adapter = req.params.type === 'target' ? getTargetAdapter() : getSourceAdapter();
  try {
    await adapter.connect();
    const schema = await adapter.getSchema();
    const levels = computeTableLevels(schema);

    const byLevel = new Map<number, string[]>();
    for (const [name, lvl] of levels) {
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl)!.push(name);
    }
    const order = [...byLevel.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, tables]) => ({ level, tables: tables.sort() }));

    res.json({ type: req.params.type, database: schema.database, order, flat: order.flatMap(o => o.tables) });
  } catch (err: any) {
    logError(`GET /api/ddl-order/${req.params.type}`, err);
    res.status(500).json({ error: err.message });
  } finally {
    await adapter.disconnect();
  }
});

// Apply the source schema to the target database (additive only).
// Creates missing tables and adds missing columns (cross-dialect type mapped).
// Never drops or alters existing columns/types. Optional body { tables?: string[] }.
app.post('/api/ddl/apply-target', async (req, res) => {
  const tableFilter: string[] | null =
    Array.isArray(req.body?.tables) && req.body.tables.length > 0 ? req.body.tables : null;
  // recreate = DROP each target table first so it EXACTLY matches the source (deletes data).
  const recreate: boolean = req.body?.recreate === true;

  const source = getSourceAdapter();
  const target = getTargetAdapter();

  try {
    await source.connect();
    await target.connect();

    const sourceSchema = await source.getSchema();
    const targetSchema = await target.getSchema();
    const targetColsByTable = new Map(
      targetSchema.tables.map(t => [t.name, new Set(t.columns.map(c => c.name))])
    );

    const createdTables: string[] = [];
    const addedColumns: string[] = [];
    const droppedTables: string[] = [];
    const unchangedTables: string[] = [];
    const errors: string[] = [];
    const structs = new Map<string, TableStructure>();

    // Phase 0 (recreate): drop the target tables we're about to apply, so they're
    // rebuilt exactly from the source. Removing them from the column map makes Phase 1
    // treat them as missing and CREATE them fresh.
    if (recreate) {
      const targetTableSet = new Set(targetSchema.tables.map(t => t.name));
      for (const table of sourceSchema.tables) {
        if (tableFilter && !tableFilter.includes(table.name)) continue;
        if (!targetTableSet.has(table.name)) continue; // nothing to drop
        try {
          await target.dropTable(table.name);
          targetColsByTable.delete(table.name);
          droppedTables.push(table.name);
        } catch (e: any) {
          errors.push(`${table.name}: drop failed — ${e.message}`);
        }
      }
    }

    // Phase 1: create missing tables + add missing columns (no FKs yet, so order doesn't matter).
    for (const table of sourceSchema.tables) {
      if (tableFilter && !tableFilter.includes(table.name)) continue;
      try {
        const struct = await source.getTableStructure(table.name);
        structs.set(table.name, struct);
        const existingCols = targetColsByTable.get(table.name);

        if (!existingCols) {
          await target.createTable(table.name, struct, sourceDbType);
          createdTables.push(table.name);
        } else {
          const missing = struct.columns.filter(c => !existingCols.has(c.name));
          for (const col of missing) {
            await target.addColumn(table.name, { name: col.name, type: col.type }, sourceDbType);
            addedColumns.push(`${table.name}.${col.name}`);
          }
          if (missing.length === 0) unchangedTables.push(table.name);
        }
      } catch (e: any) {
        errors.push(`${table.name}: ${e.message}`);
      }
    }

    // Phase 1b: repair auto-increment / identity. A table created before identity was
    // preserved has a plain integer PK with no sequence, so the application's INSERTs
    // (which omit the id) fail with a NOT NULL violation. For every column the source
    // marks auto-increment, make the target column generated and advance its sequence
    // past existing data. Postgres only — MySQL AUTO_INCREMENT self-heals on insert.
    const fixedIdentity: string[] = [];
    if (target.ensureAutoIncrement) {
      for (const [tableName, struct] of structs) {
        for (const col of struct.columns) {
          if (!col.autoIncrement) continue;
          try {
            await target.ensureAutoIncrement(tableName, col.name);
            fixedIdentity.push(`${tableName}.${col.name}`);
          } catch (e: any) {
            errors.push(`${tableName}: identity fix on "${col.name}" failed — ${e.message}`);
          }
        }
      }
    }

    // Phase 1c: repair column DEFAULTs. A column created before defaults were preserved
    // is NOT NULL with no default, so an insert that omits it fails with a not-null
    // violation. Re-apply the source column's default where it ports to the target.
    const fixedDefaults: string[] = [];
    if (target.ensureColumnDefault) {
      for (const [tableName, struct] of structs) {
        for (const col of struct.columns) {
          if (col.autoIncrement || col.defaultValue == null) continue;
          const expr = portableDefault(col.defaultValue, sourceDbType, targetDbType);
          if (expr == null) continue;
          try {
            await target.ensureColumnDefault(tableName, col.name, expr);
            fixedDefaults.push(`${tableName}.${col.name}`);
          } catch (e: any) {
            errors.push(`${tableName}: default fix on "${col.name}" failed — ${e.message}`);
          }
        }
      }
    }

    // Phase 2: add foreign keys now that all tables exist. Skip FKs whose referenced
    // table isn't in the target yet and report it, so the user knows what to apply first.
    const targetAfter = await target.getSchema();
    const targetTableSet = new Set(targetAfter.tables.map(t => t.name));
    const existingFks = new Set<string>();
    for (const t of targetAfter.tables) {
      for (const c of t.columns) {
        if (c.isForeignKey) existingFks.add(`${t.name}.${c.name}`);
      }
    }

    const addedConstraints: string[] = [];
    const missingRefTables = new Set<string>();

    for (const [tableName, struct] of structs) {
      for (const fk of struct.foreignKeys) {
        if (existingFks.has(`${tableName}.${fk.column}`)) continue; // already present
        if (!targetTableSet.has(fk.refTable)) {
          missingRefTables.add(fk.refTable);
          errors.push(`${tableName}: FK on "${fk.column}" skipped — referenced table "${fk.refTable}" is not in the target yet`);
          continue;
        }
        try {
          await target.addForeignKey(tableName, `fk_${tableName}_${fk.column}`, fk.column, fk.refTable, fk.refColumn);
          addedConstraints.push(`fk_${tableName}_${fk.column}`);
        } catch (e: any) {
          errors.push(`${tableName}: FK on "${fk.column}" failed — ${e.message}`);
        }
      }
    }

    res.json({
      success: true,
      targetDb: stateScope.targetDb,
      targetDbType,
      droppedTables,
      createdTables,
      addedColumns,
      addedConstraints,
      fixedIdentity,
      fixedDefaults,
      missingRefTables: [...missingRefTables],
      unchangedTables,
      errors,
    });
  } catch (err: any) {
    logError('POST /api/ddl/apply-target', err);
    res.status(500).json({ error: err.message });
  } finally {
    await source.disconnect();
    await target.disconnect();
  }
});

app.post('/api/ddl-check', async (req, res) => {
  const mappings = req.body.tableMappings;
  if (!mappings || !Array.isArray(mappings)) {
    return res.status(400).json({ error: 'tableMappings is required' });
  }

  const source = getSourceAdapter();
  const target = getTargetAdapter();

  try {
    await source.connect();
    await target.connect();

    const results = [];
    for (const m of mappings) {
      const srcStruct = await source.getTableStructure(m.sourceTable);
      const tgtStruct = await target.getTableStructure(m.targetTable);
      
      const differences: string[] = [];
      const srcColMap = new Map(srcStruct.columns.map(c => [c.name, c]));
      const tgtColMap = new Map(tgtStruct.columns.map(c => [c.name, c]));

      srcStruct.columns.forEach(srcCol => {
        const tgtCol = tgtColMap.get(srcCol.name);
        if (!tgtCol) {
          differences.push(`Column "${srcCol.name}" missing in target`);
        } else if (srcCol.type.toLowerCase() !== tgtCol.type.toLowerCase()) {
          differences.push(`Column "${srcCol.name}" type mismatch (Source: ${srcCol.type}, Target: ${tgtCol.type})`);
        }
      });

      results.push({
        sourceTable: m.sourceTable,
        targetTable: m.targetTable,
        source: srcStruct,
        target: tgtStruct,
        match: differences.length === 0,
        differences,
      });
    }

    res.json({ results });
  } catch (err: any) {
    logError('POST /api/ddl-check', err);
    res.status(500).json({ error: err.message });
  } finally {
    await source.disconnect();
    await target.disconnect();
  }
});

// AI Assisted Schema Mapping suggestions
app.post('/api/schema/ai-suggest', async (req, res) => {
  const source = getSourceAdapter();
  try {
    await source.connect();
    const sourceSchema = await source.getSchema();
    
    // Auto-map rules: datatype alignment and naming similarity heuristics
    const mappings: TableMapping[] = sourceSchema.tables.map(table => {
      const columnMappings = table.columns.map(col => {
        let targetType = 'TEXT';
        let mappingType: 'DIRECT' | 'CONSTANT' | 'TRANSFORM' = 'DIRECT';
        const colType = col.type.toLowerCase();
        
        // Datatype conversion rules
        if (colType === 'tinyint' || colType === 'tinyint(1)' || colType === 'bool' || colType === 'boolean') {
          targetType = 'BOOLEAN';
        } else if (colType.includes('datetime') || colType.includes('timestamp')) {
          targetType = 'TIMESTAMP';
        } else if (colType.includes('json')) {
          targetType = 'JSONB';
        } else if (colType.includes('longtext') || colType.includes('mediumtext')) {
          targetType = 'TEXT';
        } else if (colType.includes('enum')) {
          targetType = 'VARCHAR(255)';
        } else if (colType.includes('int')) {
          targetType = 'INTEGER';
        }
        
        return {
          source: col.name,
          target: col.name, // matching column name
          mappingType,
          convertTinyintToBoolean: targetType === 'BOOLEAN',
          convertDateToEpoch: targetType === 'TIMESTAMP' && sourceDbType === 'mysql',
        };
      });

      return {
        sourceTable: table.name,
        targetTable: table.name,
        columnMappings,
      };
    });

    res.json({ success: true, tableMappings: mappings });
  } catch (err: any) {
    logError('POST /api/schema/ai-suggest', err);
    res.status(500).json({ error: err.message });
  } finally {
    await source.disconnect();
  }
});

// Start a migration job (BullMQ queue orchestration)
app.post('/api/migrate', async (req, res) => {
  const {
    mappingConfig,
    customDependencies,
    dryRun = false,
    useCopy = true,
    force = false,
    sourceDbType: reqSourceDbType,
    targetDbType: reqTargetDbType,
    encryptionKey: reqEncryptionKey,
  } = req.body;

  if (!mappingConfig || !mappingConfig.tableMappings) {
    return res.status(400).json({ error: 'mappingConfig is required' });
  }

  const jobId = `job_${Date.now()}`;
  try {
    const job = await addMigrationJob({
      jobId,
      sourceDbType: (reqSourceDbType || sourceDbType) as any,
      targetDbType: (reqTargetDbType || targetDbType) as any,
      tableMappings: mappingConfig.tableMappings,
      dryRun,
      tableWiseMode: false,
      customDependencies,
      batchSize: 2000,
      useCopy,
      force,
      encryptionKey: reqEncryptionKey || resolveEncryptionKey(),
    });

    res.json({ message: 'Migration started', jobId, status: 'running' });
  } catch (err: any) {
    logError('POST /api/migrate', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/migrate/dry-run', async (req, res) => {
  const { mappingConfig, customDependencies, sourceDbType: reqSourceDbType, targetDbType: reqTargetDbType, encryptionKey: reqEncryptionKey } = req.body;

  if (!mappingConfig || !mappingConfig.tableMappings) {
    return res.status(400).json({ error: 'mappingConfig is required' });
  }

  const jobId = `job_dry_${Date.now()}`;
  try {
    await addMigrationJob({
      jobId,
      sourceDbType: (reqSourceDbType || sourceDbType) as any,
      targetDbType: (reqTargetDbType || targetDbType) as any,
      tableMappings: mappingConfig.tableMappings,
      dryRun: true,
      tableWiseMode: false,
      customDependencies,
      encryptionKey: reqEncryptionKey || resolveEncryptionKey(),
    });

    res.json({ message: 'Dry run started', jobId, status: 'running' });
  } catch (err: any) {
    logError('POST /api/migrate/dry-run', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tables/create', async (req, res) => {
  const { mappingConfig } = req.body;
  if (!mappingConfig || !mappingConfig.tableMappings) {
    return res.status(400).json({ error: 'mappingConfig is required' });
  }

  const source = getSourceAdapter();
  const target = getTargetAdapter();

  try {
    await source.connect();
    await target.connect();

    const created: string[] = [];
    const existed: string[] = [];
    const errors: string[] = [];

    for (const mapping of mappingConfig.tableMappings) {
      try {
        const targetTable = mapping.targetTable;
        const targetStructCheck = await target.getTableStructure(targetTable);
        
        if (targetStructCheck.exists) {
          existed.push(targetTable);
          continue;
        }

        const struct = await source.getTableStructure(mapping.sourceTable);
        // Rewrite structure to match mapping targets
        const targetStruct = {
          ...struct,
          tableName: targetTable,
          columns: struct.columns.map(col => {
            const map = mapping.columnMappings.find((cm: any) => cm.source === col.name);
            return {
              ...col,
              name: map ? map.target : col.name,
            };
          }),
        };
        
        await target.createTable(targetTable, targetStruct, sourceDbType);
        created.push(targetTable);
      } catch (err: any) {
        errors.push(`Table ${mapping.targetTable}: ${err.message}`);
      }
    }

    res.json({ success: true, created, existed, errors });
  } catch (err: any) {
    logError('POST /api/tables/create', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await source.disconnect();
    await target.disconnect();
  }
});

app.post('/api/mapping/config', async (req, res) => {
  try {
    const configPath = path.join(__dirname, '../../../src/data/mappingConfig.json');
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true, message: 'Mapping configuration saved' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Pause, Resume, and Cancel queue operations
app.post('/api/migration/:id/pause', async (req, res) => {
  const job = await migrationQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  // Pause job execution
  await migrationQueue.pause();
  res.json({ success: true, message: 'Queue paused' });
});

app.post('/api/migration/:id/resume', async (req, res) => {
  // Resume queue execution
  await migrationQueue.resume();
  res.json({ success: true, message: 'Queue resumed' });
});

app.post('/api/migration/:id/cancel', async (req, res) => {
  const job = await migrationQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  await job.remove();
  res.json({ success: true, message: 'Job cancelled' });
});

app.get('/api/status', async (req, res) => {
  const activeJobs = await migrationQueue.getJobs(['active']);
  if (activeJobs.length > 0) {
    const job = activeJobs[0];
    const progress = job.progress || {};
    res.json({
      running: true,
      progress: (progress as any).progress || 0,
      currentTable: (progress as any).currentTable || '',
      results: (progress as any).results || [],
    });
  } else {
    res.json({
      running: false,
      progress: 0,
      currentTable: '',
      results: [],
    });
  }
});

app.get('/api/results', async (req, res) => {
  const jobs = await getMigrationJobsStatus();
  // Filter jobs that have output results
  const results = jobs
    .filter(j => j.state === 'completed' || j.state === 'failed' || j.results.length > 0)
    .map(j => ({
      id: j.id,
      timestamp: new Date(j.timestamp).toISOString(),
      duration: j.finishedOn ? j.finishedOn - j.timestamp : 0,
      totalTables: j.results.length,
      successTables: j.results.filter((r: any) => r.status === 'success').length,
      failedTables: j.results.filter((r: any) => r.status === 'failed').length,
      totalRows: j.results.reduce((sum: number, r: any) => sum + r.totalRows, 0),
      totalSuccess: j.results.reduce((sum: number, r: any) => sum + r.successRows, 0),
      totalFailed: j.results.reduce((sum: number, r: any) => sum + r.failedRows, 0),
      results: j.results,
      dryRun: j.data.dryRun,
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  res.json(results);
});

// Export CSV migration reports
app.get('/api/reports/:id/csv', async (req, res) => {
  const jobs = await getMigrationJobsStatus();
  const job = jobs.find(j => j.id === req.params.id);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  let csvContent = 'Source Table,TargetTable,Status,Total Rows,Success Rows,Failed Rows,Duration (ms),Errors\n';
  
  job.results.forEach((r: any) => {
    csvContent += `"${r.sourceTable}","${r.table}","${r.status}",${r.totalRows},${r.successRows},${r.failedRows},${r.duration},"${r.errors.join('; ').replace(/"/g, '""')}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=migration_report_${req.params.id}.csv`);
  res.status(200).send(csvContent);
});

// Expose the resolved default dialects so the UI can initialize its selectors
app.get('/api/config', (_req, res) => {
  res.json({
    sourceDbType,
    targetDbType,
    sourceDb: stateScope.sourceDb,
    targetDb: stateScope.targetDb,
  });
});

// CONNECTION SETTINGS
// Lets the UI supply DB connection details when .env doesn't have them (or to
// point at a different database without editing .env). UI values win; anything
// left blank falls back to the matching *_DB_* env var.

/**
 * Current settings plus the effective value of each field and where it came
 * from ('ui' | 'env' | 'default'), so the form can show what is actually in use.
 * Passwords are never echoed back — only whether one is set.
 */
app.get('/api/connection-config', (_req, res) => {
  const stored = getRuntimeConnectionConfig();
  res.json({
    success: true,
    // Stored overrides, with the password redacted to a boolean.
    stored: {
      source: { ...stored.source, password: undefined, hasPassword: !!stored.source.password },
      target: { ...stored.target, password: undefined, hasPassword: !!stored.target.password },
      hasEncryptionKey: !!stored.encryptionKey,
    },
    resolved: {
      source: describeResolvedConnection('source'),
      target: describeResolvedConnection('target'),
    },
  });
});

/** Store connection settings for this server process. */
app.post('/api/connection-config', (req, res) => {
  try {
    const { source, target, encryptionKey } = req.body ?? {};
    setRuntimeConnectionConfig({ source, target, encryptionKey });
    refreshResolvedConfig();

    console.log(
      `\x1b[36m[CONFIG]\x1b[0m connection settings updated from UI — ` +
        `source: ${sourceDbType}://${stateScope.sourceDb}, target: ${targetDbType}://${stateScope.targetDb}`,
    );

    res.json({
      success: true,
      sourceDbType,
      targetDbType,
      resolved: {
        source: describeResolvedConnection('source'),
        target: describeResolvedConnection('target'),
      },
    });
  } catch (err: any) {
    logError('POST /api/connection-config', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/** Drop all UI settings and go back to .env alone. */
app.delete('/api/connection-config', (_req, res) => {
  clearRuntimeConnectionConfig();
  refreshResolvedConfig();
  console.log('\x1b[36m[CONFIG]\x1b[0m connection settings cleared — falling back to .env');
  res.json({
    success: true,
    sourceDbType,
    targetDbType,
    resolved: {
      source: describeResolvedConnection('source'),
      target: describeResolvedConnection('target'),
    },
  });
});

/**
 * Try connecting with the settings in the request WITHOUT storing them, so the
 * form can offer a "Test" button before saving. Applies the settings, probes,
 * then always restores whatever was stored before.
 */
app.post('/api/connection-config/test', async (req, res) => {
  const previous = getRuntimeConnectionConfig();
  const { source, target } = req.body ?? {};
  const roles = (req.body?.roles as ('source' | 'target')[]) ?? ['source', 'target'];

  const probe = async (role: 'source' | 'target') => {
    const adapter = createAdapter(resolveDbType(role), role);
    try {
      await adapter.connect();
      const tables = await adapter.getTableNames();
      return { success: true, message: `Connected (${resolveDbType(role)})`, tables: tables.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      await adapter.disconnect().catch(() => undefined);
    }
  };

  try {
    setRuntimeConnectionConfig({ source, target });
    const results: Record<string, unknown> = {};
    for (const role of roles) results[role] = await probe(role);
    res.json({ success: true, ...results });
  } catch (err: any) {
    logError('POST /api/connection-config/test', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    // Never let a test leave the server pointing somewhere new.
    setRuntimeConnectionConfig(previous);
    refreshResolvedConfig();
  }
});

// Live Redis progress counters for a job (the "rows processed" indicator)
app.get('/api/migration/:id/progress', async (req, res) => {
  try {
    const p = await getJobProgress(req.params.id);
    res.json({ jobId: req.params.id, ...p });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// BullMQ job state ('waiting'|'active'|'completed'|'failed'|...) — used by the
// frontend to run tables strictly one-after-another.
app.get('/api/migration/:id/state', async (req, res) => {
  try {
    const job = await migrationQueue.getJob(req.params.id);
    if (!job) return res.json({ state: 'not_found' });
    const state = await job.getState();
    res.json({ state, finishedOn: job.finishedOn ?? null, failedReason: job.failedReason ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List durable table-transfer markers (done/partial/failed) for the current src→tgt scope
app.get('/api/table-status', async (_req, res) => {
  try {
    const tables = await listTableStatuses(stateScope);
    res.json({ scope: stateScope, tables });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clear table-transfer markers so the next run re-migrates (body: { table?: string })
app.post('/api/table-status/reset', async (req, res) => {
  try {
    const deleted = await resetTableStatus(stateScope, req.body?.table);
    res.json({ success: true, deleted, table: req.body?.table || 'ALL' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Boot servers
export function startServer() {
  // Start parallel worker
  startWorkers();

  server.listen(PORT, () => {
    console.log(`\n🚀 Production Migration Express API & WebSocket Server running on http://localhost:${PORT}`);
    console.log(`   Connected to Redis: ${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || '6379'}`);
  });
}
