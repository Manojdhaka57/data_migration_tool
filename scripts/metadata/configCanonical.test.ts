import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  toEngineConfig,
  detectConfigShape,
  engineConfigChecksum,
  findCredentialLikeKeys,
  stableStringify,
} from './configShape';

/**
 * These tests exist because a configuration saved from the browser used to be
 * handed to the migration engine unconverted — it validated fine and then
 * migrated with `targetTable: undefined`.
 *
 * toEngineConfig is an exact port of transformMappingForServer() in
 * src/features/migration/MigrationPage.tsx. The fixtures below are the
 * contract between those two implementations: if the browser's translator
 * changes, one of these fails. Do not "fix" a failure by loosening the
 * expectation — port the change.
 */

/** Convenience: canonicalize a single table mapping and return it. */
function one(mapping: unknown) {
  const { config } = toEngineConfig({ tableMappings: [mapping] });
  return config.tableMappings[0];
}

describe('toEngineTableMapping — the eight browser transformations', () => {
  it('1. takes the first entry of sourceTables/targetTables', () => {
    expect(
      one({
        sourceTables: ['students', 'ignored'],
        targetTables: ['opportunities'],
        columnMappings: [{ source: { column: 'lead_id' }, target: { column: 'id' } }],
      }),
    ).toMatchObject({ sourceTable: 'students', targetTable: 'opportunities' });
  });

  it('2. qualifies column refs as table.column ONLY when joins are present', () => {
    const withoutJoins = one({
      sourceTables: ['students'],
      targetTables: ['opportunities'],
      columnMappings: [{ source: { table: 'students', column: 'lead_id' }, target: { column: 'id' } }],
    });
    expect(withoutJoins.columnMappings[0].source).toBe('lead_id');

    const withJoins = one({
      sourceTables: ['students'],
      targetTables: ['opportunities'],
      joins: [{ table: 'leads', type: 'LEFT', leftColumn: 'students.lead_id', rightColumn: 'id' }],
      columnMappings: [{ source: { table: 'students', column: 'lead_id' }, target: { column: 'id' } }],
    });
    expect(withJoins.columnMappings[0].source).toBe('students.lead_id');
  });

  it('3. TRANSFORM and CONCAT read their input from sourceColumns[0]', () => {
    for (const mappingType of ['TRANSFORM', 'CONCAT']) {
      const result = one({
        sourceTable: 's',
        targetTable: 't',
        columnMappings: [
          {
            mappingType,
            target: { column: 'full_name' },
            sourceColumns: [{ column: 'first_name' }, { column: 'last_name' }],
            transformation: { type: 'UPPER' },
          },
        ],
      });
      expect(result.columnMappings[0].source).toBe('first_name');
    }
  });

  it('4. CUSTOM and BUILD_JSON transforms point source at the __expr_ alias', () => {
    for (const type of ['CUSTOM', 'BUILD_JSON']) {
      const result = one({
        sourceTable: 's',
        targetTable: 't',
        columnMappings: [
          {
            mappingType: 'TRANSFORM',
            target: { column: 'created_at' },
            sourceColumns: [{ column: 'created' }],
            transformation: { type, params: { expression: 'UNIX_TIMESTAMP(created)' } },
          },
        ],
      });
      // The engine expects the source query to produce this aliased column.
      expect(result.columnMappings[0].source).toBe('__expr_created_at');
    }
  });

  it('5. defaults conflictStrategy to skip, and preserves an explicit one', () => {
    expect(one({ sourceTable: 's', targetTable: 't', columnMappings: [{ source: 'a', target: 'b' }] }))
      .toMatchObject({ conflictStrategy: 'skip' });

    expect(
      one({
        sourceTable: 's',
        targetTable: 't',
        conflictStrategy: 'upsert',
        columnMappings: [{ source: 'a', target: 'b' }],
      }),
    ).toMatchObject({ conflictStrategy: 'upsert' });
  });

  it('6. forwards per-column flags only when literally true', () => {
    const result = one({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [
        {
          source: 'a',
          target: 'b',
          convertDateToEpoch: true,
          convertTinyintToBoolean: false,
          zeroToNull: 'yes', // truthy but not `true` — must not be forwarded
          encrypt: true,
          useGroupMin: undefined,
        },
      ],
    });

    const column = result.columnMappings[0];
    expect(column.convertDateToEpoch).toBe(true);
    expect(column.encrypt).toBe(true);
    expect('convertTinyintToBoolean' in column).toBe(false);
    expect('zeroToNull' in column).toBe(false);
    expect('useGroupMin' in column).toBe(false);
  });

  it('7. forwards table-level options only when non-empty', () => {
    const empty = one({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [{ source: 'a', target: 'b' }],
      conflictKeyColumns: [],
      rowFilters: [],
      joins: [],
      groupByColumns: [],
      groupMinColumns: [],
      orderBy: [],
      autoIdColumn: '',
    });
    for (const key of [
      'conflictKeyColumns',
      'rowFilters',
      'joins',
      'groupByColumns',
      'groupMinColumns',
      'orderBy',
      'autoIdColumn',
    ]) {
      expect(key in empty).toBe(false);
    }

    const filled = one({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [{ source: 'a', target: 'b' }],
      conflictKeyColumns: ['id'],
      rowFilters: [{ column: 'status', operator: '=', value: 'ACTIVE' }],
      groupByColumns: ['email'],
      groupByMode: 'dedup',
      groupMinColumns: ['id'],
      orderBy: [{ column: 'id', direction: 'ASC' }],
      autoIdColumn: 'id',
    });
    expect(filled).toMatchObject({
      conflictKeyColumns: ['id'],
      groupByColumns: ['email'],
      groupByMode: 'dedup',
      groupMinColumns: ['id'],
      autoIdColumn: 'id',
    });
  });

  it('8. drops id, description and sourceJoins', () => {
    const result = one({
      id: 'mapping-7',
      description: 'notes for humans',
      sourceJoins: [{ table: 'x', type: 'INNER', leftTable: 's', leftColumn: 'a', rightColumn: 'b' }],
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [{ source: 'a', target: 'b' }],
    });
    expect('id' in result).toBe(false);
    expect('description' in result).toBe(false);
    expect('sourceJoins' in result).toBe(false);
  });
});

