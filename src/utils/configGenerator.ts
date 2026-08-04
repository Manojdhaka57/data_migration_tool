import type { 
  MigrationConfig, 
  TableMapping, 
  DatabaseSchema,
  ColumnMapping
} from '../types';

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

/**
 * Formats a column mapping for output
 */
function formatColumnMapping(colMapping: ColumnMapping) {
  const base = {
    target: colMapping.target,
    mappingType: colMapping.mappingType,
  };

  switch (colMapping.mappingType) {
    case 'DIRECT':
      return {
        ...base,
        source: colMapping.source,
      };
    case 'CONSTANT':
      return {
        ...base,
        constantValue: colMapping.constantValue,
      };
    case 'TRANSFORM':
      return {
        ...base,
        transformation: colMapping.transformation,
        sourceColumns: colMapping.sourceColumns,
      };
    default:
      return base;
  }
}

/**
 * Generates the final migration configuration JSON
 */
export function generateMigrationConfig(
  sourceSchema: DatabaseSchema,
  targetSchema: DatabaseSchema,
  tableMappings: TableMapping[]
): MigrationConfig {
  return {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    sourceDatabase: sourceSchema.database,
    targetDatabase: targetSchema.database,
    tableMappings: tableMappings.map(mapping => ({
      id: mapping.id,
      sourceTables: getSourceTablesFromMapping(mapping),
      targetTables: getTargetTablesFromMapping(mapping),
      description: mapping.description,
      conflictStrategy: mapping.conflictStrategy,
      conflictKeyColumns: mapping.conflictKeyColumns,
      rowFilters: mapping.rowFilters,
      joins: mapping.joins,
      columnMappings: mapping.columnMappings.map(formatColumnMapping),
    })),
    metadata: {
      description: `Migration configuration from ${sourceSchema.database} to ${targetSchema.database}`,
    },
  };
}

/**
 * Exports config as downloadable JSON file
 */
export function downloadMigrationConfig(config: MigrationConfig): void {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `migration-config-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Copies config to clipboard
 */
export async function copyConfigToClipboard(config: MigrationConfig): Promise<boolean> {
  try {
    const json = JSON.stringify(config, null, 2);
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate SQL preview for a table mapping
 */
export function generateSqlPreview(mapping: TableMapping): string {
  if (!mapping || mapping.columnMappings.length === 0) {
    return '-- No column mappings defined';
  }

  const sourceTables = getSourceTablesFromMapping(mapping);
  const targetTables = getTargetTablesFromMapping(mapping);
  const sourceTable = sourceTables[0] || 'source_table';
  const targetTable = targetTables[0] || 'target_table';

  // Build SELECT columns
  const selectColumns: string[] = [];
  const targetColumns: string[] = [];

  for (const cm of mapping.columnMappings) {
    targetColumns.push(`"${cm.target.column}"`);
    
    switch (cm.mappingType) {
      case 'DIRECT':
        if (cm.source) {
          selectColumns.push(`  "${cm.source.column}" AS "${cm.target.column}"`);
        } else {
          selectColumns.push(`  NULL AS "${cm.target.column}"`);
        }
        break;
      
      case 'CONSTANT':
        const constVal = cm.constantValue;
        if (typeof constVal === 'string') {
          selectColumns.push(`  '${constVal.replace(/'/g, "''")}' AS "${cm.target.column}"`);
        } else if (typeof constVal === 'boolean') {
          selectColumns.push(`  ${constVal ? 'TRUE' : 'FALSE'} AS "${cm.target.column}"`);
        } else if (constVal !== null && constVal !== undefined) {
          selectColumns.push(`  ${constVal} AS "${cm.target.column}"`);
        } else {
          selectColumns.push(`  NULL AS "${cm.target.column}"`);
        }
        break;
      
      case 'TRANSFORM':
        if (cm.sourceColumns && cm.sourceColumns.length > 0 && cm.transformation) {
          const srcCol = `"${cm.sourceColumns[0].column}"`;
          let expr = srcCol;
          
          switch (cm.transformation.type) {
            case 'UPPER':
              expr = `UPPER(${srcCol})`;
              break;
            case 'LOWER':
              expr = `LOWER(${srcCol})`;
              break;
            case 'TRIM':
              expr = `TRIM(${srcCol})`;
              break;
            case 'DATE_FORMAT':
              expr = `TO_CHAR(${srcCol}, 'YYYY-MM-DD')`;
              break;
            case 'COALESCE':
              expr = `COALESCE(${srcCol}, '')`;
              break;
            default:
              expr = srcCol;
          }
          selectColumns.push(`  ${expr} AS "${cm.target.column}"`);
        } else {
          selectColumns.push(`  NULL AS "${cm.target.column}"`);
        }
        break;
      
      case 'CONCAT':
        if (cm.sourceColumns && cm.sourceColumns.length > 0) {
          const cols = cm.sourceColumns.map(sc => `"${sc.column}"`);
          const separator = cm.concatSeparator || ' ';
          selectColumns.push(`  ${cols.join(` || '${separator}' || `)} AS "${cm.target.column}"`);
        } else {
          selectColumns.push(`  NULL AS "${cm.target.column}"`);
        }
        break;
      
      case 'LOOKUP':
        if (cm.lookup && cm.source) {
          selectColumns.push(`  (SELECT "${cm.lookup.returnColumn}" FROM "${cm.lookup.table}" WHERE "${cm.lookup.matchColumn}" = s."${cm.source.column}" LIMIT 1) AS "${cm.target.column}"`);
        } else {
          selectColumns.push(`  NULL AS "${cm.target.column}"`);
        }
        break;
      
      default:
        selectColumns.push(`  NULL AS "${cm.target.column}"`);
    }
  }

  // Build final SQL
  let sql = `-- Migration: ${sourceTable} → ${targetTable}\n`;
  sql += `-- Columns: ${mapping.columnMappings.length}\n\n`;
  sql += `INSERT INTO "${targetTable}" (\n  ${targetColumns.join(',\n  ')}\n)\n`;
  sql += `SELECT\n${selectColumns.join(',\n')}\n`;
  sql += `FROM "${sourceTable}" s;`;

  return sql;
}

