/* eslint-disable @typescript-eslint/no-explicit-any --
 * This module exists to read arbitrary, untyped JSON: mapping configs arrive
 * from the browser, from files on disk written by older versions of the tool,
 * and from API callers. `any` is the honest type for that input. Narrowing
 * happens here — every exported function returns a well-typed result.
 */

/**
 * Normalizes the two mapping-config shapes that exist in this codebase.
 *
 * The browser uses arrays and nested column refs:
 *     { sourceTables: ['students'], targetTables: ['opportunities'],
 *       columnMappings: [{ source: {table,column}, target: {table,column} }] }
 *
 * The migration engine uses singular names and flat strings:
 *     { sourceTable: 'students', targetTable: 'opportunities',
 *       columnMappings: [{ source: 'lead_id', target: 'id' }] }
 *
 * Both are in active use — src/features/migration/MigrationPage.tsx translates
 * one to the other at migrate time, and real config files on disk exist in each
 * form. Rather than pick a winner and break whichever loses, saved
 * configurations keep the caller's JSON verbatim and this module derives a
 * normalized view for the queryable mapping tables.
 */
import { createHash } from 'node:crypto';
import type { TableMapping, ColumnMapping } from '../migration/types';

export interface NormalizedColumnMapping {
  source: string | null;
  target: string;
  mappingType: string;
  transformationType: string | null;
  transformationExpression: string | null;
}

export interface NormalizedTableMapping {
  sourceTable: string;
  targetTable: string;
  mappingType: string;
  columnMappings: NormalizedColumnMapping[];
}

/** Accepts 'students', {table,column}, or {column} and returns a flat name. */
function flattenRef(ref: unknown): string | null {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === 'string') return ref || null;
  if (typeof ref === 'object') {
    const obj = ref as { table?: string; column?: string };
    if (obj.column) return obj.table ? `${obj.table}.${obj.column}` : obj.column;
  }
  return null;
}

/** Bare column name, dropping any table qualifier. */
function bareColumn(ref: string | null): string | null {
  if (!ref) return null;
  const idx = ref.lastIndexOf('.');
  return idx >= 0 ? ref.slice(idx + 1) : ref;
}

function firstOf(value: unknown): string | null {
  if (Array.isArray(value)) return value.length ? String(value[0]) : null;
  if (typeof value === 'string') return value || null;
  return null;
}

export function normalizeColumnMapping(raw: any): NormalizedColumnMapping | null {
  const target = bareColumn(flattenRef(raw?.target));
  if (!target) return null;

  // sourceColumns[0] is how the UI carries the input to a TRANSFORM/CONCAT.
  const source =
    flattenRef(raw?.source) ??
    (Array.isArray(raw?.sourceColumns) ? flattenRef(raw.sourceColumns[0]) : null);

  return {
    source,
    target,
    mappingType: String(raw?.mappingType ?? 'DIRECT'),
    transformationType: raw?.transformation?.type ? String(raw.transformation.type) : null,
    transformationExpression:
      raw?.transformation?.params?.expression != null
        ? String(raw.transformation.params.expression)
        : null,
  };
}

export function normalizeTableMapping(raw: any): NormalizedTableMapping | null {
  const sourceTable = firstOf(raw?.sourceTables) ?? firstOf(raw?.sourceTable);
  const targetTable = firstOf(raw?.targetTables) ?? firstOf(raw?.targetTable);
  if (!sourceTable || !targetTable) return null;

  const columnMappings = Array.isArray(raw?.columnMappings)
    ? raw.columnMappings.map(normalizeColumnMapping).filter(Boolean as any)
    : [];

  return {
    sourceTable,
    targetTable,
    mappingType: String(raw?.mappingType ?? 'MANUAL'),
    columnMappings: columnMappings as NormalizedColumnMapping[],
  };
}

export function normalizeTableMappings(config: any): NormalizedTableMapping[] {
  const raw = Array.isArray(config?.tableMappings) ? config.tableMappings : [];
  return raw.map(normalizeTableMapping).filter(Boolean) as NormalizedTableMapping[];
}

