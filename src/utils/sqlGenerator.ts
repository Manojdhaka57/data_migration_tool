import type { TableMapping, ColumnMapping } from '../types';
import type { TableDependency } from '../features/migrationOrder/migrationOrderSlice';

// Helper to get source tables from a mapping (handles both array and string formats)
function getSourceTablesFromMapping(mapping: TableMapping): string[] {
  const mappingAny = mapping as TableMapping & { sourceTable?: string };
  if (mappingAny.sourceTable) {
    return [mappingAny.sourceTable];
  }
  return mapping.sourceTables || [];
}

// Helper to get target tables from a mapping (handles both array and string formats)
function getTargetTablesFromMapping(mapping: TableMapping): string[] {
  const mappingAny = mapping as TableMapping & { targetTable?: string };
  if (mappingAny.targetTable) {
    return [mappingAny.targetTable];
  }
  return mapping.targetTables || [];
}

export interface GeneratedSQL {
  tableName: string;
  sourceTable: string;
  targetTable: string;
  sql: string;
  insertSQL: string;
  selectSQL: string;
  description: string;
  level: number;
  columnCount: number;
}

export interface SQLGeneratorOptions {
  includeComments: boolean;
  useTruncate: boolean;
  batchSize: number;
  dialect: 'postgresql' | 'mysql' | 'mssql';
}

const DEFAULT_OPTIONS: SQLGeneratorOptions = {
  includeComments: true,
  useTruncate: false,
  batchSize: 1000,
  dialect: 'postgresql',
};

/**
 * Generate migration SQL for a single table mapping
 */
function generateTableMigrationSQL(
  mapping: TableMapping,
  level: number,
  options: SQLGeneratorOptions
): GeneratedSQL[] {
  const results: GeneratedSQL[] = [];
  const targetTables = getTargetTablesFromMapping(mapping);
  const sourceTables = getSourceTablesFromMapping(mapping);
  
  for (const targetTable of targetTables) {
    const columnMappings = mapping.columnMappings.filter(
      cm => cm.target.table === targetTable &&
        // Auto-id columns are left out so the target DB assigns them.
        cm.target.column !== mapping.autoIdColumn
    );

    if (columnMappings.length === 0) continue;
    
    const sourceTable = sourceTables[0]; // Primary source table
    
    // Build SELECT columns
    const selectColumns: string[] = [];
    const targetColumns: string[] = [];
    
    for (const cm of columnMappings) {
      targetColumns.push(cm.target.column);
      selectColumns.push(generateSelectExpression(cm, options.dialect));
    }
    
    // GROUP BY (dedup) / ORDER BY clause shared by the SELECT and INSERT previews.
    const trailingClause = buildGroupOrderClause(mapping, options);

    // Generate SELECT statement
    const selectSQL = generateSelectStatement(
      sourceTable,
      selectColumns,
      targetColumns,
      options,
      trailingClause
    );

    // Generate INSERT statement
    const insertSQL = generateInsertStatement(
      targetTable,
      targetColumns,
      selectColumns,
      sourceTable,
      options,
      trailingClause
    );
    
    // Combined SQL with comments
    let sql = '';
    
    if (options.includeComments) {
      sql += `-- ============================================\n`;
      sql += `-- Migration: ${sourceTable} -> ${targetTable}\n`;
      sql += `-- Level: ${level} (migrate in this order)\n`;
      sql += `-- Columns: ${columnMappings.length}\n`;
      const groupCols = (mapping.groupByColumns ?? []).filter(Boolean);
      const bareName = (c: string) => (c.includes('.') ? c.split('.').pop()! : c);
      if (groupCols.length > 0 && mapping.groupByMode !== 'all') {
        sql += `-- Dedup: keep one full row per group of (${groupCols.map(bareName).join(', ')}) via ROW_NUMBER()\n`;
      }
      const minCols = (mapping.groupMinColumns ?? []).filter(Boolean);
      if (groupCols.length > 0 && mapping.groupByMode === 'all' && minCols.length > 0) {
        sql += `-- Keep all rows; replace (${minCols.map(bareName).join(', ')}) with MIN over group (${groupCols.map(bareName).join(', ')})\n`;
      }
      sql += `-- Description: ${mapping.description || 'Auto-generated migration'}\n`;
      sql += `-- ============================================\n\n`;
    }
    
    if (options.useTruncate) {
      sql += `-- WARNING: This will delete existing data!\n`;
      sql += `TRUNCATE TABLE ${quoteIdentifier(targetTable, options.dialect)};\n\n`;
    }
    
    sql += insertSQL;
    
    results.push({
      tableName: targetTable,
      sourceTable,
      targetTable,
      sql,
      insertSQL,
      selectSQL,
      description: mapping.description || `Migrate ${sourceTable} to ${targetTable}`,
      level,
      columnCount: columnMappings.length,
    });
  }
  
  return results;
}

