import { describe, it, expect } from 'vitest';
import {
  applyConfigDefaults,
  configurationChecksum,
  normalizeSnapshot,
  validateConfigJson,
  SNAPSHOT_VERSION,
  DEFAULT_RUN_OPTIONS,
} from './configShape';

/**
 * A configuration snapshot must be enough on its own to reproduce a migration,
 * and editing one must never mutate an earlier version. These tests cover the
 * two properties that rest on:
 *
 *  1. Backward compatibility — configurations already in the database carry
 *     only { version, tableMappings } and must keep loading.
 *  2. Change detection — the checksum must be blind to churn that does not
 *     change what runs, and sensitive to everything that does. Getting this
 *     wrong either buries real edits or manufactures duplicate versions.
 */

/** Just enough of the browser mapping shape for these tests to edit it. */
interface TestColumnMapping {
  id?: string;
  source?: { column: string };
  target?: { column: string };
  encrypt?: boolean;
}
interface TestTableMapping {
  id?: string;
  description?: string;
  sourceTables: string[];
  targetTables: string[];
  columnMappings: TestColumnMapping[];
}

/** A minimal but complete snapshot. */
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    version: 1,
    connections: {
      source: { connectionId: 10, dbType: 'mysql' },
      target: { connectionId: 20, dbType: 'postgresql' },
    },
    schemaSnapshots: { sourceId: 12, targetId: 13 },
    selectedTables: ['student', 'course'],
    tableMappings: [
      {
        id: 'uuid-a',
        sourceTables: ['students'],
        targetTables: ['student'],
        columnMappings: [
          { id: 'uuid-c1', source: { column: 'student_id' }, target: { column: 'id' } },
        ],
      },
      {
        id: 'uuid-b',
        sourceTables: ['courses'],
        targetTables: ['course'],
        columnMappings: [{ id: 'uuid-c2', source: { column: 'code' }, target: { column: 'code' } }],
      },
    ],
    mappingOrder: ['student', 'course'],
    customDependencies: [{ from: 'course', to: 'student' }],
    runOptions: { useCopy: true, force: false, batchSize: 2000 },
    ...overrides,
  };
}

describe('applyConfigDefaults — legacy configurations keep working', () => {
  // This is the exact shape of the configurations already saved in the
  // database, written before any of the snapshot sections existed.
  const legacy = {
    version: 1,
    tableMappings: [
      { sourceTable: 'a', targetTable: 'b', columnMappings: [{ source: 'x', target: 'y' }] },
    ],
  };

  it('fills every new section with a safe default', () => {
    const filled = applyConfigDefaults(legacy);
    expect(filled.connections).toEqual({
      source: { connectionId: null, dbType: null },
      target: { connectionId: null, dbType: null },
    });
    expect(filled.schemaSnapshots).toEqual({ sourceId: null, targetId: null });
    expect(filled.selectedTables).toEqual([]);
    expect(filled.mappingOrder).toEqual([]);
    expect(filled.customDependencies).toEqual([]);
    expect(filled.runOptions).toEqual(DEFAULT_RUN_OPTIONS);
  });

  it('marks a legacy config as snapshot shape 1', () => {
    expect(applyConfigDefaults(legacy).snapshotVersion).toBe(1);
    expect(applyConfigDefaults(snapshot()).snapshotVersion).toBe(SNAPSHOT_VERSION);
  });

  it('leaves the existing tableMappings untouched', () => {
    expect(applyConfigDefaults(legacy).tableMappings).toEqual(legacy.tableMappings);
  });

  it('does not mutate its input', () => {
    const input = { ...legacy };
    applyConfigDefaults(input);
    expect('connections' in input).toBe(false);
  });

  it('defaults an empty config rather than throwing', () => {
    const filled = applyConfigDefaults({});
    expect(filled.version).toBe(1);
    expect(filled.tableMappings).toEqual([]);
    expect(filled.runOptions.batchSize).toBe(2000);
  });

  it('discards a garbage connection id instead of trusting it', () => {
    const filled = applyConfigDefaults({
      tableMappings: [],
      connections: { source: { connectionId: 'nonsense', dbType: 'oracle' }, target: {} },
    });
    expect(filled.connections.source).toEqual({ connectionId: null, dbType: null });
  });

  it('preserves an explicit useCopy: false', () => {
    // `false` must survive; only an absent value gets the default of true.
    const filled = applyConfigDefaults({ tableMappings: [], runOptions: { useCopy: false } });
    expect(filled.runOptions.useCopy).toBe(false);
  });
});

describe('configurationChecksum — blind to churn', () => {
  it('ignores key order', () => {
    // Rebuild every object with its keys reversed. JSON.stringify would produce
    // a different string; the checksum must not.
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value === null || typeof value !== 'object') return value;
      const entries = Object.entries(value as Record<string, unknown>).reverse();
      return Object.fromEntries(entries.map(([k, v]) => [k, reverseKeys(v)]));
    };

    const original = snapshot();
    const reordered = reverseKeys(original) as Record<string, unknown>;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(original)); // the test is real
    expect(configurationChecksum(reordered)).toBe(configurationChecksum(original));
  });

  it('ignores per-mapping UUIDs', () => {
    // The UI regenerates ids when mappings are re-applied; that is not an edit.
    const base = snapshot();
    const reIded = snapshot({
      tableMappings: (base.tableMappings as TestTableMapping[]).map((tm, i) => ({
        ...tm,
        id: `regenerated-${i}`,
        columnMappings: tm.columnMappings.map((cm: TestColumnMapping) => ({ ...cm, id: 'regenerated' })),
      })),
    });
    expect(configurationChecksum(reIded)).toBe(configurationChecksum(base));
  });

  it('ignores a decorative description', () => {
    const withDescription = snapshot({
      tableMappings: (snapshot().tableMappings as TestTableMapping[]).map((tm) => ({
        ...tm,
        description: 'Auto-generated mapping (high confidence, 87% match)',
      })),
    });
    expect(configurationChecksum(withDescription)).toBe(configurationChecksum(snapshot()));
  });

  it('ignores the order of selectedTables', () => {
    expect(configurationChecksum(snapshot({ selectedTables: ['course', 'student'] }))).toBe(
      configurationChecksum(snapshot({ selectedTables: ['student', 'course'] })),
    );
  });

  it('treats a legacy config and its defaulted form as identical', () => {
    const legacy = { version: 1, tableMappings: snapshot().tableMappings };
    expect(configurationChecksum(applyConfigDefaults(legacy))).toBe(configurationChecksum(legacy));
  });
});

