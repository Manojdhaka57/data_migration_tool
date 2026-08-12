import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { schemaChecksum, countSchema, validateDatabaseSchema } from './schemaSnapshot';
import type { DatabaseSchema } from '../migration/types';

const schema = (overrides: Partial<DatabaseSchema> = {}): DatabaseSchema => ({
  database: 'university',
  tables: [
    {
      name: 'students',
      columns: [
        { name: 'id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'varchar(255)', nullable: true },
      ],
    },
    { name: 'courses', columns: [{ name: 'code', type: 'varchar(20)', nullable: false }] },
  ],
  ...overrides,
});

describe('schemaChecksum', () => {
  it('is invariant to key order', () => {
    // Two reads of the same database can serialize keys differently; if that
    // changed the checksum, every capture would store a fresh 78 KB copy.
    const reversed = JSON.parse(
      JSON.stringify({
        tables: schema().tables.map((t) => ({ columns: t.columns, name: t.name })),
        database: 'university',
      }),
    );
    expect(schemaChecksum(reversed)).toBe(schemaChecksum(schema()));
  });

  it('changes when a column is added', () => {
    const extra = schema();
    extra.tables[0].columns.push({ name: 'email', type: 'varchar(255)', nullable: true });
    expect(schemaChecksum(extra)).not.toBe(schemaChecksum(schema()));
  });

  it('changes when a column type changes', () => {
    const retyped = schema();
    retyped.tables[0].columns[1].type = 'text';
    expect(schemaChecksum(retyped)).not.toBe(schemaChecksum(schema()));
  });

  it('changes when a table is removed', () => {
    expect(schemaChecksum(schema({ tables: [schema().tables[0]] }))).not.toBe(
      schemaChecksum(schema()),
    );
  });

  it('is order-sensitive for tables — order is user-visible', () => {
    const swapped = schema({ tables: [schema().tables[1], schema().tables[0]] });
    expect(schemaChecksum(swapped)).not.toBe(schemaChecksum(schema()));
  });
});

describe('countSchema', () => {
  it('counts tables and columns', () => {
    expect(countSchema(schema())).toEqual({ tableCount: 2, columnCount: 3 });
  });

  it('tolerates a table with no columns array', () => {
    const broken = { database: 'x', tables: [{ name: 'a' }] } as unknown as DatabaseSchema;
    expect(countSchema(broken)).toEqual({ tableCount: 1, columnCount: 0 });
  });

  it('matches the real bundled source schema', () => {
    // Regression anchor: this is the schema the tool actually ships with.
    const real = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../src/data/sourceSchema.json', import.meta.url)), 'utf8'),
    );
    const counts = countSchema(real);
    expect(counts.tableCount).toBeGreaterThan(0);
    expect(counts.columnCount).toBeGreaterThan(counts.tableCount);
  });
});

describe('validateDatabaseSchema', () => {
  it('accepts a well-formed schema', () => {
    expect(validateDatabaseSchema(schema())).toEqual([]);
  });

  it('accepts the real bundled schemas', () => {
    for (const file of ['sourceSchema.json', 'targetSchema.json']) {
      const real = JSON.parse(
        readFileSync(fileURLToPath(new URL(`../../src/data/${file}`, import.meta.url)), 'utf8'),
      );
      expect(validateDatabaseSchema(real)).toEqual([]);
    }
  });

  it('rejects a non-object', () => {
    expect(validateDatabaseSchema(null)).toHaveLength(1);
    expect(validateDatabaseSchema([])).toHaveLength(1);
  });

  it('rejects a missing tables array', () => {
    expect(validateDatabaseSchema({ database: 'x' })[0]).toContain('tables');
  });

  it('rejects a table with no name', () => {
    const errors = validateDatabaseSchema({ database: 'x', tables: [{ columns: [] }] });
    expect(errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('rejects a duplicate table name — it makes drift comparison ambiguous', () => {
    const errors = validateDatabaseSchema({
      database: 'x',
      tables: [
        { name: 'a', columns: [] },
        { name: 'a', columns: [] },
      ],
    });
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects a column with no name', () => {
    const errors = validateDatabaseSchema({
      database: 'x',
      tables: [{ name: 'a', columns: [{ type: 'int' }] }],
    });
    expect(errors.some((e) => e.includes('column with no name'))).toBe(true);
  });
});
