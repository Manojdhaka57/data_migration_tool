import { createAdapter, resolveDbType } from '../adapters/factory';
import { TransformationEngine } from '../transformation/engine';
import { ValidationEngine, ValidationReport } from '../validation/engine';
import { TableMapping, TableResult } from '../types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const log = {
  info: (msg: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${new Date().toISOString()} - ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${new Date().toISOString()} - ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${new Date().toISOString()} - ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${new Date().toISOString()} - ${msg}`),
};

function loadMappingConfig(configPath: string): any {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Mapping config not found at ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

async function runCliMigration() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const useCopy = args.includes('--copy');
  const batchSize = 1000;
  
  log.info('='.repeat(60));
  log.info('🚀 CLI Database Migration Runner Starting');
  log.info('='.repeat(60));

  const configPath = path.join(__dirname, '../../../src/data/mappingConfig.json');
  const config = loadMappingConfig(configPath);
  const tableMappings: TableMapping[] = config.tableMappings;

  if (tableMappings.length === 0) {
    log.error('No table mappings found in mappingConfig.json');
    process.exit(1);
  }

  const sourceDbType = resolveDbType('source');
  const targetDbType = resolveDbType('target');

  const sourceAdapter = createAdapter(sourceDbType, 'source');
  const targetAdapter = createAdapter(targetDbType, 'target');

  await sourceAdapter.connect();
  log.success(`Connected to Source Database (${sourceDbType.toUpperCase()})`);

  await targetAdapter.connect();
  log.success(`Connected to Target Database (${targetDbType.toUpperCase()})`);

  const results: TableResult[] = [];
  const startTime = Date.now();

  try {
    if (!dryRun) {
      await targetAdapter.disableConstraints?.();
    }

    const targetSchema = await targetAdapter.getSchema();

    for (let idx = 0; idx < tableMappings.length; idx++) {
      const mapping = tableMappings[idx];
      const targetTable = mapping.targetTable;
      
      log.info(`Migrating [${idx + 1}/${tableMappings.length}]: ${mapping.sourceTable} -> ${targetTable}`);
      
      const tableStartTime = Date.now();
      const targetCols = mapping.columnMappings.map(cm => cm.target);
      const conflictStrategy: 'skip' | 'upsert' = mapping.conflictStrategy === 'upsert' ? 'upsert' : 'skip';
      const targetSchemaColumns: Record<string, string> = {};
      const sourceStruct = await sourceAdapter.getTableStructure(mapping.sourceTable);
      const pkColumn = sourceStruct.primaryKeyColumns[0] || 'id';

      // Load schema columns
      const tgtTableSchema = targetSchema.tables.find(t => t.name === targetTable);
      tgtTableSchema?.columns.forEach(col => {
        targetSchemaColumns[col.name] = col.type;
      });

      // Ensure table exists on target (mapping source types to the target dialect)
      if (!dryRun) {
        await targetAdapter.createTable(targetTable, sourceStruct, sourceDbType);
      }

      const tableTotalRows = await sourceAdapter.getRowCount(mapping.sourceTable);
      let successRows = 0;
      let failedRows = 0;
      let skippedRows = 0;
      const errors: string[] = [];

      const processBatch = async (batchRows: any[]) => {
        const transformed = batchRows.map(row => 
          TransformationEngine.transformRow(row, mapping.columnMappings, targetSchemaColumns)
        );

        if (!dryRun) {
          let loadResult;
          const canCopy = useCopy && conflictStrategy !== 'upsert' && targetAdapter.copyBatch;
          if (canCopy) {
            try {
              const copied = await targetAdapter.copyBatch!(targetTable, targetCols, transformed);
              loadResult = { inserted: copied, failed: 0, skipped: 0, errors: [] };
            } catch (err: any) {
              loadResult = await targetAdapter.insertBatch(targetTable, targetCols, transformed, sourceStruct.primaryKeyColumns, { conflictStrategy });
            }
          } else {
            loadResult = await targetAdapter.insertBatch(targetTable, targetCols, transformed, sourceStruct.primaryKeyColumns, { conflictStrategy });
          }

          successRows += loadResult.inserted;
          failedRows += loadResult.failed;
          skippedRows += loadResult.skipped;
          if (loadResult.errors.length > 0) {
            errors.push(...loadResult.errors);
          }
        } else {
          successRows += batchRows.length;
        }

        console.log(`  Progress: ${successRows}/${tableTotalRows} rows migrated`);
      };

      await sourceAdapter.streamTable(
        mapping.sourceTable,
        processBatch,
        {
          batchSize,
          pkColumn,
        }
      );

      // Validate migrated table
      let validationReport: ValidationReport | null = null;
      if (!dryRun && successRows > 0) {
        log.info(`Validating migrated table ${targetTable}...`);
        validationReport = await ValidationEngine.validateTable({
          sourceAdapter,
          targetAdapter,
          sourceTable: mapping.sourceTable,
          targetTable,
          rowsInserted: successRows,
          rowsRead: successRows + failedRows + skippedRows,
          // The CLI does not baseline the target before streaming, so the delta
          // check reports 'skipped' and the run comes back 'unverified' rather
          // than claiming a pass it cannot support.
          targetCountBefore: -1,
        });
        if (validationReport.status !== 'passed') {
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
        errors,
        duration: Date.now() - tableStartTime,
        status: failedRows > 0 ? 'failed' : (validationReport && validationReport.status !== 'passed' ? 'partial' : 'success'),
        level: 0,
      };

      results.push(tableResult);
      if (tableResult.status === 'success') {
        log.success(`Finished ${targetTable} successfully in ${tableResult.duration}ms`);
      } else {
        log.warn(`Finished ${targetTable} with status: ${tableResult.status}. Errors: ${errors.join(', ')}`);
      }
    }

    if (!dryRun) {
      await targetAdapter.enableConstraints?.();
    }
  } finally {
    await sourceAdapter.disconnect();
    await targetAdapter.disconnect();
  }

  const totalDuration = Date.now() - startTime;
  log.info('='.repeat(60));
  log.info('📊 Migration Execution Report');
  log.info('='.repeat(60));
  console.log(`Total Duration: ${totalDuration}ms`);
  results.forEach(r => {
    console.log(`- ${r.sourceTable} -> ${r.table}: ${r.successRows}/${r.totalRows} (${r.status})`);
  });
  log.info('='.repeat(60));
}

// Run the script directly
runCliMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error(`CLI execution failed: ${err.message}`);
    process.exit(1);
  });
