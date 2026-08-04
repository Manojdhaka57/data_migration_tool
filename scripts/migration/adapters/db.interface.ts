import { DatabaseSchema, TableStructure, TableResult } from '../types';
import { Dialect } from './typeMap';

export type ConflictStrategy = 'skip' | 'upsert';

export interface InsertOptions {
  /** How to handle rows whose key already exists. Defaults to 'skip'. */
  conflictStrategy?: ConflictStrategy;
}

export interface IDatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getTables(): Promise<{ name: string; rowCount: number }[]>;
  // Cheap table-name list (no row counts) for fast connection checks.
  getTableNames(): Promise<string[]>;
  getSchema(): Promise<DatabaseSchema>;
  getDDL(): Promise<{ database: string; tables: { name: string; ddl: string }[] }>;
  
  // Stream data in batches
  streamTable(
    tableName: string,
    onBatch: (rows: any[]) => Promise<void>,
    options?: {
      batchSize?: number;
      startId?: any;
      endId?: any;
      pkColumn?: string;
      where?: string;
      /** Extra computed columns to project: `(expr) AS "alias"` (for CUSTOM SQL transforms). */
      selectExpressions?: Array<{ expr: string; alias: string }>;
      /** Full FROM expression incl. joins (e.g. `"a" INNER JOIN "b" ON ...`); replaces the table. */
      fromClause?: string;
      /** Explicit SELECT list (replaces `*`) — required with joins to avoid ambiguity. */
      selectList?: string;
      /** GROUP BY fragment (no leading keyword), e.g. `"a", "b"` — forces the streamed path. */
      groupBy?: string;
      /** ORDER BY fragment (no leading keyword), e.g. `"a" ASC, "b" DESC` — forces the streamed path. */
      orderBy?: string;
    }
  ): Promise<void>;
  
  // Bulk operations
  insertBatch(
    tableName: string,
    columns: string[],
    rows: any[],
    pkColumns: string[],
    options?: InsertOptions
  ): Promise<{ inserted: number; failed: number; skipped: number; errors: string[] }>;
  
  // PostgreSQL COPY support
  copyBatch?(
    tableName: string,
    columns: string[],
    rows: any[]
  ): Promise<number>;
  
  // Sample rows for previewing table data (SELECT * ... LIMIT n).
  previewTable(tableName: string, limit?: number): Promise<any[]>;

  getTableStructure(tableName: string): Promise<TableStructure>;
  createTable(tableName: string, structure: TableStructure, sourceDialect?: Dialect): Promise<void>;
  // Drop a table (DELETES its data). Handles FK dependents (PG CASCADE / MySQL FK-checks off).
  dropTable(tableName: string): Promise<void>;
  // Additive-only: add a single column (always nullable, so it's safe on populated tables).
  addColumn(tableName: string, column: { name: string; type: string }, sourceDialect?: Dialect): Promise<void>;
  addForeignKey(
    tableName: string,
    constraintName: string,
    columnName: string,
    refTable: string,
    refColumn: string
  ): Promise<void>;
  
  // Validation (row counts & checksums)
  getChecksum(tableName: string, columns: string[]): Promise<string>;
  // Optional `where` (a pre-built, dialect-quoted SQL fragment, no leading WHERE)
  // counts only the rows matching a row filter. Optional `fromClause` counts over a
  // joined query (FROM <fromClause>).
  getRowCount(tableName: string, where?: string, fromClause?: string): Promise<number>;
  
  // Optional target pre/post operations
  disableConstraints?(): Promise<void>;
  enableConstraints?(): Promise<void>;

  // Post-load: advance every auto-increment/identity sequence in a table past its
  // current MAX value, so an application INSERT that omits the id doesn't collide
  // on the primary key. No-op on engines that self-heal the counter (e.g. MySQL).
  resetAutoIncrement?(tableName: string): Promise<void>;

  // Remediation for an already-migrated table whose column was created without its
  // auto-increment/identity: make the column generated (if it isn't) and advance its
  // sequence past existing data. Idempotent.
  ensureAutoIncrement?(tableName: string, columnName: string): Promise<void>;

  // Remediation: set a column's DEFAULT on an existing table (the expression must
  // already be valid for this dialect). Lets a not-null column accept omitted inserts.
  ensureColumnDefault?(tableName: string, columnName: string, defaultExpr: string): Promise<void>;
}