describe('toEngineTableMapping — values that must survive', () => {
  it('keeps falsy constantValue (0 and false are real constants)', () => {
    const zero = one({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [{ target: 'flag', mappingType: 'CONSTANT', constantValue: 0 }],
    });
    expect(zero.columnMappings[0].constantValue).toBe(0);

    const no = one({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [{ target: 'flag', mappingType: 'CONSTANT', constantValue: false }],
    });
    expect(no.columnMappings[0].constantValue).toBe(false);
  });

  it('omits constantValue entirely when it was never set', () => {
    const result = one({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [{ source: 'a', target: 'b' }],
    });
    expect('constantValue' in result.columnMappings[0]).toBe(false);
  });

  it('carries the transformation rule — without it a TRANSFORM becomes a plain copy', () => {
    const result = one({
      sourceTable: 's',
      targetTable: 't',
      columnMappings: [
        {
          mappingType: 'TRANSFORM',
          source: 'name',
          target: 'name_upper',
          transformation: { type: 'UPPER', params: { locale: 'en' } },
        },
      ],
    });
    expect(result.columnMappings[0].transformation).toEqual({
      type: 'UPPER',
      params: { locale: 'en' },
    });
  });

  it('defaults mappingType to DIRECT', () => {
    expect(
      one({ sourceTable: 's', targetTable: 't', columnMappings: [{ source: 'a', target: 'b' }] })
        .columnMappings[0].mappingType,
    ).toBe('DIRECT');
  });
});

