import type { DatabaseSchema, Table, Column } from '../types/schema.types';

const schemaName = 'public';

/** Map generic/info_schema types to PostgreSQL DDL type names (e.g. int8, bool). */
function toPgDdlType(type: string): string {
  const u = (type || '').toLowerCase().trim();
  if (u === 'integer' || u === 'int' || u === 'int4') return 'int4';
  if (u === 'bigint' || u === 'int8') return 'int8';
  if (u === 'smallint' || u === 'int2') return 'int2';
  if (u === 'boolean' || u === 'bool') return 'bool';
  if (u === 'timestamp with time zone' || u === 'timestamptz') return 'timestamptz';
  if (u === 'timestamp without time zone' || u === 'timestamp') return 'timestamp';
  if (u.startsWith('character varying') || u.startsWith('varchar')) return u; // keep varchar(n)
  if (u.startsWith('character(') || u.startsWith('char(')) return u;
  if (u === 'character' || u === 'char') return 'char(1)';
  return type || 'text';
}

/** Escape identifier for PostgreSQL (simple: only quote if needed). */
function quoteId(name: string): string {
  if (/^[a-z_][a-z0-9_]*$/i.test(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Generate PostgreSQL CREATE TABLE DDL for one table.
 * Format: CREATE TABLE public.name ( col defs, CONSTRAINT ... PRIMARY KEY, CONSTRAINT ... FOREIGN KEY ... );
 */
function tableToDdl(table: Table): string {
  const parts: string[] = [];

  for (const c of table.columns) {
    const pgType = toPgDdlType(c.type);
    const nullClause = c.nullable === false ? ' NOT NULL' : ' NULL';
    parts.push(`\t${quoteId(c.name)} ${pgType}${nullClause}`);
  }

  const pkCols = table.primaryKeyColumns?.length
    ? table.primaryKeyColumns
    : table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  if (pkCols.length > 0) {
    parts.push(`\tCONSTRAINT ${quoteId(table.name + '_pkey')} PRIMARY KEY (${pkCols.map(quoteId).join(', ')})`);
  }

  for (const c of table.columns) {
    if (!c.isForeignKey || !c.foreignKeyRef) continue;
    const ref = c.foreignKeyRef;
    const fkName = `fk_${table.name}_${c.name}`;
    parts.push(
      `\tCONSTRAINT ${quoteId(fkName)} FOREIGN KEY (${quoteId(c.name)}) REFERENCES ${schemaName}.${quoteId(ref.table)}(${quoteId(ref.column)})`
    );
  }

  return `CREATE TABLE ${schemaName}.${quoteId(table.name)} (\n${parts.join(',\n')}\n);`;
}

/**
 * Convert a DatabaseSchema to PostgreSQL DDL (CREATE TABLE statements).
 * Use for displaying fetched schema as executable DDL.
 */
export function schemaToPostgresDdl(schema: DatabaseSchema): string {
  return schema.tables.map((t) => tableToDdl(t)).join('\n\n');
}
