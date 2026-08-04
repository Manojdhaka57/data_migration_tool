/**
 * Database Migration Script
 * 
 * This script connects to source and target databases and migrates data
 * according to the mapping configuration.
 * 
 * Usage:
 *   npx ts-node scripts/migrate-db.ts
 * 
 * Environment Variables:
 *   SOURCE_DB_HOST, SOURCE_DB_PORT, SOURCE_DB_NAME, SOURCE_DB_USER, SOURCE_DB_PASSWORD
 *   TARGET_DB_HOST, TARGET_DB_PORT, TARGET_DB_NAME, TARGET_DB_USER, TARGET_DB_PASSWORD
 */

import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Types - matches actual mappingConfig.json format
interface ColumnMapping {
  source: string;
  target: string;
  matchType?: string;
  typeCompatible?: boolean;
  // Extended properties for transformations
  mappingType?: 'DIRECT' | 'CONSTANT' | 'TRANSFORM';
  constantValue?: string | number | boolean | null;
  transformation?: { type: string; params?: Record<string, unknown> };
}

interface TableMapping {
  sourceTable: string;
  targetTable: string;
  matchType?: string;
  confidence?: string;
  matchScore?: number;
  columnMappings: ColumnMapping[];
  unmappedTargetColumns?: string[];
}

interface MigrationConfig {
  version?: string;
  generatedAt?: string;
  summary?: {
    totalSourceTables: number;
    totalTargetTables: number;
    mappedTables: number;
  };
  tableMappings: TableMapping[];
}

interface MigrationResult {
  table: string;
  sourceTable: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  errors: string[];
  duration: number;
}

// Database connection configurations
const sourceDbConfig = {
  host: process.env.SOURCE_DB_HOST || 'localhost',
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME || 'source_db',
  user: process.env.SOURCE_DB_USER || 'postgres',
  password: process.env.SOURCE_DB_PASSWORD || 'password',
  ssl: process.env.SOURCE_DB_SSL === 'false' ? false : {
    rejectUnauthorized: false, // Allow self-signed certificates (AWS RDS)
  },
};

const targetDbConfig = {
  host: process.env.TARGET_DB_HOST || 'localhost',
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  database: process.env.TARGET_DB_NAME || 'target_db',
  user: process.env.TARGET_DB_USER || 'postgres',
  password: process.env.TARGET_DB_PASSWORD || 'password',
  ssl: process.env.TARGET_DB_SSL === 'false' ? false : {
    rejectUnauthorized: false, // Allow self-signed certificates (AWS RDS)
  },
};

// Create connection pools
const sourcePool = new Pool(sourceDbConfig);
const targetPool = new Pool(targetDbConfig);

