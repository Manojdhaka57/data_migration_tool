/**
 * Bidirectional column-type mapping between MySQL and PostgreSQL.
 *
 * Source type strings arrive dialect-specific:
 *   - MySQL  COLUMN_TYPE: "int(11)", "bigint(20) unsigned", "tinyint(1)",
 *            "varchar(150)", "decimal(10,2)", "datetime", "longtext",
 *            "double", "enum('a','b')", "json"
 *   - Postgres (already normalized by the adapter): "integer", "bigint",
 *            "boolean", "varchar(150)", "numeric(10,2)", "timestamp",
 *            "text", "jsonb", "double precision"
 *
 * The mapper parses a source type into a small canonical descriptor and then
 * emits a valid type string for the target dialect. When source and target
 * dialects are the same it short-circuits and returns the type unchanged, so
 * existing single-dialect DDL is byte-for-byte identical (zero regression).
 *
 * It is intentionally pragmatic, not exhaustive: enum/set collapse to
 * varchar(255), timezone types collapse to MySQL DATETIME, and anything
 * unrecognized falls back to TEXT.
 */

export type Dialect = 'mysql' | 'postgresql';

/** Canonical, dialect-neutral description of a column type. */
interface TypeDescriptor {
  base: CanonicalBase;
  length?: number; // varchar/char length
  precision?: number; // decimal precision
  scale?: number; // decimal scale
}

type CanonicalBase =
  | 'bool'
  | 'tinyint'
  | 'smallint'
  | 'int'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'double'
  | 'varchar'
  | 'char'
  | 'text'
  | 'enum'
  | 'json'
  | 'date'
  | 'time'
  | 'datetime'
  | 'timestamptz'
  | 'uuid'
  | 'binary'
  | 'unknown';

/**
 * Translate a source column DEFAULT expression into one that's valid for the target
 * dialect, or null when it can't be ported safely (so the caller emits no default).
 *
 *  - Same dialect → the stored expression is already valid, returned as-is.
 *  - Cross dialect → only clearly-portable forms (numbers, booleans, CURRENT_TIMESTAMP,
 *    and quoted string literals) are translated; functions/expressions are skipped.
 *  - Sequence defaults (nextval(...)) are skipped — those are handled as identity.
 */
export function portableDefault(
  rawDefault: string | null | undefined,
  sourceDialect: Dialect,
  targetDialect: Dialect
): string | null {
  if (rawDefault == null) return null;
  const d = String(rawDefault).trim();
  if (!d) return null;
  const lower = d.toLowerCase();

  if (lower.includes('nextval(')) return null; // auto-increment, not a plain default

  if (sourceDialect === targetDialect) return d;

  if (lower === 'now()' || lower.startsWith('current_timestamp')) return 'CURRENT_TIMESTAMP';
  if (/^-?\d+(\.\d+)?$/.test(d)) return d;
  if (lower === 'true' || lower === 'false') {
    return targetDialect === 'mysql' ? (lower === 'true' ? '1' : '0') : lower;
  }
  // Quoted string literal, optionally with a Postgres ::type cast — keep just the literal.
  const m = d.match(/^'((?:[^']|'')*)'(::[\w ]+)?$/);
  if (m) return `'${m[1]}'`;

  return null; // unknown function/expression — safer to skip than emit invalid DDL
}

/**
 * Map a column type from one dialect to a valid column type in another.
 * Same-dialect calls return the original type (trimmed) unchanged.
 */
export function mapColumnType(
  sourceType: string,
  sourceDialect: Dialect,
  targetDialect: Dialect
): string {
  const raw = (sourceType ?? '').trim();
  if (!raw) return targetDialect === 'mysql' ? 'TEXT' : 'TEXT';

  // Same dialect: preserve exactly what the source DB reported.
  if (sourceDialect === targetDialect) return raw;

  const descriptor = parseType(raw);
  return targetDialect === 'postgresql'
    ? emitPostgres(descriptor)
    : emitMysql(descriptor);
}