/* ==========================================================================
 * Canonicalization — turning any stored config into what the engine executes.
 *
 * READ THIS BEFORE USING normalizeTableMapping() ABOVE FOR ANYTHING NEW.
 *
 * The normalize* functions are deliberately LOSSY. They feed the queryable
 * migration_table_mapping / migration_column_mapping index and throw away
 * constantValue, transformation params, every per-column flag and every
 * table-level option. They look like a canonicalizer and are not one — using
 * them to build a job would silently drop half of what the user configured.
 *
 * toEngineConfig() below is the lossless one. It is an exact port of
 * transformMappingForServer() in src/features/migration/MigrationPage.tsx, so
 * a configuration saved from the browser executes identically whether it is
 * run ad-hoc (browser converts) or from the database (this converts).
 * ==========================================================================
 */

/**
 * The canonical form IS the engine's own type — deliberately, so the compiler
 * enforces that what this module produces is exactly what the worker consumes.
 * If TableMapping changes and the canonicalizer stops producing it, that is a
 * build error rather than a wrong migration.
 */
export type EngineColumnMapping = ColumnMapping;

/** As TableMapping, but conflictStrategy is always resolved (defaulting to 'skip'). */
export interface EngineTableMapping extends Omit<TableMapping, 'conflictStrategy'> {
  conflictStrategy: 'skip' | 'upsert';
}

export interface EngineConfig {
  version: unknown;
  tableMappings: EngineTableMapping[];
  customDependencies: Array<{ from: string; to: string }>;
}

export interface CanonicalizeResult {
  config: EngineConfig;
  /** Non-fatal: the config still runs, but something is worth telling the user. */
  warnings: string[];
  /** Table mappings that could not be executed at all and were left out. */
  dropped: Array<{ index: number; reason: string }>;
}

/** True when the value is a non-empty array. */
function nonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Which of the two shapes a config is written in. 'mixed' means different table
 * mappings disagree, which happens when a browser export is hand-edited.
 */
export function detectConfigShape(config: any): 'engine' | 'browser' | 'mixed' | 'empty' {
  const mappings = Array.isArray(config?.tableMappings) ? config.tableMappings : [];
  if (mappings.length === 0) return 'empty';

  let browser = 0;
  let engine = 0;
  for (const tm of mappings) {
    // sourceTables/targetTables (plural) is the browser's tell; so is a column
    // mapping whose source or target is an object rather than a flat string.
    const pluralTables = Array.isArray(tm?.sourceTables) || Array.isArray(tm?.targetTables);
    const objectRefs =
      Array.isArray(tm?.columnMappings) &&
      tm.columnMappings.some(
        (cm: any) =>
          (cm?.source !== null && typeof cm?.source === 'object') ||
          (cm?.target !== null && typeof cm?.target === 'object') ||
          Array.isArray(cm?.sourceColumns),
      );
    if (pluralTables || objectRefs) browser++;
    else engine++;
  }

  if (browser && engine) return 'mixed';
  return browser ? 'browser' : 'engine';
}

/**
 * Canonicalize one table mapping. Returns null when it has no usable source or
 * target table — the browser emits '' in that case, which becomes `FROM ""` and
 * fails deep inside the worker; refusing here gives the caller a real message.
 */