/**
 * Generate SELECT expression for a column mapping
 */
function generateSelectExpression(cm: ColumnMapping, dialect: string): string {
  switch (cm.mappingType) {
    case 'DIRECT':
      if (cm.source) {
        return `${quoteIdentifier(cm.source.table, dialect)}.${quoteIdentifier(cm.source.column, dialect)}`;
      }
      return 'NULL';
      
    case 'CONSTANT':
      return formatConstantValue(cm.constantValue, dialect);
      
    case 'TRANSFORM':
      if (cm.sourceColumns && cm.sourceColumns.length > 0 && cm.transformation) {
        const sourceCol = `${quoteIdentifier(cm.sourceColumns[0].table, dialect)}.${quoteIdentifier(cm.sourceColumns[0].column, dialect)}`;
        return applyTransformation(sourceCol, cm.transformation.type, dialect);
      }
      return 'NULL';
      
    case 'CONCAT':
      if (cm.sourceColumns && cm.sourceColumns.length > 0) {
        const cols = cm.sourceColumns.map(
          sc => `${quoteIdentifier(sc.table, dialect)}.${quoteIdentifier(sc.column, dialect)}`
        );
        const separator = cm.concatSeparator || ' ';
        return generateConcat(cols, separator, dialect);
      }
      return 'NULL';
      
    case 'LOOKUP':
      // Lookup requires a subquery
      if (cm.lookup) {
        return `(SELECT ${quoteIdentifier(cm.lookup.returnColumn, dialect)} FROM ${quoteIdentifier(cm.lookup.table, dialect)} WHERE ${quoteIdentifier(cm.lookup.matchColumn, dialect)} = ${quoteIdentifier(cm.source?.table || '', dialect)}.${quoteIdentifier(cm.source?.column || '', dialect)} LIMIT 1)`;
      }
      return 'NULL';
      
    default:
      return 'NULL';
  }
}

/**
 * Apply transformation function
 */
function applyTransformation(column: string, transformType: string, dialect: string): string {
  switch (transformType) {
    case 'UPPER':
      return `UPPER(${column})`;
    case 'LOWER':
      return `LOWER(${column})`;
    case 'TRIM':
      return `TRIM(${column})`;
    case 'DATE_FORMAT':
      if (dialect === 'postgresql') {
        return `TO_CHAR(${column}, 'YYYY-MM-DD')`;
      } else if (dialect === 'mysql') {
        return `DATE_FORMAT(${column}, '%Y-%m-%d')`;
      }
      return `CONVERT(VARCHAR, ${column}, 23)`;
    case 'TIMESTAMP_TO_DATE':
      if (dialect === 'postgresql') {
        return `TO_TIMESTAMP(${column} / 1000)`;
      }
      return `FROM_UNIXTIME(${column} / 1000)`;
    case 'COALESCE':
      return `COALESCE(${column}, '')`;
    case 'NULLIF_EMPTY':
      return `NULLIF(${column}, '')`;
    default:
      return column;
  }
}

/**
 * Generate CONCAT expression
 */
function generateConcat(columns: string[], separator: string, dialect: string): string {
  if (dialect === 'postgresql') {
    return columns.join(` || '${separator}' || `);
  } else if (dialect === 'mysql') {
    return `CONCAT_WS('${separator}', ${columns.join(', ')})`;
  }
  return columns.join(` + '${separator}' + `);
}

/**
 * Format constant value for SQL
 */
function formatConstantValue(value: unknown, dialect: string): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    if (dialect === 'postgresql') {
      return value ? 'TRUE' : 'FALSE';
    }
    return value ? '1' : '0';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    // Escape single quotes
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }
  return `'${String(value)}'`;
}

/**
 * Quote identifier based on dialect
 */
function quoteIdentifier(name: string, dialect: string): string {
  if (!name) return '""';
  if (dialect === 'postgresql') {
    return `"${name}"`;
  } else if (dialect === 'mysql') {
    return `\`${name}\``;
  }
  return `[${name}]`;
}

/**
 * Build the trailing ORDER BY clause (incl. leading newline, no trailing `;`) from a
 * mapping's orderBy. Columns may be stored qualified as "table.column"; only the bare
 * name is shown. GROUP BY dedup is not rendered here — it runs as a ROW_NUMBER()
 * window subquery at migration time and is noted in the header comment instead.
 */