describe('configurationChecksum — sensitive to every real change', () => {
  const base = configurationChecksum(snapshot());

  const changes: Array<[string, Record<string, unknown>]> = [
    ['source connection', { connections: { ...snapshot().connections, source: { connectionId: 99, dbType: 'mysql' } } }],
    ['target connection', { connections: { ...snapshot().connections, target: { connectionId: 99, dbType: 'postgresql' } } }],
    ['source schema snapshot', { schemaSnapshots: { sourceId: 999, targetId: 13 } }],
    ['selected tables', { selectedTables: ['student'] }],
    ['mapping order', { mappingOrder: ['course', 'student'] }],
    ['custom dependencies', { customDependencies: [] }],
    ['useCopy', { runOptions: { useCopy: false, force: false, batchSize: 2000 } }],
    ['force', { runOptions: { useCopy: true, force: true, batchSize: 2000 } }],
    ['batchSize', { runOptions: { useCopy: true, force: false, batchSize: 5000 } }],
  ];

  for (const [what, override] of changes) {
    it(`changes when ${what} changes`, () => {
      expect(configurationChecksum(snapshot(override))).not.toBe(base);
    });
  }

  it('changes when a column mapping target changes', () => {
    const edited = snapshot();
    (edited.tableMappings as TestTableMapping[])[0].columnMappings[0].target = { column: 'student_id' };
    expect(configurationChecksum(edited)).not.toBe(base);
  });

  it('changes when a table mapping is removed', () => {
    expect(configurationChecksum(snapshot({ tableMappings: [snapshot().tableMappings[0]] }))).not.toBe(
      base,
    );
  });

  it('changes when a per-column flag is set', () => {
    const edited = snapshot();
    (edited.tableMappings as TestTableMapping[])[0].columnMappings[0].encrypt = true;
    expect(configurationChecksum(edited)).not.toBe(base);
  });

  it('mappingOrder is order-sensitive — there, order IS the value', () => {
    expect(configurationChecksum(snapshot({ mappingOrder: ['course', 'student'] }))).not.toBe(
      configurationChecksum(snapshot({ mappingOrder: ['student', 'course'] })),
    );
  });
});

describe('normalizeSnapshot', () => {
  it('exposes the engine-shape mappings, not the browser shape', () => {
    const normalized = normalizeSnapshot(snapshot()) as { tableMappings: Array<Record<string, unknown>> };
    expect(normalized.tableMappings[0].sourceTable).toBe('students');
    expect(normalized.tableMappings[0].targetTable).toBe('student');
    expect('sourceTables' in normalized.tableMappings[0]).toBe(false);
  });

  it('survives null and junk', () => {
    expect(() => normalizeSnapshot(null)).not.toThrow();
    expect(() => normalizeSnapshot({ tableMappings: 'nope' })).not.toThrow();
  });
});

describe('validateConfigJson — snapshot sections', () => {
  it('accepts a complete snapshot', () => {
    expect(validateConfigJson(snapshot())).toEqual([]);
  });

  it('accepts a legacy configuration with no snapshot sections', () => {
    expect(
      validateConfigJson({
        version: 1,
        tableMappings: [
          { sourceTable: 'a', targetTable: 'b', columnMappings: [{ source: 'x', target: 'y' }] },
        ],
      }),
    ).toEqual([]);
  });

  it('rejects a mappingOrder naming a table that is not mapped', () => {
    const errors = validateConfigJson(snapshot({ mappingOrder: ['student', 'ghost_table'] }));
    expect(errors.some((e) => e.includes('ghost_table'))).toBe(true);
  });

  it('rejects a selectedTables entry that is not mapped', () => {
    const errors = validateConfigJson(snapshot({ selectedTables: ['not_a_table'] }));
    expect(errors.some((e) => e.includes('not_a_table'))).toBe(true);
  });

  it('rejects duplicates in mappingOrder', () => {
    const errors = validateConfigJson(snapshot({ mappingOrder: ['student', 'student'] }));
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects a non-integer or out-of-range batchSize', () => {
    expect(
      validateConfigJson(snapshot({ runOptions: { useCopy: true, force: false, batchSize: 0 } })),
    ).toHaveLength(1);
    expect(
      validateConfigJson(snapshot({ runOptions: { useCopy: true, force: false, batchSize: 999_999 } })),
    ).toHaveLength(1);
  });

  it('rejects a connection dialect with no data-movement adapter', () => {
    const errors = validateConfigJson(
      snapshot({
        connections: { source: { connectionId: 1, dbType: 'hive' }, target: { connectionId: 2, dbType: 'postgresql' } },
      }),
    );
    expect(errors.some((e) => e.includes('mysql'))).toBe(true);
  });

  it('still refuses a snapshot carrying a credential', () => {
    const errors = validateConfigJson(snapshot({ encryptionKey: 'super-secret' }));
    expect(errors.some((e) => e.includes('credential'))).toBe(true);
  });
});