export function toEngineTableMapping(raw: any): EngineTableMapping | null {
  const sourceTable = firstOf(raw?.sourceTables) ?? firstOf(raw?.sourceTable);
  const targetTable = firstOf(raw?.targetTables) ?? firstOf(raw?.targetTable);
  if (!sourceTable || !targetTable) return null;

  // With joins the source is a joined query, so columns must be qualified
  // "table.column" to resolve. Without joins they stay bare.
  const hasJoins = nonEmptyArray(raw?.joins);

  const qualify = (ref: unknown): string => {
    if (typeof ref === 'string') return ref;
    if (ref && typeof ref === 'object') {
      const obj = ref as { table?: string; column?: string };
      if (hasJoins && obj.table) return `${obj.table}.${obj.column}`;
      return obj.column || '';
    }
    return '';
  };

  const rawColumns = Array.isArray(raw?.columnMappings) ? raw.columnMappings : [];
  const columnMappings: EngineColumnMapping[] = [];

  for (const cm of rawColumns) {
    const target = typeof cm?.target === 'string' ? cm.target : cm?.target?.column || '';
    if (!target) continue; // nothing to insert into

    const directSource = qualify(cm?.source);
    // TRANSFORM/CONCAT keep their input column in sourceColumns, not `source`.
    const firstSrc = nonEmptyArray(cm?.sourceColumns) ? cm.sourceColumns[0] : undefined;
    const firstSourceCol = firstSrc === undefined ? '' : qualify(firstSrc);
    const isTransform = cm?.mappingType === 'TRANSFORM' || cm?.mappingType === 'CONCAT';
    // CUSTOM and BUILD_JSON are evaluated in the source query as an aliased
    // column; `source` must point at that alias so the engine reads the result.
    const isCustom =
      cm?.mappingType === 'TRANSFORM' &&
      (cm?.transformation?.type === 'CUSTOM' || cm?.transformation?.type === 'BUILD_JSON');

    const engineColumn: EngineColumnMapping = {
      source: isCustom
        ? `__expr_${target}`
        : isTransform && firstSourceCol
          ? firstSourceCol
          : directSource,
      target,
      mappingType: cm?.mappingType || 'DIRECT',
    };

    // `undefined` means "not set"; 0 and false are legitimate constants.
    if (cm?.constantValue !== undefined) engineColumn.constantValue = cm.constantValue;
    // Without this a TRANSFORM silently degrades to a plain copy.
    if (cm?.transformation) engineColumn.transformation = cm.transformation;
    if (cm?.convertDateToEpoch === true) engineColumn.convertDateToEpoch = true;
    if (cm?.convertTinyintToBoolean === true) engineColumn.convertTinyintToBoolean = true;
    if (cm?.zeroToNull === true) engineColumn.zeroToNull = true;
    if (cm?.encrypt === true) engineColumn.encrypt = true;
    if (cm?.useGroupMin === true) engineColumn.useGroupMin = true;

    columnMappings.push(engineColumn);
  }

  return {
    sourceTable,
    targetTable,
    columnMappings,
    conflictStrategy: raw?.conflictStrategy ?? 'skip',
    ...(nonEmptyArray(raw?.conflictKeyColumns) && { conflictKeyColumns: raw.conflictKeyColumns }),
    ...(nonEmptyArray(raw?.rowFilters) && { rowFilters: raw.rowFilters }),
    ...(hasJoins && { joins: raw.joins }),
    ...(nonEmptyArray(raw?.groupByColumns) && { groupByColumns: raw.groupByColumns }),
    ...(raw?.groupByMode && { groupByMode: raw.groupByMode }),
    ...(nonEmptyArray(raw?.groupMinColumns) && { groupMinColumns: raw.groupMinColumns }),
    ...(nonEmptyArray(raw?.orderBy) && { orderBy: raw.orderBy }),
    ...(raw?.autoIdColumn && { autoIdColumn: raw.autoIdColumn }),
  };
}

/**
 * Canonicalize a whole configuration into the shape the migration engine runs.
 *
 * INVARIANT — fixed point: toEngineConfig(toEngineConfig(x).config).config
 * deep-equals toEngineConfig(x).config. This is what makes it safe to apply at
 * several layers (API entry, run handler, worker) without compounding. It is
 * NOT the identity on first application even for engine-shape input, because it
 * fills in conflictStrategy: 'skip' — assert the fixed point, not identity.
 * See configShape.test.ts; do not weaken those tests.
 */
