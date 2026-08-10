import { describe, it, expect } from 'vitest';
import {
  normalizeTableMapping,
  normalizeTableMappings,
  applyConfigDefaults,
  validateConfigJson,
} from './configShape';

/**
 * Both config shapes are live in this repo and neither may be broken:
 *  - the browser shape (sourceTables[], nested {table,column} refs)
 *  - the engine shape (sourceTable, flat "table.column" strings)
 */

describe('normalizeTableMapping', () => {
  it('reads the browser shape (arrays + nested refs)', () => {
    const result = normalizeTableMapping({
      sourceTables: ['students'],
      targetTables: ['opportunities'],
      columnMappings: [
        { source: { table: 'students', column: 'lead_id' }, target: { table: 'opportunities', column: 'id' } },
      ],
    });

    expect(result).toMatchObject({ sourceTable: 'students', targetTable: 'opportunities' });
    expect(result!.columnMappings[0]).toMatchObject({ source: 'students.lead_id', target: 'id' });
  });

  it('reads the engine shape (singular + flat strings)', () => {
    const result = normalizeTableMapping({
      sourceTable: 'students',
      targetTable: 'opportunities',
      columnMappings: [{ source: 'lead_id', target: 'id', mappingType: 'DIRECT' }],
    });

    expect(result).toMatchObject({ sourceTable: 'students', targetTable: 'opportunities' });
    expect(result!.columnMappings[0]).toMatchObject({ source: 'lead_id', target: 'id' });
  });

  it('keeps the target column bare even when qualified', () => {
    const result = normalizeTableMapping({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [{ source: 'a', target: { table: 't', column: 'b' } }],
    });

    expect(result!.columnMappings[0].target).toBe('b');
  });

  it('takes the transform input from sourceColumns[0] when there is no source', () => {
    const result = normalizeTableMapping({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [
        {
          target: { column: 'created_at' },
          mappingType: 'TRANSFORM',
          sourceColumns: [{ table: 's', column: 'created' }],
          transformation: { type: 'CUSTOM', params: { expression: 'UNIX_TIMESTAMP(created)' } },
        },
      ],
    });

    expect(result!.columnMappings[0]).toMatchObject({
      source: 's.created',
      target: 'created_at',
      transformationType: 'CUSTOM',
      transformationExpression: 'UNIX_TIMESTAMP(created)',
    });
  });

  it('captures CONSTANT mappings that have no source at all', () => {
    const result = normalizeTableMapping({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [{ target: 'active_status', mappingType: 'CONSTANT', constantValue: 'ACTIVE' }],
    });

    expect(result!.columnMappings[0]).toMatchObject({ source: null, target: 'active_status' });
  });

  it('rejects a mapping with no usable table names', () => {
    expect(normalizeTableMapping({ columnMappings: [] })).toBeNull();
    expect(normalizeTableMapping({ sourceTable: 'only_source' })).toBeNull();
  });

  it('skips unusable entries rather than throwing', () => {
    const result = normalizeTableMappings({
      tableMappings: [{ sourceTable: 'a', targetTable: 'b', columnMappings: [] }, { nonsense: true }],
    });

    expect(result).toHaveLength(1);
  });
});

describe('applyConfigDefaults', () => {
  it('defaults a missing version to 1', () => {
    // Real configs on disk predate versioning and have no version field; they
    // must keep loading rather than being rejected.
    expect(applyConfigDefaults({ tableMappings: [] }).version).toBe(1);
  });

  it('preserves an existing version', () => {
    expect(applyConfigDefaults({ version: '1.0.0', tableMappings: [] }).version).toBe('1.0.0');
  });

  it('defaults missing tableMappings to an empty array', () => {
    expect(applyConfigDefaults({}).tableMappings).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = { tableMappings: [] };
    applyConfigDefaults(input);
    expect('version' in input).toBe(false);
  });
});

describe('validateConfigJson', () => {
  it('accepts a well-formed configuration', () => {
    expect(
      validateConfigJson({
        tableMappings: [
          { sourceTable: 'a', targetTable: 'b', columnMappings: [{ source: 'x', target: 'y' }] },
        ],
      }),
    ).toEqual([]);
  });

  it('rejects a non-object', () => {
    expect(validateConfigJson(null)).toHaveLength(1);
    expect(validateConfigJson([])).toHaveLength(1);
  });

  it('rejects a missing tableMappings array', () => {
    expect(validateConfigJson({})[0]).toContain('tableMappings');
  });

  it('flags a table mapping with no columns', () => {
    const errors = validateConfigJson({
      tableMappings: [{ sourceTable: 'a', targetTable: 'b', columnMappings: [] }],
    });
    expect(errors[0]).toContain('no column mappings');
  });
});
