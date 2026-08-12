/**
 * Pure helpers for schema snapshots.
 *
 * A snapshot is the DatabaseSchema a configuration was built against. Keeping
 * it lets the tool answer "has the source changed since this was saved?" —
 * which is impossible today, because every run re-reads the live schema and
 * has nothing to compare it to.
 *
 * No database access here on purpose, so all of it is unit-testable.
 */
import { createHash } from 'node:crypto';
import { stableStringify } from './configShape';
import type { DatabaseSchema } from '../migration/types';

export interface SchemaCounts {
  tableCount: number;
  columnCount: number;
}

/**
 * Structural validation. Returns human-readable errors; empty means usable.
 * Deliberately permissive about extra fields — schemas arrive from live
 * databases, uploaded files and SQL parsing, and each carries a bit more.
 */
export function validateDatabaseSchema(schema: unknown): string[] {
  const errors: string[] = [];

  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return ['schema must be a JSON object'];
  }

  const candidate = schema as { database?: unknown; tables?: unknown };

  if (typeof candidate.database !== 'string' || !candidate.database) {
    errors.push('schema.database must be a non-empty string');
  }
  if (!Array.isArray(candidate.tables)) {
    errors.push('schema.tables must be an array');
    return errors;
  }

  const seen = new Set<string>();
  candidate.tables.forEach((table: unknown, i: number) => {
    if (table === null || typeof table !== 'object') {
      errors.push(`schema.tables[${i}] must be an object`);
      return;
    }
    const t = table as { name?: unknown; columns?: unknown };
    if (typeof t.name !== 'string' || !t.name) {
      errors.push(`schema.tables[${i}].name must be a non-empty string`);
      return;
    }
    // A duplicate table name makes drift comparison ambiguous.
    if (seen.has(t.name)) errors.push(`schema.tables: duplicate table "${t.name}"`);
    seen.add(t.name);

    if (!Array.isArray(t.columns)) {
      errors.push(`schema.tables[${i}] (${t.name}).columns must be an array`);
      return;
    }
    for (const column of t.columns) {
      const name = (column as { name?: unknown } | null)?.name;
      if (typeof name !== 'string' || !name) {
        errors.push(`schema.tables[${i}] (${t.name}) has a column with no name`);
        break; // one message per table is enough
      }
    }
  });

  return errors;
}

export function countSchema(schema: DatabaseSchema): SchemaCounts {
  const tables = Array.isArray(schema?.tables) ? schema.tables : [];
  return {
    tableCount: tables.length,
    columnCount: tables.reduce((sum, t) => sum + (Array.isArray(t?.columns) ? t.columns.length : 0), 0),
  };
}

/**
 * Identity of a schema's *content*.
 *
 * Key-sorted so JSON key-order jitter between two reads of the same database
 * does not defeat deduplication — that would silently store a fresh copy of an
 * unchanged 78 KB schema on every capture.
 *
 * Table and column ORDER is significant: it is user-visible in the UI, and a
 * reordered schema is a schema the user would see differently.
 */
export function schemaChecksum(schema: DatabaseSchema): string {
  return createHash('sha256').update(stableStringify(schema)).digest('hex');
}
