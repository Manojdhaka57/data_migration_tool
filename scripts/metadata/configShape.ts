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

/**
 * Backward compatibility for configurations saved before versioning existed.
 * Spec: an old configuration lacking newly introduced fields must keep working
 * on sensible defaults rather than being rejected.
 */
export function applyConfigDefaults<T extends Record<string, unknown>>(
  config: T,
): T & { version: unknown; tableMappings: unknown[] } {
  const out: Record<string, unknown> = { ...config };
  if (out.version === undefined || out.version === null || out.version === '') {
    out.version = 1;
  }
  if (!Array.isArray(out.tableMappings)) {
    out.tableMappings = [];
  }
  return out as T & { version: unknown; tableMappings: unknown[] };
}

/** Cheap structural validation before a configuration is stored. */
export function validateConfigJson(config: any): string[] {
  const errors: string[] = [];

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return ['configuration must be a JSON object'];
  }
  if (!Array.isArray(config.tableMappings)) {
    errors.push('configuration.tableMappings must be an array');
    return errors;
  }

  config.tableMappings.forEach((tm: any, i: number) => {
    const normalized = normalizeTableMapping(tm);
    if (!normalized) {
      errors.push(`tableMappings[${i}]: needs a source table and a target table`);
      return;
    }
    if (normalized.columnMappings.length === 0) {
      errors.push(
        `tableMappings[${i}] (${normalized.sourceTable} -> ${normalized.targetTable}): no column mappings`,
      );
    }
  });

  return errors;
}