describe('toEngineConfig — refusing what cannot run', () => {
  it('drops a mapping with no source or target table and says which', () => {
    const { config, dropped } = toEngineConfig({
      tableMappings: [
        { sourceTables: [], targetTables: ['t'], columnMappings: [{ source: 'a', target: 'b' }] },
        { sourceTable: 's', targetTable: 't', columnMappings: [{ source: 'a', target: 'b' }] },
      ],
    });

    // The browser emitted sourceTable: '' here, which becomes FROM "" and fails
    // deep inside the worker. Refusing up front is what makes the error legible.
    expect(config.tableMappings).toHaveLength(1);
    expect(dropped).toEqual([{ index: 0, reason: 'no source table or no target table' }]);
  });

  it('drops a mapping whose columns all lack a target', () => {
    const { config, dropped, warnings } = toEngineConfig({
      tableMappings: [{ sourceTable: 's', targetTable: 't', columnMappings: [{ source: 'a' }] }],
    });

    expect(config.tableMappings).toHaveLength(0);
    expect(dropped[0].reason).toContain('no usable column mappings');
    expect(warnings[0]).toContain('no target column');
  });

  it('warns when a customDependency matches no target table', () => {
    const { warnings, config } = toEngineConfig({
      tableMappings: [{ sourceTable: 's', targetTable: 'opportunities', columnMappings: [{ source: 'a', target: 'b' }] }],
      customDependencies: [
        { from: 'opportunities', to: 'ghost_table' },
        { from: 'opportunities', to: 'opportunities' },
      ],
    });

    // Ordering is keyed on TARGET table names in the worker; a name that matches
    // nothing is a silent no-op, which is how data lands in the wrong order.
    expect(config.customDependencies).toHaveLength(2);
    expect(warnings.filter((w) => w.includes('ghost_table'))).toHaveLength(1);
  });

  it('tolerates junk instead of throwing', () => {
    expect(toEngineConfig(null).config.tableMappings).toEqual([]);
    expect(toEngineConfig({}).config.tableMappings).toEqual([]);
    expect(toEngineConfig({ tableMappings: 'nope' }).config.tableMappings).toEqual([]);
  });
});

describe('toEngineConfig — the fixed-point invariant', () => {
  /**
   * Canonicalization is applied at several layers (API entry, run handler,
   * worker). That is only safe if applying it twice equals applying it once.
   * Note this is NOT identity on first application even for engine input — it
   * fills in conflictStrategy — so the assertion is fixed point, not identity.
   */
  const fixtures: Array<[string, unknown]> = [
    [
      'browser DIRECT',
      {
        tableMappings: [
          {
            sourceTables: ['students'],
            targetTables: ['opportunities'],
            columnMappings: [{ source: { column: 'lead_id' }, target: { column: 'id' } }],
          },
        ],
      },
    ],
    [
      'browser DIRECT with joins (qualified refs)',
      {
        tableMappings: [
          {
            sourceTables: ['students'],
            targetTables: ['opportunities'],
            joins: [{ table: 'leads', type: 'LEFT', leftColumn: 'students.lead_id', rightColumn: 'id' }],
            columnMappings: [
              { source: { table: 'students', column: 'lead_id' }, target: { column: 'id' } },
            ],
          },
        ],
      },
    ],
    [
      'browser TRANSFORM via sourceColumns',
      {
        tableMappings: [
          {
            sourceTables: ['s'],
            targetTables: ['t'],
            columnMappings: [
              {
                mappingType: 'TRANSFORM',
                target: { column: 'name_upper' },
                sourceColumns: [{ column: 'name' }],
                transformation: { type: 'UPPER' },
              },
            ],
          },
        ],
      },
    ],
    [
      'browser CUSTOM expression (__expr_ alias)',
      {
        tableMappings: [
          {
            sourceTables: ['s'],
            targetTables: ['t'],
            columnMappings: [
              {
                mappingType: 'TRANSFORM',
                target: { column: 'created_at' },
                sourceColumns: [{ column: 'created' }],
                transformation: { type: 'CUSTOM', params: { expression: 'UNIX_TIMESTAMP(created)' } },
              },
            ],
          },
        ],
      },
    ],
    [
      'browser CONSTANT with a falsy value',
      {
        tableMappings: [
          {
            sourceTables: ['s'],
            targetTables: ['t'],
            columnMappings: [{ target: { column: 'flag' }, mappingType: 'CONSTANT', constantValue: 0 }],
          },
        ],
      },
    ],
    [
      'engine shape with every table option',
      {
        tableMappings: [
          {
            sourceTable: 's',
            targetTable: 't',
            conflictStrategy: 'upsert',
            conflictKeyColumns: ['id'],
            rowFilters: [{ column: 'status', operator: '=', value: 'ACTIVE' }],
            groupByColumns: ['email'],
            groupByMode: 'dedup',
            groupMinColumns: ['id'],
            orderBy: [{ column: 'id', direction: 'ASC' }],
            autoIdColumn: 'id',
            columnMappings: [{ source: 'a', target: 'b', encrypt: true }],
          },
        ],
        customDependencies: [{ from: 't', to: 't' }],
      },
    ],
  ];

  for (const [name, input] of fixtures) {
    it(`is a fixed point for ${name}`, () => {
      const once = toEngineConfig(input).config;
      // Without this, a canonicalizer that dropped everything would satisfy the
      // fixed point trivially ([] equals []).
      expect(once.tableMappings.length).toBeGreaterThan(0);
      expect(once.tableMappings[0].columnMappings.length).toBeGreaterThan(0);

      const twice = toEngineConfig(once).config;
      expect(twice).toEqual(once);
    });
  }
});

