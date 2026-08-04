import type { DatabaseSchema, Table, Column } from '../types/schema.types';

/**
 * Format a single column line for text schema output.
 */
function columnLine(c: Column): string {
  const parts: string[] = [c.name.padEnd(28), (c.type || '').padEnd(20)];
  const nullStr = c.nullable === false ? 'NOT NULL' : 'NULL';
  parts.push(nullStr.padEnd(10));
  if (c.isPrimaryKey) parts.push('PK');
  if (c.isForeignKey && c.foreignKeyRef)
    parts.push(`FK -> ${c.foreignKeyRef.table}(${c.foreignKeyRef.column})`);
  if (c.defaultValue != null && c.defaultValue !== '')
    parts.push(`DEFAULT ${String(c.defaultValue)}`);
  return parts.filter(Boolean).join('  ');
}

/**
 * Format a single table for text schema output.
 */
function tableToText(table: Table): string {
  const lines: string[] = [];
  lines.push(`\n=== ${table.name} ===`);
  if (!table.columns.length) {
    lines.push('  (no columns)');
    return lines.join('\n');
  }
  lines.push('  ' + 'Column'.padEnd(26) + 'Type'.padEnd(20) + 'Nullable '.padEnd(12) + 'Attributes');
  lines.push('  ' + '-'.repeat(70));
  for (const col of table.columns) {
    lines.push('  ' + columnLine(col));
  }
  if (table.primaryKeyColumns && table.primaryKeyColumns.length > 1) {
    lines.push(`  PRIMARY KEY (${table.primaryKeyColumns.join(', ')})`);
  }
  return lines.join('\n');
}

/**
 * Convert a DatabaseSchema to a human-readable text representation.
 * Use for displaying schema from MySQL or PostgreSQL in text format.
 */
export function schemaToText(schema: DatabaseSchema): string {
  const lines: string[] = [];
  lines.push(`Database: ${schema.database}`);
  lines.push(`Tables: ${schema.tables.length}`);
  for (const table of schema.tables) {
    lines.push(tableToText(table));
  }
  return lines.join('\n').trimStart();
}