// Logger
const log = {
  info: (msg: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${new Date().toISOString()} - ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${new Date().toISOString()} - ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${new Date().toISOString()} - ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${new Date().toISOString()} - ${msg}`),
};

/**
 * Load mapping configuration from file
 */
function loadMappingConfig(): MigrationConfig {
  const configPath = path.join(__dirname, '../src/data/mappingConfig.json');
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`Mapping config not found at ${configPath}`);
  }
  
  const content = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Get migration order based on foreign key dependencies
 */
async function getMigrationOrder(client: PoolClient, tables: string[]): Promise<string[]> {
  // Get foreign key dependencies
  const depQuery = `
    SELECT 
      tc.table_name as table_name,
      ccu.table_name as referenced_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = ANY($1)
      AND ccu.table_name = ANY($1)
  `;
  
  const result = await client.query(depQuery, [tables]);
  
  // Build dependency graph
  const dependencies: Record<string, Set<string>> = {};
  tables.forEach(t => dependencies[t] = new Set());
  
  result.rows.forEach(row => {
    if (row.table_name !== row.referenced_table) {
      dependencies[row.table_name].add(row.referenced_table);
    }
  });
  
  // Topological sort
  const sorted: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();
  
  function visit(table: string) {
    if (temp.has(table)) {
      log.warn(`Circular dependency detected involving ${table}`);
      return;
    }
    if (visited.has(table)) return;
    
    temp.add(table);
    dependencies[table]?.forEach(dep => visit(dep));
    temp.delete(table);
    visited.add(table);
    sorted.push(table);
  }
  
  tables.forEach(t => visit(t));
  return sorted;
}

/**
 * Apply transformation to a value
 */
function applyTransformation(value: unknown, transformType: string, params?: Record<string, unknown>): unknown {
  if (value === null || value === undefined) return null;
  
  const strValue = String(value);
  
  switch (transformType) {
    case 'UPPER':
      return strValue.toUpperCase();
    case 'LOWER':
      return strValue.toLowerCase();
    case 'TRIM':
      return strValue.trim();
    case 'DATE_FORMAT':
      try {
        const date = new Date(strValue);
        return date.toISOString().split('T')[0];
      } catch {
        return value;
      }
    case 'CONCAT':
      // Handled separately in row transformation
      return value;
    case 'COALESCE':
      return value || params?.default || null;
    default:
      return value;
  }
}

/**
 * Transform a single row according to column mappings
 */
function transformRow(
  sourceRow: Record<string, unknown>,
  columnMappings: ColumnMapping[]
): Record<string, unknown> {
  const targetRow: Record<string, unknown> = {};
  
  for (const mapping of columnMappings) {
    let value: unknown = null;
    const mappingType = mapping.mappingType || 'DIRECT';
    
    switch (mappingType) {
      case 'DIRECT':
        // Source is now a string (column name), not an object
        if (mapping.source) {
          value = sourceRow[mapping.source];
        }
        break;
        
      case 'CONSTANT':
        value = mapping.constantValue;
        break;
        
      case 'TRANSFORM':
        if (mapping.source && mapping.transformation) {
          value = applyTransformation(
            sourceRow[mapping.source],
            mapping.transformation.type,
            mapping.transformation.params
          );
        }
        break;
        
      default:
        // Default: direct mapping (source column name = target column name)
        if (mapping.source) {
          value = sourceRow[mapping.source];
        }
        break;
    }
    
    // Target is now a string (column name), not an object
    targetRow[mapping.target] = value;
  }
  
  return targetRow;
}

/**
 * Migrate a single table
 */
async function migrateTable(
  sourceClient: PoolClient,
  targetClient: PoolClient,
  tableMapping: TableMapping
): Promise<MigrationResult> {
  const sourceTable = tableMapping.sourceTable;
  const targetTable = tableMapping.targetTable;
  const startTime = Date.now();
  const errors: string[] = [];
  
  log.info(`Starting migration: ${sourceTable} -> ${targetTable}`);
  
  try {
    // Get source data
    const sourceQuery = `SELECT * FROM "${sourceTable}"`;
    const sourceResult = await sourceClient.query(sourceQuery);
    const sourceRows = sourceResult.rows;
    
    log.info(`Found ${sourceRows.length} rows in ${sourceTable}`);
    
    if (sourceRows.length === 0) {
      return {
        table: targetTable,
        sourceTable,
        totalRows: 0,
        successRows: 0,
        failedRows: 0,
        errors: [],
        duration: Date.now() - startTime,
      };
    }
    
    // Get target columns (target is now a string, not an object)
    const targetColumns = tableMapping.columnMappings.map(cm => cm.target);
    
    // Transform and insert rows
    let successCount = 0;
    let failCount = 0;
    
    // Use batch insert for better performance
    const batchSize = 100;
    
    for (let i = 0; i < sourceRows.length; i += batchSize) {
      const batch = sourceRows.slice(i, i + batchSize);
      const transformedBatch = batch.map(row => transformRow(row, tableMapping.columnMappings));
      
      // Build batch insert query
      const placeholders: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;
      
      transformedBatch.forEach((row) => {
        const rowPlaceholders: string[] = [];
        targetColumns.forEach(col => {
          rowPlaceholders.push(`$${paramIndex++}`);
          values.push(row[col]);
        });
        placeholders.push(`(${rowPlaceholders.join(', ')})`);
      });
      
      const insertQuery = `
        INSERT INTO "${targetTable}" (${targetColumns.map(c => `"${c}"`).join(', ')})
        VALUES ${placeholders.join(', ')}
        ON CONFLICT DO NOTHING
      `;
      
      try {
        const insertResult = await targetClient.query(insertQuery, values);
        successCount += insertResult.rowCount || 0;
        failCount += batch.length - (insertResult.rowCount || 0);
      } catch (err) {
        const batchError = err instanceof Error ? err.message : String(err);
        
        // If it's a table/column doesn't exist error, skip individual inserts
        if (batchError.includes('does not exist') || batchError.includes('relation')) {
          errors.push(`Table error: ${batchError}`);
          failCount += batch.length;
          continue;
        }
        
        // Log the first batch error for debugging
        if (errors.length === 0) {
          errors.push(`Batch error: ${batchError}`);
        }
        
        // Try individual inserts on batch failure
        for (const row of transformedBatch) {
          try {
            const singleValues = targetColumns.map(col => row[col]);
            const singlePlaceholders = targetColumns.map((_, idx) => `$${idx + 1}`);
            
            const singleQuery = `
              INSERT INTO "${targetTable}" (${targetColumns.map(c => `"${c}"`).join(', ')})
              VALUES (${singlePlaceholders.join(', ')})
              ON CONFLICT DO NOTHING
            `;
            
            await targetClient.query(singleQuery, singleValues);
            successCount++;
          } catch (rowErr) {
            failCount++;
            const rowError = rowErr instanceof Error ? rowErr.message : String(rowErr);
            // Only keep unique errors (max 10)
            if (errors.length < 10 && !errors.some(e => e.includes(rowError.substring(0, 50)))) {
              errors.push(`Row error: ${rowError}`);
            }
          }
        }
      }
      
      // Progress update
      if ((i + batchSize) % 1000 === 0 || i + batchSize >= sourceRows.length) {
        log.info(`  Progress: ${Math.min(i + batchSize, sourceRows.length)}/${sourceRows.length} rows`);
      }
    }
    
    const duration = Date.now() - startTime;
    
    if (failCount === 0) {
      log.success(`Completed ${sourceTable} -> ${targetTable}: ${successCount} rows in ${duration}ms`);
    } else {
      log.warn(`Completed ${sourceTable} -> ${targetTable}: ${successCount} success, ${failCount} failed in ${duration}ms`);
    }
    
    return {
      table: targetTable,
      sourceTable,
      totalRows: sourceRows.length,
      successRows: successCount,
      failedRows: failCount,
      errors,
      duration,
    };
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to migrate ${sourceTable}: ${errorMsg}`);
    
    return {
      table: targetTable,
      sourceTable,
      totalRows: 0,
      successRows: 0,
      failedRows: 0,
      errors: [errorMsg],
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Main migration function
 */
async function runMigration(options: {
  dryRun?: boolean;
  tables?: string[];
  disableForeignKeys?: boolean;
}) {
  const { dryRun = false, tables, disableForeignKeys = true } = options;
  
  log.info('='.repeat(60));
  log.info('Starting Database Migration');
  log.info('='.repeat(60));
  
  if (dryRun) {
    log.warn('DRY RUN MODE - No data will be written');
  }
  
  // Load configuration
  log.info('Loading mapping configuration...');
  const config = loadMappingConfig();
  
  // Filter tables if specified
  let tableMappings = config.tableMappings;
  if (tables && tables.length > 0) {
    tableMappings = tableMappings.filter(tm => 
      tables.some(t => tm.sourceTable === t || tm.targetTable === t)
    );
    log.info(`Filtered to ${tableMappings.length} table mappings`);
  }
  
  if (tableMappings.length === 0) {
    log.error('No table mappings found!');
    return;
  }
  
  // Connect to databases
  log.info('Connecting to source database...');
  const sourceClient = await sourcePool.connect();
  log.success(`Connected to source: ${sourceDbConfig.host}:${sourceDbConfig.port}/${sourceDbConfig.database}`);
  
  log.info('Connecting to target database...');
  const targetClient = await targetPool.connect();
  log.success(`Connected to target: ${targetDbConfig.host}:${targetDbConfig.port}/${targetDbConfig.database}`);
  
  const results: MigrationResult[] = [];
  const startTime = Date.now();
  
  try {
    // Get migration order
    const targetTables = tableMappings.map(tm => tm.targetTable);
    const migrationOrder = await getMigrationOrder(targetClient, targetTables);
    log.info(`Migration order: ${migrationOrder.join(' -> ')}`);
    
    // Disable foreign key checks if requested
    if (disableForeignKeys && !dryRun) {
      log.info('Disabling foreign key checks...');
      await targetClient.query('SET session_replication_role = replica;');
    }
    
    // Migrate tables in order - each table in its own transaction
    for (const targetTable of migrationOrder) {
      const tableMapping = tableMappings.find(tm => tm.targetTable === targetTable);
      
      if (!tableMapping) {
        log.warn(`No mapping found for table: ${targetTable}`);
        continue;
      }
      
      if (dryRun) {
        log.info(`[DRY RUN] Would migrate: ${tableMapping.sourceTable} -> ${targetTable}`);
        log.info(`  Column mappings: ${tableMapping.columnMappings.length}`);
        continue;
      }
      
      // Each table gets its own transaction
      try {
        await targetClient.query('BEGIN');
        const result = await migrateTable(sourceClient, targetClient, tableMapping);
        await targetClient.query('COMMIT');
        results.push(result);
      } catch (tableErr) {
        await targetClient.query('ROLLBACK');
        const errorMsg = tableErr instanceof Error ? tableErr.message : String(tableErr);
        log.error(`Table ${targetTable} failed: ${errorMsg}`);
        results.push({
          table: targetTable,
          sourceTable: tableMapping.sourceTable,
          totalRows: 0,
          successRows: 0,
          failedRows: 0,
          errors: [errorMsg],
          duration: 0,
        });
      }
    }
    
    // Re-enable foreign key checks
    if (disableForeignKeys && !dryRun) {
      log.info('Re-enabling foreign key checks...');
      await targetClient.query('SET session_replication_role = DEFAULT;');
    }
    
  } catch (err) {
    log.error(`Migration error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
    
  } finally {
    // Release connections
    sourceClient.release();
    targetClient.release();
  }
  
  // Print summary
  const totalDuration = Date.now() - startTime;
  
  log.info('');
  log.info('='.repeat(60));
  log.info('Migration Summary');
  log.info('='.repeat(60));
  
  let totalRows = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  
  results.forEach(r => {
    totalRows += r.totalRows;
    totalSuccess += r.successRows;
    totalFailed += r.failedRows;
    
    const status = r.failedRows === 0 ? '✓' : '⚠';
    console.log(`  ${status} ${r.sourceTable} -> ${r.table}: ${r.successRows}/${r.totalRows} rows (${r.duration}ms)`);
    
    if (r.errors.length > 0 && r.errors.length <= 5) {
      r.errors.forEach(e => console.log(`      Error: ${e}`));
    } else if (r.errors.length > 5) {
      console.log(`      ${r.errors.length} errors (showing first 5):`);
      r.errors.slice(0, 5).forEach(e => console.log(`      Error: ${e}`));
    }
  });
  
  log.info('');
  log.info(`Total: ${totalSuccess}/${totalRows} rows migrated successfully`);
  if (totalFailed > 0) {
    log.warn(`Failed: ${totalFailed} rows`);
  }
  log.info(`Duration: ${totalDuration}ms`);
  log.info('='.repeat(60));
  
  // Save results to file
  const resultsPath = path.join(__dirname, `../migration-results-${Date.now()}.json`);
  fs.writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    duration: totalDuration,
    totalRows,
    totalSuccess,
    totalFailed,
    results,
  }, null, 2));
  log.info(`Results saved to: ${resultsPath}`);
}

/**
 * CLI Entry Point
 */
async function main() {
  const args = process.argv.slice(2);
  
  const options = {
    dryRun: args.includes('--dry-run'),
    tables: args.filter(a => !a.startsWith('--')),
    disableForeignKeys: !args.includes('--keep-fk'),
  };
  
  try {
    await runMigration(options);
    process.exit(0);
  } catch (err) {
    log.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Run
main();