describe('toEngineConfig — golden test over the real bundled config', () => {
  const mappingConfig = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../src/data/mappingConfig.json', import.meta.url)), 'utf8'),
  );

  it('canonicalizes the shipped config without dropping anything', () => {
    const { config, dropped } = toEngineConfig(mappingConfig);

    expect(dropped).toEqual([]);
    expect(config.tableMappings.length).toBe(mappingConfig.tableMappings.length);
  });

  it('gives every table mapping a non-empty source and target table', () => {
    const { config } = toEngineConfig(mappingConfig);
    for (const mapping of config.tableMappings) {
      expect(mapping.sourceTable).toBeTruthy();
      expect(mapping.targetTable).toBeTruthy();
    }
  });

  it('gives every column mapping a string source and target', () => {
    // This is precisely what the raw path failed to guarantee: a browser-shape
    // config reached the worker with object refs and an undefined targetTable.
    const { config } = toEngineConfig(mappingConfig);
    for (const mapping of config.tableMappings) {
      for (const column of mapping.columnMappings) {
        expect(typeof column.source).toBe('string');
        expect(typeof column.target).toBe('string');
        expect(column.target).not.toBe('');
      }
    }
  });

  it('is a fixed point over the real config', () => {
    const once = toEngineConfig(mappingConfig).config;
    expect(toEngineConfig(once).config).toEqual(once);
  });
});

describe('toEngineConfig — golden test over the real browser-shape config', () => {
  // scripts/delta.config.json is a real, in-use config saved from the browser:
  // 4 source tables, 3 joins, upsert, and 14 CUSTOM SQL expressions. Run through
  // the old raw path it reached the worker with targetTable: undefined.
  const delta = JSON.parse(
    readFileSync(fileURLToPath(new URL('../delta.config.json', import.meta.url)), 'utf8'),
  );

  it('is detected as the browser shape', () => {
    expect(detectConfigShape(delta)).toBe('browser');
  });

  it('collapses the source table list to the primary table and keeps the joins', () => {
    const { config, dropped } = toEngineConfig(delta);
    expect(dropped).toEqual([]);

    const mapping = config.tableMappings[0];
    expect(mapping.sourceTable).toBe('students');
    expect(mapping.targetTable).toBe('opportunities');
    expect(mapping.conflictStrategy).toBe('upsert');
    expect(mapping.joins).toHaveLength(3);
  });

  it('qualifies sources as table.column because this mapping has joins', () => {
    const mapping = toEngineConfig(delta).config.tableMappings[0];
    const direct = mapping.columnMappings.find((c) => c.target === 'id')!;
    expect(direct.source).toBe('students.lead_id');
  });

  it('points every CUSTOM transform at its __expr_ alias', () => {
    const mapping = toEngineConfig(delta).config.tableMappings[0];
    const custom = mapping.columnMappings.filter(
      (c) => c.transformation?.type === 'CUSTOM' || c.transformation?.type === 'BUILD_JSON',
    );
    expect(custom.length).toBeGreaterThan(0);
    for (const column of custom) {
      expect(column.source).toBe(`__expr_${column.target}`);
    }
  });

  it('keeps CONSTANT values and drops flags that were false', () => {
    const mapping = toEngineConfig(delta).config.tableMappings[0];
    const constant = mapping.columnMappings.find((c) => c.target === 'active_status')!;
    expect(constant).toMatchObject({ mappingType: 'CONSTANT', constantValue: 'ACTIVE' });
    // The raw config carries convertDateToEpoch/encrypt: false on every column.
    expect('convertDateToEpoch' in constant).toBe(false);
    expect('encrypt' in constant).toBe(false);
  });

  it('leaves every column mapping with flat string source and target', () => {
    const mapping = toEngineConfig(delta).config.tableMappings[0];
    for (const column of mapping.columnMappings) {
      expect(typeof column.source).toBe('string');
      expect(column.target).toBeTruthy();
    }
  });

  it('is a fixed point', () => {
    const once = toEngineConfig(delta).config;
    expect(once.tableMappings.length).toBeGreaterThan(0);
    expect(toEngineConfig(once).config).toEqual(once);
  });
});