/** Parse a raw dialect type string into the canonical descriptor. */
function parseType(rawInput: string): TypeDescriptor {
  let raw = rawInput.toLowerCase().trim();

  // Strip MySQL "unsigned"/"zerofill" qualifiers — no Postgres equivalent and
  // dropping them avoids signed/unsigned FK mismatches.
  raw = raw.replace(/\s+unsigned/g, '').replace(/\s+zerofill/g, '').trim();

  // Collapse common multi-word Postgres spellings to single tokens first.
  if (raw === 'character varying' || raw.startsWith('character varying(')) {
    raw = raw.replace('character varying', 'varchar');
  }
  if (raw === 'character' || raw.startsWith('character(')) {
    raw = raw.replace('character', 'char');
  }
  if (raw.startsWith('timestamp with time zone') || raw === 'timestamptz') {
    return { base: 'timestamptz' };
  }
  if (raw.startsWith('timestamp without time zone') || raw.startsWith('timestamp')) {
    return { base: 'datetime' };
  }
  if (raw === 'double precision') return { base: 'double' };

  // Extract parenthesized args: one → length, two → precision,scale.
  const argMatch = raw.match(/\(([^)]*)\)/);
  let length: number | undefined;
  let precision: number | undefined;
  let scale: number | undefined;
  if (argMatch) {
    const parts = argMatch[1].split(',').map((p) => p.trim());
    if (parts.length === 1 && /^\d+$/.test(parts[0])) {
      length = parseInt(parts[0], 10);
    } else if (parts.length === 2 && /^\d+$/.test(parts[0])) {
      precision = parseInt(parts[0], 10);
      scale = /^\d+$/.test(parts[1]) ? parseInt(parts[1], 10) : 0;
    }
  }

  const base = raw.replace(/\(.*\)/, '').trim();

  // MySQL boolean idiom.
  if (base === 'tinyint' && length === 1) return { base: 'bool' };

  switch (base) {
    case 'bool':
    case 'boolean':
    case 'bit':
      return { base: 'bool' };
    case 'tinyint':
      return { base: 'tinyint' };
    case 'smallint':
    case 'int2':
    case 'mediumint':
      return { base: 'smallint' };
    case 'int':
    case 'integer':
    case 'int4':
      return { base: 'int' };
    case 'bigint':
    case 'int8':
    case 'serial':
    case 'bigserial':
      return { base: 'bigint' };
    case 'decimal':
    case 'numeric':
    case 'number':
      return { base: 'decimal', precision, scale };
    case 'float':
    case 'real':
    case 'float4':
      return { base: 'float' };
    case 'double':
    case 'float8':
      return { base: 'double' };
    case 'varchar':
    case 'nvarchar':
    case 'character varying':
      return { base: 'varchar', length };
    case 'char':
    case 'nchar':
    case 'bpchar':
      return { base: 'char', length };
    case 'text':
    case 'tinytext':
    case 'mediumtext':
    case 'longtext':
    case 'clob':
    case 'string':
      return { base: 'text' };
    case 'enum':
    case 'set':
      return { base: 'enum' };
    case 'json':
    case 'jsonb':
      return { base: 'json' };
    case 'date':
      return { base: 'date' };
    case 'time':
      return { base: 'time' };
    case 'datetime':
      return { base: 'datetime' };
    case 'uuid':
      return { base: 'uuid' };
    case 'blob':
    case 'tinyblob':
    case 'mediumblob':
    case 'longblob':
    case 'binary':
    case 'varbinary':
    case 'bytea':
      return { base: 'binary' };
    default:
      return { base: 'unknown' };
  }
}

function emitPostgres(d: TypeDescriptor): string {
  switch (d.base) {
    case 'bool':
      return 'BOOLEAN';
    case 'tinyint':
    case 'smallint':
      return 'SMALLINT';
    case 'int':
      return 'INTEGER';
    case 'bigint':
      return 'BIGINT';
    case 'decimal':
      return d.precision != null
        ? `NUMERIC(${d.precision},${d.scale ?? 0})`
        : 'NUMERIC';
    case 'float':
      return 'REAL';
    case 'double':
      return 'DOUBLE PRECISION';
    case 'varchar':
      return `VARCHAR(${d.length && d.length > 0 ? d.length : 255})`;
    case 'char':
      return `CHAR(${d.length && d.length > 0 ? d.length : 1})`;
    case 'text':
      return 'TEXT';
    case 'enum':
      return 'VARCHAR(255)';
    case 'json':
      return 'JSONB';
    case 'date':
      return 'DATE';
    case 'time':
      return 'TIME';
    case 'datetime':
      return 'TIMESTAMP';
    case 'timestamptz':
      return 'TIMESTAMPTZ';
    case 'uuid':
      return 'UUID';
    case 'binary':
      return 'BYTEA';
    case 'unknown':
    default:
      return 'TEXT';
  }
}

function emitMysql(d: TypeDescriptor): string {
  switch (d.base) {
    case 'bool':
      return 'TINYINT(1)';
    case 'tinyint':
      return 'TINYINT';
    case 'smallint':
      return 'SMALLINT';
    case 'int':
      return 'INT';
    case 'bigint':
      return 'BIGINT';
    case 'decimal':
      return d.precision != null
        ? `DECIMAL(${d.precision},${d.scale ?? 0})`
        : 'DECIMAL(10,0)';
    case 'float':
      return 'FLOAT';
    case 'double':
      return 'DOUBLE';
    case 'varchar':
      return `VARCHAR(${d.length && d.length > 0 ? d.length : 255})`;
    case 'char':
      return `CHAR(${d.length && d.length > 0 ? d.length : 1})`;
    case 'text':
      return 'LONGTEXT';
    case 'enum':
      return 'VARCHAR(255)';
    case 'json':
      return 'JSON';
    case 'date':
      return 'DATE';
    case 'time':
      return 'TIME';
    case 'datetime':
    case 'timestamptz':
      return 'DATETIME'; // MySQL has no timezone-aware type
    case 'uuid':
      return 'CHAR(36)';
    case 'binary':
      return 'LONGBLOB';
    case 'unknown':
    default:
      return 'TEXT';
  }
}