/** Escape a string for embedding in a Python double-quoted literal. */
function pyStr(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Generate a runnable Python (pandas + SQLAlchemy) script that performs the same
 * column mapping as the SQL preview. Read-only preview — the user wires up their
 * own connection URLs and runs it standalone.
 */
export function generatePythonPreview(mapping: TableMapping): string {
  if (!mapping || mapping.columnMappings.length === 0) {
    return '# No column mappings defined';
  }

  const sourceTable = getSourceTablesFromMapping(mapping)[0] || 'source_table';
  const targetTable = getTargetTablesFromMapping(mapping)[0] || 'target_table';

  // One assignment line per target column, mirroring generateSqlPreview's switch.
  const lines: string[] = [];
  for (const cm of mapping.columnMappings) {
    const tgt = `out[${pyStr(cm.target.column)}]`;
    let expr = 'None';

    switch (cm.mappingType) {
      case 'DIRECT':
        expr = cm.source ? `src[${pyStr(cm.source.column)}]` : 'None';
        break;

      case 'CONSTANT': {
        const v = cm.constantValue;
        if (typeof v === 'string') expr = pyStr(v);
        else if (typeof v === 'boolean') expr = v ? 'True' : 'False';
        else if (v !== null && v !== undefined) expr = String(v);
        else expr = 'None';
        break;
      }

      case 'TRANSFORM':
        if (cm.sourceColumns && cm.sourceColumns.length > 0 && cm.transformation) {
          const s = `src[${pyStr(cm.sourceColumns[0].column)}]`;
          switch (cm.transformation.type) {
            case 'UPPER': expr = `${s}.astype(str).str.upper()`; break;
            case 'LOWER': expr = `${s}.astype(str).str.lower()`; break;
            case 'TRIM': expr = `${s}.astype(str).str.strip()`; break;
            case 'DATE_FORMAT': expr = `pd.to_datetime(${s}).dt.strftime("%Y-%m-%d")`; break;
            case 'COALESCE': expr = `${s}.fillna("")`; break;
            default: expr = s;
          }
        }
        break;

      case 'CONCAT':
        if (cm.sourceColumns && cm.sourceColumns.length > 0) {
          const sep = (cm as ColumnMapping & { concatSeparator?: string }).concatSeparator || ' ';
          expr = cm.sourceColumns
            .map((sc) => `${`src[${pyStr(sc.column)}]`}.astype(str)`)
            .join(` + ${pyStr(sep)} + `);
        }
        break;

      case 'LOOKUP':
        // Lookups need a join — emit a clearly-marked placeholder rather than guess.
        lines.push(`# TODO: LOOKUP for ${cm.target.column} — merge with the lookup table manually`);
        expr = 'None';
        break;

      default:
        expr = 'None';
    }

    lines.push(`${tgt} = ${expr}`);
  }

  return [
    `# Migration: ${sourceTable} → ${targetTable}`,
    `# Columns: ${mapping.columnMappings.length}`,
    `# Preview only — fill in the connection URLs and run with: pip install pandas sqlalchemy`,
    '',
    'import pandas as pd',
    'from sqlalchemy import create_engine',
    '',
    'SOURCE_URL = "postgresql+psycopg2://user:pass@host:5432/source_db"',
    'TARGET_URL = "postgresql+psycopg2://user:pass@host:5432/target_db"',
    '',
    'source_engine = create_engine(SOURCE_URL)',
    'target_engine = create_engine(TARGET_URL)',
    '',
    `# Read the source table`,
    `src = pd.read_sql('SELECT * FROM "${sourceTable}"', source_engine)`,
    '',
    `# Build the target frame by applying each column mapping`,
    'out = pd.DataFrame(index=src.index)',
    ...lines,
    '',
    `# Append into the target table (use if_exists="replace" to overwrite)`,
    `out.to_sql("${targetTable}", target_engine, if_exists="append", index=False)`,
    `print(f"Migrated {len(out)} rows: ${sourceTable} -> ${targetTable}")`,
  ].join('\n');
}