describe('detectConfigShape', () => {
  it('recognises the browser shape', () => {
    expect(
      detectConfigShape({
        tableMappings: [{ sourceTables: ['a'], targetTables: ['b'], columnMappings: [] }],
      }),
    ).toBe('browser');
  });

  it('recognises the engine shape', () => {
    expect(
      detectConfigShape({
        tableMappings: [{ sourceTable: 'a', targetTable: 'b', columnMappings: [{ source: 'x', target: 'y' }] }],
      }),
    ).toBe('engine');
  });

  it('recognises nested column refs as the browser shape even with singular tables', () => {
    expect(
      detectConfigShape({
        tableMappings: [
          { sourceTable: 'a', targetTable: 'b', columnMappings: [{ source: { column: 'x' }, target: 'y' }] },
        ],
      }),
    ).toBe('browser');
  });

  it('reports mixed when a hand-edited export disagrees with itself', () => {
    expect(
      detectConfigShape({
        tableMappings: [
          { sourceTables: ['a'], targetTables: ['b'], columnMappings: [] },
          { sourceTable: 'c', targetTable: 'd', columnMappings: [{ source: 'x', target: 'y' }] },
        ],
      }),
    ).toBe('mixed');
  });

  it('reports empty for nothing to run', () => {
    expect(detectConfigShape({ tableMappings: [] })).toBe('empty');
    expect(detectConfigShape(null)).toBe('empty');
  });
});

describe('engineConfigChecksum', () => {
  const base = {
    tableMappings: [
      { sourceTable: 's', targetTable: 't', columnMappings: [{ source: 'a', target: 'b' }] },
    ],
  };

  it('is stable across key order', () => {
    const a = engineConfigChecksum(toEngineConfig(base).config);
    const reordered = toEngineConfig({
      tableMappings: [
        { columnMappings: [{ target: 'b', source: 'a' }], targetTable: 't', sourceTable: 's' },
      ],
    }).config;
    expect(engineConfigChecksum(reordered)).toBe(a);
  });

  it('changes when the config meaningfully changes', () => {
    const a = engineConfigChecksum(toEngineConfig(base).config);
    const b = engineConfigChecksum(
      toEngineConfig({
        tableMappings: [
          { sourceTable: 's', targetTable: 't', columnMappings: [{ source: 'a', target: 'CHANGED' }] },
        ],
      }).config,
    );
    expect(b).not.toBe(a);
  });

  it('stableStringify sorts keys but preserves array order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('findCredentialLikeKeys', () => {
  it('finds a password anywhere in the tree', () => {
    expect(findCredentialLikeKeys({ connection: { password: 'hunter2' } })).toEqual([
      'connection.password',
    ]);
  });

  it('finds credentials nested inside arrays', () => {
    expect(findCredentialLikeKeys({ tableMappings: [{ secret: 'abc' }] })).toEqual([
      'tableMappings[0].secret',
    ]);
  });

  it('does NOT flag a column named passwordColumn', () => {
    // A false positive here blocks a legitimate save, so this matters as much
    // as catching the real thing.
    expect(
      findCredentialLikeKeys({
        tableMappings: [{ columnMappings: [{ source: 'password', target: 'passwordColumn' }] }],
      }),
    ).toEqual([]);
  });

  it('ignores empty and non-string values', () => {
    expect(findCredentialLikeKeys({ password: '' })).toEqual([]);
    expect(findCredentialLikeKeys({ password: null })).toEqual([]);
    expect(findCredentialLikeKeys({ password: false })).toEqual([]);
  });

  it('survives a cyclic object', () => {
    const cyclic: Record<string, unknown> = { password: 'leak' };
    cyclic.self = cyclic;
    expect(findCredentialLikeKeys(cyclic)).toEqual(['password']);
  });
});