function buildGroupOrderClause(mapping: TableMapping, options: SQLGeneratorOptions): string {
  const dialect = options.dialect;
  const bare = (c: string) => quoteIdentifier(c.includes('.') ? c.split('.').pop()! : c, dialect);
  const order = (mapping.orderBy ?? []).filter((o) => o && o.column);
  if (order.length === 0) return '';
  return `\nORDER BY ${order.map((o) => `${bare(o.column)} ${o.direction === 'DESC' ? 'DESC' : 'ASC'}`).join(', ')}`;
}

/**
 * Generate SELECT statement
 */
function generateSelectStatement(
  sourceTable: string,
  selectColumns: string[],
  targetColumns: string[],
  options: SQLGeneratorOptions,
  trailingClause = ''
): string {
  const dialect = options.dialect;
  const columnList = selectColumns.map((col, i) =>
    `    ${col} AS ${quoteIdentifier(targetColumns[i], dialect)}`
  ).join(',\n');

  return `SELECT\n${columnList}\nFROM ${quoteIdentifier(sourceTable, dialect)}${trailingClause};\n`;
}

/**
 * Generate INSERT statement
 */
function generateInsertStatement(
  targetTable: string,
  targetColumns: string[],
  selectColumns: string[],
  sourceTable: string,
  options: SQLGeneratorOptions,
  trailingClause = ''
): string {
  const dialect = options.dialect;
  const targetColList = targetColumns.map(c => quoteIdentifier(c, dialect)).join(', ');
  const selectColList = selectColumns.map((col, i) =>
    `    ${col} AS ${quoteIdentifier(targetColumns[i], dialect)}`
  ).join(',\n');

  let sql = `INSERT INTO ${quoteIdentifier(targetTable, dialect)} (${targetColList})\n`;
  sql += `SELECT\n${selectColList}\n`;
  sql += `FROM ${quoteIdentifier(sourceTable, dialect)}${trailingClause};\n`;

  return sql;
}

/**
 * Generate all migration SQL in proper order
 */
export function generateMigrationSQL(
  mappings: TableMapping[],
  orderedTables: TableDependency[],
  options: Partial<SQLGeneratorOptions> = {}
): GeneratedSQL[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: GeneratedSQL[] = [];
  
  // Create a map of table to its level
  const tableLevelMap = new Map<string, number>();
  for (const dep of orderedTables) {
    tableLevelMap.set(dep.tableName, dep.level);
  }
  
  // Generate SQL for each mapping
  for (const mapping of mappings) {
    // Find the level for this mapping's target tables
    let level = 0;
    const targetTables = getTargetTablesFromMapping(mapping);
    for (const targetTable of targetTables) {
      const tableLevel = tableLevelMap.get(targetTable);
      if (tableLevel !== undefined && tableLevel > level) {
        level = tableLevel;
      }
    }
    
    const tableSQL = generateTableMigrationSQL(mapping, level, opts);
    results.push(...tableSQL);
  }
  
  // Sort by level (migration order)
  results.sort((a, b) => a.level - b.level);
  
  return results;
}

/**
 * Generate complete migration script
 */
export function generateFullMigrationScript(
  sqlStatements: GeneratedSQL[],
  options: Partial<SQLGeneratorOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  let script = '';
  
  // Header
  script += `-- ============================================\n`;
  script += `-- DATA MIGRATION SCRIPT\n`;
  script += `-- Generated: ${new Date().toISOString()}\n`;
  script += `-- Dialect: ${opts.dialect.toUpperCase()}\n`;
  script += `-- Total Tables: ${sqlStatements.length}\n`;
  script += `-- ============================================\n\n`;
  
  // Disable foreign key checks at start
  if (opts.dialect === 'postgresql') {
    script += `-- Disable triggers/constraints during migration\n`;
    script += `SET session_replication_role = 'replica';\n\n`;
  } else if (opts.dialect === 'mysql') {
    script += `-- Disable foreign key checks\n`;
    script += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;
  }
  
  // Add BEGIN TRANSACTION
  script += `-- Start transaction\n`;
  script += `BEGIN;\n\n`;
  
  // Group by level
  const byLevel = new Map<number, GeneratedSQL[]>();
  for (const stmt of sqlStatements) {
    const level = stmt.level;
    if (!byLevel.has(level)) {
      byLevel.set(level, []);
    }
    byLevel.get(level)!.push(stmt);
  }
  
  // Add SQL for each level
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
  for (const level of levels) {
    const statements = byLevel.get(level)!;
    
    script += `-- ============================================\n`;
    script += `-- LEVEL ${level}: ${statements.length} table(s)\n`;
    script += `-- ============================================\n\n`;
    
    for (const stmt of statements) {
      script += stmt.sql;
      script += '\n';
    }
  }
  
  // Add COMMIT
  script += `-- Commit transaction\n`;
  script += `COMMIT;\n\n`;
  
  // Re-enable foreign key checks
  if (opts.dialect === 'postgresql') {
    script += `-- Re-enable triggers/constraints\n`;
    script += `SET session_replication_role = 'origin';\n`;
  } else if (opts.dialect === 'mysql') {
    script += `-- Re-enable foreign key checks\n`;
    script += `SET FOREIGN_KEY_CHECKS = 1;\n`;
  }
  
  return script;
}