export function toEngineConfig(config: any): CanonicalizeResult {
  const warnings: string[] = [];
  const dropped: Array<{ index: number; reason: string }> = [];
  const tableMappings: EngineTableMapping[] = [];

  const raw = Array.isArray(config?.tableMappings) ? config.tableMappings : [];

  raw.forEach((tm: any, index: number) => {
    const engineMapping = toEngineTableMapping(tm);
    if (!engineMapping) {
      dropped.push({ index, reason: 'no source table or no target table' });
      return;
    }

    const rawColumnCount = Array.isArray(tm?.columnMappings) ? tm.columnMappings.length : 0;
    const kept = engineMapping.columnMappings.length;
    if (kept < rawColumnCount) {
      warnings.push(
        `${engineMapping.sourceTable} -> ${engineMapping.targetTable}: ` +
          `${rawColumnCount - kept} column mapping(s) have no target column and were left out`,
      );
    }
    if (kept === 0) {
      dropped.push({
        index,
        reason: `${engineMapping.sourceTable} -> ${engineMapping.targetTable} has no usable column mappings`,
      });
      return;
    }

    tableMappings.push(engineMapping);
  });

  const customDependencies = Array.isArray(config?.customDependencies)
    ? config.customDependencies.filter((d: any) => d?.from && d?.to)
    : [];

  // The worker keys its dependency map on TARGET table names (see
  // calculateMigrationLevels in scripts/migration/queue/worker.ts), while the
  // Migration Order page builds these from SOURCE schema names. In this repo
  // those names coincide, which hides the mismatch — a name that matches
  // nothing is a silent no-op in ordering, so say so.
  const targetTables = new Set(tableMappings.map((m) => m.targetTable));
  for (const dep of customDependencies) {
    for (const side of ['from', 'to'] as const) {
      if (!targetTables.has(dep[side])) {
        warnings.push(
          `customDependencies: "${dep[side]}" matches no target table in this configuration, ` +
            `so it will not affect migration order`,
        );
      }
    }
  }

  return {
    config: { version: config?.version ?? 1, tableMappings, customDependencies },
    warnings,
    dropped,
  };
}

/** JSON with object keys sorted, so a checksum does not depend on key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as any)[key])}`);
  return `{${entries.join(',')}}`;
}

/** Identifies exactly what will execute, for run provenance and change detection. */
export function engineConfigChecksum(config: EngineConfig): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex');
}

/**
 * JSON paths of keys that look like credentials. Configurations reference a
 * connection_id and must never carry a password; this is the check that keeps
 * that true rather than merely documented.
 *
 * Matches key NAMES exactly, so a column mapped to a target named
 * "passwordColumn" — or a source column literally called "password" appearing
 * as a *value* — is not flagged. Only a key called `password` is.
 */
export function findCredentialLikeKeys(config: unknown): string[] {
  const CREDENTIAL_KEYS = new Set([
    'password',
    'passwd',
    'pwd',
    'secret',
    'apikey',
    'api_key',
    'accesskey',
    'access_key',
    'token',
    'dsn',
    'connectionstring',
    'connection_string',
    'encryptionkey',
    'encryption_key',
  ]);

  const found: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string) => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return; // tolerate cycles rather than blowing the stack
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      // An empty or absent value is not a leaked credential.
      if (CREDENTIAL_KEYS.has(key.toLowerCase()) && typeof value === 'string' && value !== '') {
        found.push(here);
      }
      walk(value, here);
    }
  };

  walk(config, '');
  return found;
}

/* ==========================================================================
 * The configuration SNAPSHOT — the complete ETL setup for one version.
 *
 * A saved configuration has to be enough on its own to reproduce a migration:
 * which databases, which schemas they had at the time, which tables were
 * selected, how they map, in what order, and with which run options. Storing
 * only tableMappings (what this used to do) means reopening a configuration
 * still leaves the user reconfiguring everything else by hand.
 *
 * `tableMappings` deliberately keeps its name, position and browser shape —
 * configurations already in the database depend on it, and so does
 * toEngineConfig().
 *
 * Credentials are never part of a snapshot. Connections are referenced by id,
 * and validateConfigJson rejects anything credential-shaped, including
 * encryptionKey.
 * ==========================================================================
 */

/** Current snapshot shape. Bumped when the shape changes incompatibly. */
export const SNAPSHOT_VERSION = 2;

export interface SnapshotConnectionRef {
  connectionId: number | null;
  dbType: 'mysql' | 'postgresql' | null;
}

export interface SnapshotRunOptions {
  useCopy: boolean;
  force: boolean;
  batchSize: number;
}

export interface ConfigurationSnapshot {
  snapshotVersion: number;
  version: unknown;
  connections: { source: SnapshotConnectionRef; target: SnapshotConnectionRef };
  schemaSnapshots: { sourceId: number | null; targetId: number | null };
  /** Target table names to migrate. Empty means every mapped table. */
  selectedTables: string[];
  tableMappings: unknown[];
  /** Explicit target-table order. Empty means derive from foreign keys. */
  mappingOrder: string[];
  customDependencies: Array<{ from: string; to: string }>;
  runOptions: SnapshotRunOptions;
}

