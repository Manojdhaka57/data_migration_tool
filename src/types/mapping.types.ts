/**
 * Mapping types for data migration configuration
 */

export type TransformationType =
  | 'UPPER'
  | 'LOWER'
  | 'CONCAT'
  | 'DATE_FORMAT'
  | 'CUSTOM'
  | 'BUILD_JSON'
  // Emitted by the SQL generators (utils/configGenerator, utils/sqlGenerator)
  // and switched on there. Declaring them is what lets `npm run build` compile.
  | 'TRIM'
  | 'COALESCE';

export type MappingType = 'DIRECT' | 'CONSTANT' | 'TRANSFORM' | 'CONCAT' | 'LOOKUP';

export interface TransformationRule {
  type: TransformationType;
  params?: Record<string, string | string[]>;
  // For CONCAT: { fields: ['col1', 'col2'], separator: ', ' }
  // For DATE_FORMAT: { format: 'YYYY-MM-DD' }
  // For CUSTOM: { expression: 'CASE WHEN x > 0 THEN ...' }
}

export interface ColumnMapping {
  id: string;
  target: {
    table: string;
    column: string;
  };
  mappingType: MappingType;
  // For DIRECT mapping
  source?: {
    table: string;
    column: string;
  };
  // For CONSTANT mapping
  constantValue?: string | number | boolean | null;
  // For TRANSFORM mapping
  transformation?: TransformationRule;
  sourceColumns?: Array<{
    table: string;
    column: string;
  }>;
  /** Convert date/datetime string (or Date) to Unix epoch seconds */
  convertDateToEpoch?: boolean;
  /** Convert tinyint (0/1) to boolean */
  convertTinyintToBoolean?: boolean;
  /** If the value is 0 (or "0"), insert NULL instead. */
  zeroToNull?: boolean;
  /** Encrypt this column's value (AES-256-CBC) before inserting into the target. */
  encrypt?: boolean;
  /**
   * Keep-all grouping only: pull this column's value from MIN(source) OVER (PARTITION BY
   * the table's groupByColumns) — so every row in a group carries the group minimum
   * (e.g. a child FK set to the parent's lowest id). Ignored unless the table mapping is
   * in 'all' (keep-all) mode with group columns set.
   */
  useGroupMin?: boolean;
  /**
   * CONCAT separator, read by the SQL generators.
   *
   * Declared here because those generators already read `cm.concatSeparator`
   * and `cm.lookup`; without the declarations `tsc -b` fails, which meant the
   * production build could not run at all. Type-only — no behaviour changes.
   */
  concatSeparator?: string;
  /** LOOKUP mapping: resolve a value from another table. */
  lookup?: {
    table: string;
    matchColumn: string;
    returnColumn: string;
  };
}

export type ConflictStrategy = 'skip' | 'upsert';

export type FilterOperator =
  | '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL';

export interface RowFilter {
  /** Source column the condition applies to. */
  column: string;
  operator: FilterOperator;
  /** Value (ignored for IS NULL / IS NOT NULL; comma-separated for IN / NOT IN). */
  value?: string;
}

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT';
export interface JoinSpec {
  /** Joined source table (not the primary table). */
  table: string;
  type: JoinType;
  /** Qualified column on the primary/prior table: "table.column". */
  leftColumn: string;
  /** Column on the joined `table` (bare). */
  rightColumn: string;
}

/** A join from an already-included source table to another source table. */
export interface SourceJoin {
  table: string;
  type: 'INNER' | 'LEFT';
  leftTable: string;
  leftColumn: string;
  rightColumn: string;
}

export type SortDirection = 'ASC' | 'DESC';
/** One ORDER BY term: a source column and its sort direction. */
export interface OrderBySpec {
  /** Source column (bare, or "table.column" in a joined mapping). */
  column: string;
  direction: SortDirection;
}

export interface TableMapping {
  id: string;
  sourceTables: string[];
  targetTables: string[];
  columnMappings: ColumnMapping[];
  description?: string;
  /** Row-level filter: only source rows matching ALL of these conditions are migrated. */
  rowFilters?: RowFilter[];
  /** Join additional source tables to the primary table; columns referenced as "table.column". */
  joins?: JoinSpec[];
  /** Join the primary source table with others; column mappings/filters use table.column. */
  sourceJoins?: SourceJoin[];
  /**
   * GROUP BY these source columns to collapse duplicate rows to one per distinct
   * combination (dedup). When set, only these columns are read from the source —
   * column mappings referencing other columns receive NULL.
   */
  groupByColumns?: string[];
  /**
   * What grouping outputs:
   *  - 'dedup' (default): one full row per group (the parent / deduplicated row).
   *  - 'all': keep every source row unchanged (the group columns are ignored for row
   *    reduction). Lets a child mapping reuse the same join + computed id on all rows.
   */
  groupByMode?: 'dedup' | 'all';
  /**
   * Keep-all mode only: source columns whose value is replaced, on every row, by the
   * MIN of that column within its group — i.e. MIN(col) OVER (PARTITION BY groupByColumns).
   * Lets all rows of a group carry the parent's id (the parent keeps the lowest-PK row).
   */
  groupMinColumns?: string[];
  /** Order source rows by these columns before reading (applied in the source query). */
  orderBy?: OrderBySpec[];
  /**
   * Target column to leave out of the INSERT so the target DB auto-assigns it
   * (auto-increment / identity / serial). Used to give deduplicated (GROUP BY)
   * rows a fresh unique id, since the source id is collapsed away by grouping.
   */
  autoIdColumn?: string;
  /**
   * How to handle rows whose key already exists in the target:
   *  - 'skip'   (default): leave existing rows untouched (dedup)
   *  - 'upsert': overwrite existing rows with the latest source values
   */
  conflictStrategy?: ConflictStrategy;
  /**
   * Target column(s) used to decide "update existing row" vs "insert new row" for
   * upsert. When empty, the target table's detected primary key is used. The chosen
   * columns must have a primary-key or unique constraint in the target.
   */
  conflictKeyColumns?: string[];
}

export interface ValidationError {
  type: 'error' | 'warning';
  field: string;
  message: string;
  tableMappingId?: string;
  columnMappingId?: string;
}

/**
 * What generateMigrationConfig() emits for download / clipboard.
 *
 * Deliberately NOT TableMapping: formatColumnMapping flattens each column
 * mapping into an export form, so declaring these as the editor's TableMapping
 * was a claim the compiler correctly rejected — and that single error was
 * enough to fail `npm run build`, and with it any Vercel deploy.
 */
export interface ExportedTableMapping {
  id: string;
  sourceTables: string[];
  targetTables: string[];
  description?: string;
  conflictStrategy?: ConflictStrategy;
  conflictKeyColumns?: string[];
  rowFilters?: RowFilter[];
  joins?: JoinSpec[];
  columnMappings: unknown[];
}

export interface MigrationConfig {
  version: string;
  createdAt: string;
  sourceDatabase: string;
  targetDatabase: string;
  tableMappings: ExportedTableMapping[];
  metadata?: {
    author?: string;
    description?: string;
  };
}