/**
 * Generate summary of migration
 */
export function generateMigrationSummary(sqlStatements: GeneratedSQL[]): string {
  let summary = '';
  summary += `Migration Summary\n`;
  summary += `=================\n\n`;
  summary += `Total Tables: ${sqlStatements.length}\n`;
  summary += `Total Columns: ${sqlStatements.reduce((sum, s) => sum + s.columnCount, 0)}\n\n`;
  
  // Group by level
  const byLevel = new Map<number, GeneratedSQL[]>();
  for (const stmt of sqlStatements) {
    if (!byLevel.has(stmt.level)) {
      byLevel.set(stmt.level, []);
    }
    byLevel.get(stmt.level)!.push(stmt);
  }
  
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
  for (const level of levels) {
    const statements = byLevel.get(level)!;
    summary += `Level ${level}:\n`;
    for (const stmt of statements) {
      summary += `  - ${stmt.sourceTable} → ${stmt.targetTable} (${stmt.columnCount} columns)\n`;
    }
    summary += '\n';
  }
  
  return summary;
}

/**
 * Group SQL statements by level
 */
export function groupSQLByLevel(sqlStatements: GeneratedSQL[]): Map<number, GeneratedSQL[]> {
  const byLevel = new Map<number, GeneratedSQL[]>();
  for (const stmt of sqlStatements) {
    if (!byLevel.has(stmt.level)) {
      byLevel.set(stmt.level, []);
    }
    byLevel.get(stmt.level)!.push(stmt);
  }
  return byLevel;
}

/**
 * Generate SQL script for a specific level
 */
export function generateLevelScript(
  level: number,
  statements: GeneratedSQL[],
  options: Partial<SQLGeneratorOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  let script = '';
  script += `-- ============================================\n`;
  script += `-- MIGRATION LEVEL ${level}\n`;
  script += `-- Tables: ${statements.length}\n`;
  script += `-- Generated: ${new Date().toISOString()}\n`;
  script += `-- Dialect: ${opts.dialect.toUpperCase()}\n`;
  script += `-- ============================================\n\n`;
  
  // Disable FK checks
  if (opts.dialect === 'postgresql') {
    script += `SET session_replication_role = 'replica';\n\n`;
  } else if (opts.dialect === 'mysql') {
    script += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;
  }
  
  script += `BEGIN;\n\n`;
  
  // Add all table statements for this level
  for (const stmt of statements) {
    script += stmt.sql;
    script += '\n';
  }
  
  script += `COMMIT;\n\n`;
  
  // Re-enable FK checks
  if (opts.dialect === 'postgresql') {
    script += `SET session_replication_role = 'origin';\n`;
  } else if (opts.dialect === 'mysql') {
    script += `SET FOREIGN_KEY_CHECKS = 1;\n`;
  }
  
  return script;
}

/**
 * Generate SQL script for a single table
 */
export function generateSingleTableScript(
  statement: GeneratedSQL,
  options: Partial<SQLGeneratorOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  let script = '';
  script += `-- ============================================\n`;
  script += `-- TABLE MIGRATION: ${statement.sourceTable} → ${statement.targetTable}\n`;
  script += `-- Level: ${statement.level}\n`;
  script += `-- Columns: ${statement.columnCount}\n`;
  script += `-- Generated: ${new Date().toISOString()}\n`;
  script += `-- Dialect: ${opts.dialect.toUpperCase()}\n`;
  script += `-- ============================================\n\n`;
  
  script += `-- Description: ${statement.description}\n\n`;
  
  // Disable FK checks
  if (opts.dialect === 'postgresql') {
    script += `SET session_replication_role = 'replica';\n\n`;
  } else if (opts.dialect === 'mysql') {
    script += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;
  }
  
  script += `BEGIN;\n\n`;
  script += statement.sql;
  script += '\n';
  script += `COMMIT;\n\n`;
  
  // Re-enable FK checks
  if (opts.dialect === 'postgresql') {
    script += `SET session_replication_role = 'origin';\n`;
  } else if (opts.dialect === 'mysql') {
    script += `SET FOREIGN_KEY_CHECKS = 1;\n`;
  }
  
  return script;
}