export const DEFAULT_RUN_OPTIONS: SnapshotRunOptions = {
  useCopy: true,
  force: false,
  // Matches the value the API has always injected (server.ts).
  batchSize: 2000,
};

function connectionRef(raw: any): SnapshotConnectionRef {
  const id = Number(raw?.connectionId);
  const dbType = raw?.dbType === 'mysql' || raw?.dbType === 'postgresql' ? raw.dbType : null;
  return { connectionId: Number.isFinite(id) && id > 0 ? id : null, dbType };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function snapshotId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Backward compatibility for configurations saved before a field existed.
 * Spec: an old configuration lacking newly introduced fields must keep working
 * on sensible defaults rather than being rejected. The three configurations
 * already in the database predate every field below except tableMappings.
 */
export function applyConfigDefaults<T extends Record<string, unknown>>(
  config: T,
): T & ConfigurationSnapshot {
  const out: Record<string, unknown> = { ...config };

  if (out.version === undefined || out.version === null || out.version === '') {
    out.version = 1;
  }
  if (!Array.isArray(out.tableMappings)) {
    out.tableMappings = [];
  }

  // A config without snapshotVersion was written before the snapshot existed.
  const raw = config as any;
  out.snapshotVersion = Number(raw?.snapshotVersion) || 1;

  out.connections = {
    source: connectionRef(raw?.connections?.source),
    target: connectionRef(raw?.connections?.target),
  };
  out.schemaSnapshots = {
    sourceId: snapshotId(raw?.schemaSnapshots?.sourceId),
    targetId: snapshotId(raw?.schemaSnapshots?.targetId),
  };
  out.selectedTables = stringArray(raw?.selectedTables);
  out.mappingOrder = stringArray(raw?.mappingOrder);
  out.customDependencies = Array.isArray(raw?.customDependencies)
    ? raw.customDependencies
        .filter((d: any) => typeof d?.from === 'string' && typeof d?.to === 'string')
        .map((d: any) => ({ from: d.from, to: d.to }))
    : [];

  const runOptions = raw?.runOptions ?? {};
  const batchSize = Number(runOptions.batchSize);
  out.runOptions = {
    useCopy: runOptions.useCopy === undefined ? DEFAULT_RUN_OPTIONS.useCopy : !!runOptions.useCopy,
    force: !!runOptions.force,
    batchSize:
      Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : DEFAULT_RUN_OPTIONS.batchSize,
  };

  return out as T & ConfigurationSnapshot;
}

/**
 * The canonical form of a snapshot, for change detection.
 *
 * Built on toEngineConfig() rather than the raw JSON on purpose: two
 * configurations that would EXECUTE identically must hash identically. That
 * strips per-mapping UUIDs, decorative fields and key ordering, so clicking
 * Save twice without editing anything does not manufacture a new version,
 * while any change that alters the migration does.
 *
 * Schemas are represented by their snapshot ids, not their contents — pointing
 * a configuration at a re-captured schema is a real change.
 */
export function normalizeSnapshot(config: any): Record<string, unknown> {
  const full = applyConfigDefaults(config ?? {});
  const { config: engine } = toEngineConfig(full);

  return {
    connections: full.connections,
    schemaSnapshots: full.schemaSnapshots,
    // Order within these lists is not meaningful; sort so a reshuffle is not
    // mistaken for an edit. mappingOrder is excluded — there, order IS the value.
    selectedTables: [...full.selectedTables].sort(),
    tableMappings: engine.tableMappings,
    mappingOrder: full.mappingOrder,
    customDependencies: [...engine.customDependencies].sort((a, b) =>
      `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`),
    ),
    runOptions: full.runOptions,
  };
}

/** Identifies a configuration by what it would do. Equal hash → no new version. */
export function configurationChecksum(config: any): string {
  return createHash('sha256').update(stableStringify(normalizeSnapshot(config))).digest('hex');
}

/**
 * Structural validation before a configuration is stored.
 *
 * Validation is done against the CANONICAL form — the thing that will actually
 * execute — rather than the raw JSON. A config that validates here and then
 * fails at run time is the exact failure this module exists to prevent.
 */
export function validateConfigJson(config: any): string[] {
  const errors: string[] = [];

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return ['configuration must be a JSON object'];
  }
  if (!Array.isArray(config.tableMappings)) {
    errors.push('configuration.tableMappings must be an array');
    return errors;
  }

  // Configurations reference a connection by id and must never carry a password
  // — that is what lets one be exported, shared or version-controlled safely.
  for (const path of findCredentialLikeKeys(config)) {
    errors.push(
      `${path}: looks like a credential. Configurations must reference a saved ` +
        `connection instead of embedding secrets.`,
    );
  }

  const { dropped } = toEngineConfig(config);
  for (const drop of dropped) {
    errors.push(`tableMappings[${drop.index}]: ${drop.reason}`);
  }

  config.tableMappings.forEach((tm: any, i: number) => {
    const engineMapping = toEngineTableMapping(tm);
    if (!engineMapping) return; // already reported via `dropped`

    const where = `tableMappings[${i}] (${engineMapping.sourceTable} -> ${engineMapping.targetTable})`;

    for (const column of engineMapping.columnMappings) {
      switch (column.mappingType) {
        case 'CONSTANT':
          // null is a legitimate constant; undefined means nothing was chosen.
          if (column.constantValue === undefined) {
            errors.push(`${where}: CONSTANT column "${column.target}" has no constantValue`);
          }
          break;
        case 'TRANSFORM':
        case 'CONCAT':
          if (!column.transformation) {
            // Without the rule the engine silently degrades to a plain copy.
            errors.push(
              `${where}: ${column.mappingType} column "${column.target}" has no transformation rule`,
            );
          }
          break;
        default:
          if (!column.source) {
            errors.push(`${where}: column "${column.target}" has no source column`);
          }
      }
    }
  });

  errors.push(...validateSnapshotSections(config));

  return errors;
}

/**
 * Validation for the non-mapping parts of a snapshot.
 *
 * Kept separate so the mapping rules above stay readable, and so a legacy
 * configuration (which has none of these sections) produces no errors — every
 * check below is skipped when the field is absent or empty.
 */
function validateSnapshotSections(config: any): string[] {
  const errors: string[] = [];

  for (const role of ['source', 'target'] as const) {
    const raw = config?.connections?.[role];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'object') {
      errors.push(`connections.${role} must be an object`);
      continue;
    }
    if (raw.connectionId !== undefined && raw.connectionId !== null) {
      const id = Number(raw.connectionId);
      if (!Number.isInteger(id) || id <= 0) {
        errors.push(`connections.${role}.connectionId must be a positive integer`);
      }
    }
    if (raw.dbType !== undefined && raw.dbType !== null && raw.dbType !== 'mysql' && raw.dbType !== 'postgresql') {
      // hive is a valid connection dialect but has no adapter to move data.
      errors.push(`connections.${role}.dbType must be "mysql" or "postgresql"`);
    }
  }

  // Target tables the configuration actually knows about.
  const known = new Set(
    (Array.isArray(config?.tableMappings) ? config.tableMappings : [])
      .map((tm: any) => toEngineTableMapping(tm)?.targetTable)
      .filter(Boolean) as string[],
  );

  for (const [field, label] of [
    ['selectedTables', 'selectedTables'],
    ['mappingOrder', 'mappingOrder'],
  ] as const) {
    const list = config?.[field];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) {
      errors.push(`${label} must be an array of target table names`);
      continue;
    }
    for (const name of list) {
      if (typeof name !== 'string' || !name) {
        errors.push(`${label} entries must be non-empty strings`);
      } else if (known.size > 0 && !known.has(name)) {
        // A name matching nothing is a silent no-op at run time, which is how
        // tables end up migrating in the wrong order or not at all.
        errors.push(`${label}: "${name}" is not a target table in this configuration`);
      }
    }
    if (Array.isArray(list) && new Set(list).size !== list.length) {
      errors.push(`${label} contains duplicate table names`);
    }
  }

  const runOptions = config?.runOptions;
  if (runOptions !== undefined && runOptions !== null) {
    if (typeof runOptions !== 'object') {
      errors.push('runOptions must be an object');
    } else if (runOptions.batchSize !== undefined && runOptions.batchSize !== null) {
      const batchSize = Number(runOptions.batchSize);
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100_000) {
        errors.push('runOptions.batchSize must be an integer between 1 and 100000');
      }
    }
  }

  return errors;
}
